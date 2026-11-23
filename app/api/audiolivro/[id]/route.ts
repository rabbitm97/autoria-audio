// app/api/audiolivro/[id]/route.ts
//
// Audiolivro de um livro. Adaptada da rota do audiolivro da Autoria: quem
// tem o link ouve; quem enviou o livro (token no cabeçalho x-livro-token)
// configura, gera e ajusta. Sem plano, cobrança, conclusão nem experimento.
//   GET                                        → dados, andamento, links (1h) dos capítulos montados
//                                                e, antes de preparar, a prévia do livro
//   GET ?capitulo=N                            → trechos do capítulo N (com link de cada um)
//   GET ?conferir=1                            → só os trechos que pedem conferência do autor
//   GET ?amostra=<voz>                         → link da amostra da voz (gera na 1ª vez)
//   POST { acao: "preparar", voz, pronuncias, nomes_conferidos, confirmar? }
//                                              → divide o livro em trechos (refaz só o que mudou)
//   POST { acao: "processar" }                 → gera o próximo lote; a tela chama em laço até terminar
//   POST { acao: "regenerar", trecho_id }      → outro take de um trecho (limite do livro)
//   POST { acao: "editar_fala", trecho_id, texto | restaurar } → ajusta o texto falado
//   POST { acao: "sugerir_pronuncias" }        → nomes do livro que a voz pode ler errado (IA)
//   POST { acao: "amostra_nome", voz, grafia, fala } → a voz fala o nome numa frase do livro

export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/adaptadores/supabase";
import { hashDoEndereco, lerLivro, narracoesRecentes, tokenConfere } from "@/lib/adaptadores/livros";
import { LIMITE_CARACTERES, LIMITE_LIVROS_DIA, LIMITE_LIVROS_IP_DIA, LIMITE_REGENERACOES } from "@/lib/adaptadores/limites";
import { MSG_SEM_CREDITOS, creditosEsgotados } from "@/lib/adaptadores/avisos";
import {
  amostraDaVoz,
  amostraDoNome,
  editarFala,
  linksDosCapitulos,
  listarTrechos,
  livroParaAudio,
  pedirRegeneracao,
  prepararAudiolivro,
  previaDoLivro,
  processarLote,
  segmentosDoLivro,
  statusAudiolivro,
  type Falha,
} from "@/lib/audiolivro/motor";
import { SemChaveIa, sugerirPronuncias } from "@/lib/audiolivro/pronuncia-ia";

type Ctx = { params: Promise<{ id: string }> };

function responderFalha(f: Falha) {
  return NextResponse.json(f.corpo, { status: f.status });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = supabaseAdmin();
  const livro = await lerLivro(admin, id);
  if (!livro?.capitulos) return NextResponse.json({ error: "Audiolivro não encontrado." }, { status: 404 });

  const amostraParam = req.nextUrl.searchParams.get("amostra");
  if (amostraParam !== null) {
    const r = await amostraDaVoz(admin, amostraParam);
    if (!r.ok) return responderFalha(r);
    return NextResponse.json({ url: r.url });
  }

  const capituloParam = req.nextUrl.searchParams.get("capitulo");
  if (capituloParam !== null) {
    const capitulo = Number(capituloParam);
    if (!Number.isInteger(capitulo)) return NextResponse.json({ error: "capitulo inválido" }, { status: 400 });
    return NextResponse.json({ trechos: await listarTrechos(admin, id, capitulo) });
  }
  if (req.nextUrl.searchParams.get("conferir") === "1") {
    return NextResponse.json({ trechos: await listarTrechos(admin, id, null) });
  }

  const dados = livro.dados;
  const status = await statusAudiolivro(admin, id, dados);
  const links = dados ? await linksDosCapitulos(admin, dados) : {};
  return NextResponse.json({
    livro: { id: livro.id, titulo: livro.titulo, subtitulo: livro.subtitulo, autor: livro.autor, cortado: livro.cortado, exemplo: livro.exemplo },
    dono: await tokenConfere(admin, id, req),
    dados,
    status,
    links,
    previa: dados ? null : previaDoLivro(livroParaAudio(livro)),
    limites: { caracteres: LIMITE_CARACTERES, regeneracoes: LIMITE_REGENERACOES },
    creditos_esgotados: await creditosEsgotados(admin),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const admin = supabaseAdmin();
  if (!(await tokenConfere(admin, id, req))) {
    return NextResponse.json({ error: "Só quem enviou o livro pode mudar a narração." }, { status: 403 });
  }
  const livro = await lerLivro(admin, id);
  if (!livro?.capitulos) return NextResponse.json({ error: "Aprove os capítulos antes." }, { status: 409 });

  let body: {
    acao?: unknown; voz?: unknown; pronuncias?: unknown; trecho_id?: unknown;
    nomes_conferidos?: unknown; confirmar?: unknown; grafia?: unknown; fala?: unknown;
    texto?: unknown; restaurar?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (body.acao === "preparar") {
    // Primeira narração deste livro: créditos da demonstração e limite do dia.
    if (!livro.dados) {
      if (await creditosEsgotados(admin)) {
        return NextResponse.json({ error: MSG_SEM_CREDITOS, reason: "sem_creditos" }, { status: 503 });
      }
      if (!livro.exemplo) {
        const uso = await narracoesRecentes(admin, hashDoEndereco(req));
        if (uso.total >= LIMITE_LIVROS_DIA) {
          return NextResponse.json({ error: "A demonstração atingiu o limite de livros narrados hoje. Tente de novo amanhã.", reason: "limite_dia" }, { status: 429 });
        }
        if (uso.doEndereco >= LIMITE_LIVROS_IP_DIA) {
          return NextResponse.json({ error: `Você já narrou ${LIMITE_LIVROS_IP_DIA} livros hoje. Tente de novo amanhã.`, reason: "limite_endereco" }, { status: 429 });
        }
      }
    }
    const r = await prepararAudiolivro(admin, {
      livroId: id,
      livro: livroParaAudio(livro),
      voz: body.voz,
      pronuncias: body.pronuncias,
      atual: livro.dados,
      confirmar: body.confirmar,
      nomesConferidos: body.nomes_conferidos,
    });
    if (!r.ok) return responderFalha(r);
    const status = await statusAudiolivro(admin, id, r.dados);
    return NextResponse.json({ dados: r.dados, refazer: r.refazer, edicoes_descartadas: r.edicoesDescartadas, status });
  }

  if (body.acao === "processar") {
    const r = await processarLote(admin, id);
    if (!r.ok) return responderFalha(r);
    return NextResponse.json({ status: r.status, aguardar_ms: r.aguardar_ms, limite_diario: r.limite_diario });
  }

  if (body.acao === "regenerar") {
    const r = await pedirRegeneracao(admin, id, body.trecho_id);
    if (!r.ok) return responderFalha(r);
    return NextResponse.json({ regeneracoes_usadas: r.regeneracoes_usadas });
  }

  if (body.acao === "editar_fala") {
    const r = await editarFala(admin, id, body.trecho_id, body.texto, body.restaurar === true);
    if (!r.ok) return responderFalha(r);
    return NextResponse.json({ regeneracoes_usadas: r.regeneracoes_usadas });
  }

  if (body.acao === "amostra_nome") {
    const r = await amostraDoNome(admin, livroParaAudio(livro), id, body.voz, body.grafia, body.fala);
    if (!r.ok) return responderFalha(r);
    return NextResponse.json({ url: r.url, frase: r.frase });
  }

  // Sugestão de pronúncia de nomes (IA). Não grava nada: o autor revisa.
  if (body.acao === "sugerir_pronuncias") {
    try {
      const sugestoes = await sugerirPronuncias(
        segmentosDoLivro(livroParaAudio(livro)).map((s) => s.texto),
        livro.dados?.pronuncias ?? [],
      );
      return NextResponse.json({ sugestoes });
    } catch (e) {
      console.error("[audiolivro] sugerir pronúncias:", e instanceof Error ? e.message : e);
      const msg = e instanceof SemChaveIa
        ? "A sugestão automática de nomes não está disponível nesta demonstração. Escreva a pronúncia dos nomes à mão."
        : "Não foi possível sugerir agora (os créditos da IA podem ter acabado). Escreva a pronúncia dos nomes à mão ou tente mais tarde.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "acao inválida" }, { status: 400 });
}
