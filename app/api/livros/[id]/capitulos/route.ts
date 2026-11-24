// app/api/livros/[id]/capitulos/route.ts
//
// Etapa Capítulos (só quem enviou o livro, pelo token, e só antes de a
// narração começar):
//   GET                                       → candidatos a capítulo (padrões do texto,
//                                               estilos do Word e conferência por IA), com
//                                               as decisões anteriores do autor reaplicadas
//   POST { acao: "aprovar", capitulos: [{ titulo, pos }], incluir_abertura }
//                                             → monta os capítulos narrados e libera a narração
//   POST { acao: "buscar", termo }            → onde está uma linha no texto (para marcar
//                                               um capítulo que faltou)
//   POST { acao: "segmento", pos, fim }       → texto de um capítulo, para editar
//   POST { acao: "abertura", fim }            → texto antes do 1º capítulo, para editar
//   POST { acao: "salvar_segmento", start, end, texto_novo, hash_atual, destino_trecho?,
//          trecho?, pos_titulo?, capitulo_novo_titulo?, abertura?, marcados }
//                                             → grava o texto editado e ajusta as posições
//   POST { acao: "recomecar" }                → apaga as decisões e refaz a proposta

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import {
  apagarDecisoes,
  gravarAprovacao,
  gravarProposta,
  gravarTextoEditado,
  lerLivro,
  lerManuscrito,
  md5,
  tokenConfere,
  type Manuscrito,
} from "@/lib/adaptadores/livros";
import { aplicarTitulosDoWord, buscarNoTexto, proporCapitulos, reaplicarDecisoes } from "@/lib/adaptadores/deteccao";
import { conferirComIa } from "@/lib/adaptadores/arbitragem";
import { capitulosDoTexto, cortarNoLimite, lerAbertura, lerTrecho, salvarTrecho, type Destino } from "@/lib/adaptadores/edicao";
import { LIMITE_CARACTERES, paraTela } from "@/lib/adaptadores/limites";
import type { CapituloAprovado } from "@/lib/adaptadores/tipos";
import { erro } from "@/lib/api/respostas";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Lista de capítulos vinda do navegador: título e posição válidos. */
function listaValida(x: unknown): CapituloAprovado[] | null {
  if (!Array.isArray(x)) return null;
  const r: CapituloAprovado[] = [];
  for (const c of x.slice(0, 400) as { titulo?: unknown; pos?: unknown }[]) {
    if (typeof c?.titulo !== "string" || typeof c?.pos !== "number" || !Number.isFinite(c.pos) || c.pos < 0) return null;
    r.push({ titulo: c.titulo.trim().slice(0, 120), pos: c.pos });
  }
  return r.sort((a, b) => a.pos - b.pos);
}

async function carregar(req: NextRequest, id: string) {
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) return { falha: erro(403, "Só quem enviou o livro pode mexer nos capítulos.") };
  const [livro, m] = await Promise.all([lerLivro(admin, id), lerManuscrito(admin, id)]);
  if (!livro || !m) return { falha: erro(404, "Livro não encontrado.") };
  if (m.texto === null) return { falha: erro(404, "O texto deste livro ainda não foi lido.") };
  if (m.texto.trim().length < 50) return { falha: erro(422, "Texto do manuscrito não encontrado.") };
  return { admin, livro, m: m as Manuscrito & { texto: string } };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const c = await carregar(req, id);
  if ("falha" in c) return c.falha;
  const { admin, livro, m } = c;
  const hash = md5(m.texto);

  // A proposta (padrões + Word + IA) vale enquanto o texto não muda.
  let proposta = m.proposta?.hash === hash ? m.proposta : null;
  if (!proposta) {
    const candidatos = proporCapitulos(m.texto);
    const decididos = aplicarTitulosDoWord(candidatos, m.texto, m.titulos_word ?? [], livro.titulo);
    const { estado, truncado } = await conferirComIa(m.texto, candidatos, decididos);
    proposta = { hash, candidatos, arbitragem: estado, truncado };
    // Sem IA agora: não guarda, para tentar de novo na próxima vez.
    if (estado !== "indisponivel") await gravarProposta(admin, id, proposta);
  }

  const candidatos = structuredClone(proposta.candidatos);
  const reidratado = !!m.capitulos_aprovados?.length && m.capitulos_aprovados_hash === hash;
  if (reidratado) reaplicarDecisoes(candidatos, m.texto, m.capitulos_aprovados!);

  return NextResponse.json({
    candidatos,
    arbitragem: proposta.arbitragem,
    arbitragem_truncada: proposta.truncado,
    reidratado,
    incluir_abertura: m.incluir_abertura,
    caracteres: m.texto.length,
    limite_caracteres: paraTela(LIMITE_CARACTERES),
    narracao_comecou: !!livro.dados,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const c = await carregar(req, id);
  if ("falha" in c) return c.falha;
  const { admin, livro, m } = c;
  if (livro.dados) return erro(409, "A narração já começou: os capítulos e o texto não mudam mais.");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return erro(400, "Body JSON inválido");
  }
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

  switch (body.acao) {
    case "aprovar": {
      const aprovados = listaValida(body.capitulos);
      if (!aprovados) return erro(400, "Cada capítulo precisa de título e posição.");
      if (aprovados.some((a) => !a.titulo)) return erro(400, "Cada capítulo precisa de título não vazio.");
      const incluirAbertura = body.incluir_abertura !== false;
      const todos = capitulosDoTexto(m.texto, aprovados, livro.titulo);
      const narrados = todos.filter((t) => t.texto.trim() && (incluirAbertura || t.titulo !== ""));
      if (narrados.length === 0) return erro(422, "Os capítulos marcados não têm texto.");
      const { capitulos, cortado } = cortarNoLimite(narrados, LIMITE_CARACTERES);
      const ok = await gravarAprovacao(admin, id, { texto: m.texto, aprovados, incluirAbertura, capitulos, cortado });
      if (!ok) return erro(500, "Falha ao salvar capítulos aprovados.");
      return NextResponse.json({ ok: true, total_aprovados: aprovados.length, capitulos: capitulos.length, cortado });
    }

    case "buscar": {
      const termo = typeof body.termo === "string" ? body.termo.trim() : "";
      if (termo.length < 3 || termo.length > 120) return erro(400, "A busca deve ter entre 3 e 120 caracteres.");
      return NextResponse.json({ ocorrencias: buscarNoTexto(m.texto, termo) });
    }

    case "segmento": {
      const r = lerTrecho(m.texto, Number(body.pos), num(body.fim));
      return "ok" in r ? erro(r.status, r.error) : NextResponse.json(r);
    }

    case "abertura": {
      const r = lerAbertura(m.texto, Number(body.fim));
      return "ok" in r ? erro(r.status, r.error) : NextResponse.json(r);
    }

    case "salvar_segmento": {
      if (typeof body.texto_novo !== "string" || typeof body.hash_atual !== "string") {
        return erro(400, "texto_novo e hash_atual obrigatórios");
      }
      const destinos: Destino[] = ["substituir", "novo", "anterior", "seguinte"];
      const destino = destinos.includes(body.destino_trecho as Destino) ? (body.destino_trecho as Destino) : "substituir";
      // As posições a ajustar: o que o autor marcou na tela (ou as decisões guardadas).
      const marcados = listaValida(body.marcados);
      const guardadas = m.capitulos_aprovados_hash === md5(m.texto) ? m.capitulos_aprovados ?? [] : [];
      const r = salvarTrecho(m.texto, marcados ?? guardadas, {
        start: Number(body.start),
        end: Number(body.end),
        textoNovo: body.texto_novo,
        hashAtual: body.hash_atual,
        destino,
        trecho: typeof body.trecho === "string" ? body.trecho : "",
        posTitulo: num(body.pos_titulo),
        tituloNovo: typeof body.capitulo_novo_titulo === "string" ? body.capitulo_novo_titulo : "",
        abertura: body.abertura === true,
      });
      if ("error" in r) return erro(r.status, r.error);
      if (!(await gravarTextoEditado(admin, id, r.texto, r.capitulos))) return erro(500, "Não foi possível salvar agora. Tente de novo.");
      const { texto: _texto, capitulos: _lista, ...resposta } = r;
      void _texto;
      void _lista;
      return NextResponse.json(resposta);
    }

    case "recomecar": {
      if (!(await apagarDecisoes(admin, id))) return erro(500, "Não foi possível recomeçar agora.");
      return NextResponse.json({ ok: true });
    }

    default:
      return erro(400, "acao inválida");
  }
}
