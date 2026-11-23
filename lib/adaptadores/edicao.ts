// lib/adaptadores/edicao.ts
//
// Texto do livro na etapa Capítulos: ler o trecho de um capítulo (ou a
// abertura, o texto antes do 1º capítulo), salvar o que o autor editou e,
// quando ele apaga um pedaço grande, mandar esse pedaço para um capítulo
// novo, para o capítulo anterior ou para o seguinte. As posições dos
// capítulos já decididos andam junto com o texto. No fim, o texto vira os
// capítulos narrados (a abertura é um capítulo sem título).
// Mesmo comportamento do editor de capítulos da Autoria, escrito de novo para
// a demonstração. Módulo puro (o banco fica com quem chama).

import { createHash } from "node:crypto";
import type { CapituloAprovado, CapituloTexto } from "./tipos";

export const normalizarTexto = (t: string) => t.replace(/\r\n?/g, "\n");
export const hashDoTexto = (t: string) => createHash("md5").update(t).digest("hex");

/** Junta pedaços com uma linha em branco entre eles, sem quebras sobrando nas pontas. */
function emendar(...pedacos: string[]): string {
  return pedacos
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/** Onde começa o pedaço que vem depois de `prefixo` emendado. */
function inicioDepois(prefixo: string): number {
  return prefixo.length === 0 ? 0 : prefixo.length + 2;
}

/** Quanto anda o texto que estava a partir de `de`, depois de virar `final`. */
function deslocamento(original: string, final: string, de: number): number {
  const resto = original.slice(de).replace(/^\n+|\n+$/g, "");
  return (resto.length > 0 ? final.length - resto.length : final.length) - de;
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export type Falha = { ok: false; status: number; error: string };

export interface Trecho {
  texto_segmento: string;
  start: number;
  end: number;
  titulo_linha: string | null;
  pos_titulo: number | null;
  hash_atual: string;
}

/** Trecho de um capítulo: do título (pos) até o próximo capítulo (fim) ou o fim do livro. */
export function lerTrecho(textoBruto: string, pos: number, fim: number | null): Trecho | Falha {
  const texto = normalizarTexto(textoBruto);
  const ate = fim ?? texto.length;
  if (!Number.isFinite(pos) || pos < 0 || pos >= texto.length || !Number.isFinite(ate) || ate <= pos || ate > texto.length) {
    return { ok: false, status: 404, error: "Esse trecho não existe mais no texto — recarregue a conferência." };
  }
  const bruto = texto.slice(pos, ate);
  const nl = bruto.indexOf("\n");
  const primeira = nl > -1 ? bruto.slice(0, nl).trim() : "";
  // Primeira linha curta = título do capítulo: fica fora da caixa de edição.
  if (nl > -1 && primeira.length > 0 && primeira.length <= 80) {
    let k = nl + 1;
    while (k < bruto.length && bruto[k] === "\n") k++;
    return { texto_segmento: texto.slice(pos + k, ate), start: pos + k, end: ate, titulo_linha: primeira, pos_titulo: pos, hash_atual: hashDoTexto(texto) };
  }
  return { texto_segmento: bruto, start: pos, end: ate, titulo_linha: null, pos_titulo: null, hash_atual: hashDoTexto(texto) };
}

/** Abertura: tudo antes do 1º capítulo, inteiro (não tem título). */
export function lerAbertura(textoBruto: string, fim: number): Trecho | Falha {
  const texto = normalizarTexto(textoBruto);
  if (!Number.isFinite(fim) || fim <= 0 || fim > texto.length || texto.slice(0, fim).trim() === "") {
    return { ok: false, status: 404, error: "Este livro não tem texto antes do primeiro capítulo." };
  }
  return { texto_segmento: texto.slice(0, fim), start: 0, end: fim, titulo_linha: null, pos_titulo: null, hash_atual: hashDoTexto(texto) };
}

// ─── Gravação ───────────────────────────────────────────────────────────────

export type Destino = "substituir" | "novo" | "anterior" | "seguinte";

export interface PedidoSalvar {
  start: number;
  end: number;
  textoNovo: string;
  hashAtual: string;
  destino: Destino;
  /** Pedaço apagado que o autor quer guardar (destinos novo, anterior e seguinte). */
  trecho: string;
  posTitulo: number | null;
  tituloNovo: string;
  abertura: boolean;
}

export interface Salvo {
  ok: true;
  texto: string;
  capitulos: CapituloAprovado[];
  delta_antes_de_s: number;
  delta_apos_e: number;
  hash_novo: string;
  capitulo_novo_pos?: number;
  titulo_origem_removido?: true;
}

/** Fim do título do capítulo seguinte (começo do corpo dele). */
function corpoDoSeguinte(texto: string, e: number): number {
  const nl = texto.indexOf("\n", e);
  let k = nl < 0 ? texto.length : nl + 1;
  while (k < texto.length && texto[k] === "\n") k++;
  return k;
}

/**
 * Aplica a edição ao texto e devolve o texto novo com as posições dos
 * capítulos ajustadas. `capitulos` são os já decididos (podem estar vazios).
 */
export function salvarTrecho(textoBruto: string, capitulos: CapituloAprovado[], p: PedidoSalvar): Salvo | Falha {
  const texto = normalizarTexto(textoBruto);
  const s = p.start;
  const e = p.end;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s || e > texto.length) {
    return { ok: false, status: 400, error: "Trecho inválido." };
  }
  if (hashDoTexto(texto) !== p.hashAtual) {
    return { ok: false, status: 409, error: "O texto foi alterado por outra operação. Recarregue a conferência." };
  }
  const novo = normalizarTexto(p.textoNovo);
  const guardado = normalizarTexto(p.trecho);
  if (p.abertura) {
    if (p.destino !== "substituir" || s !== 0) return { ok: false, status: 400, error: "Pedido inválido para a abertura." };
    if (novo.trim() === "") {
      return {
        ok: false, status: 400,
        error: "A abertura não pode ficar vazia. Para não narrá-la, desmarque “Narrar a abertura” — o texto fica guardado.",
      };
    }
  }

  const pt = p.posTitulo !== null && p.posTitulo >= 0 && p.posTitulo < s ? p.posTitulo : null;
  const corpoVazio = novo.trim() === "" && p.destino !== "substituir" && guardado.trim() !== "";
  let final: string;
  let deltaAntes = 0;
  let deltaApos: number;
  let posNovo: number | undefined;
  let tituloSaiu = false;
  let deltaCorpoSeguinte: number | null = null;
  let corpoSeguinte = 0;

  if (p.destino === "novo") {
    const titulo = p.tituloNovo.trim().slice(0, 120);
    if (!titulo || !guardado.trim()) return { ok: false, status: 400, error: "Informe o título do novo capítulo." };
    if (corpoVazio && pt !== null) {
      // O capítulo inteiro vira o novo: o título antigo sai.
      final = emendar(texto.slice(0, pt), titulo, guardado, texto.slice(e));
      posNovo = inicioDepois(emendar(texto.slice(0, pt)));
      tituloSaiu = true;
    } else {
      final = emendar(texto.slice(0, s), novo, titulo, guardado, texto.slice(e));
      posNovo = inicioDepois(emendar(texto.slice(0, s), novo));
    }
    deltaApos = deslocamento(texto, final, e);
  } else if (p.destino === "anterior" && pt !== null) {
    if (corpoVazio) {
      final = emendar(texto.slice(0, pt), guardado, texto.slice(e));
      tituloSaiu = true;
    } else {
      // O pedaço vai para o fim do capítulo anterior, antes do título deste.
      final = emendar(texto.slice(0, pt), guardado, texto.slice(pt, s), novo, texto.slice(e));
      deltaAntes = inicioDepois(emendar(texto.slice(0, pt), guardado)) - pt;
    }
    deltaApos = deslocamento(texto, final, e);
  } else if (p.destino === "seguinte" && e < texto.length) {
    // O pedaço vai para o começo do capítulo seguinte, logo depois do título dele.
    corpoSeguinte = corpoDoSeguinte(texto, e);
    if (corpoVazio && pt !== null) {
      final = emendar(texto.slice(0, pt), texto.slice(e, corpoSeguinte), guardado, texto.slice(corpoSeguinte));
      tituloSaiu = true;
      deltaApos = inicioDepois(emendar(texto.slice(0, pt))) - e;
    } else {
      final = emendar(texto.slice(0, s), novo, texto.slice(e, corpoSeguinte), guardado, texto.slice(corpoSeguinte));
      deltaApos = inicioDepois(emendar(texto.slice(0, s), novo)) - e;
    }
    deltaCorpoSeguinte = deslocamento(texto, final, corpoSeguinte);
  } else {
    final = emendar(texto.slice(0, s), novo, texto.slice(e));
    deltaApos = deslocamento(texto, final, e);
  }

  // Posições dos capítulos decididos, por faixa. Quando o capítulo editado
  // some (todo o texto foi para outro lugar), o título dele sai antes de mover
  // os outros, para não levar junto o capítulo que passa a ocupar a posição.
  const base = tituloSaiu && pt !== null ? capitulos.filter((c) => Math.abs(c.pos - pt) > 5) : capitulos;
  let lista = base.map((c) => {
    if (deltaCorpoSeguinte !== null) {
      if (c.pos < s) return c;
      if (c.pos >= corpoSeguinte) return { ...c, pos: c.pos + deltaCorpoSeguinte };
      if (c.pos >= e) return { ...c, pos: c.pos + deltaApos };
      return c;
    }
    if (c.pos < s) {
      const anterior = p.destino === "anterior" && p.posTitulo !== null;
      return anterior && c.pos >= (p.posTitulo as number) ? { ...c, pos: c.pos + deltaAntes } : c;
    }
    return c.pos >= e ? { ...c, pos: c.pos + deltaApos } : c;
  });
  if (posNovo !== undefined) {
    lista = [...lista, { titulo: p.tituloNovo.trim().slice(0, 120), pos: posNovo }].sort((a, b) => a.pos - b.pos);
  }

  return {
    ok: true,
    texto: final,
    capitulos: lista,
    delta_antes_de_s: deltaAntes,
    delta_apos_e: deltaApos,
    hash_novo: hashDoTexto(final),
    ...(posNovo !== undefined ? { capitulo_novo_pos: posNovo } : {}),
    ...(tituloSaiu ? { titulo_origem_removido: true as const } : {}),
  };
}

// ─── Capítulos narrados ─────────────────────────────────────────────────────

/**
 * Texto + capítulos decididos → capítulos narrados. O que vem antes do 1º
 * capítulo é a abertura (título vazio). A primeira linha de cada capítulo sai
 * do corpo quando é o título; capítulo marcado no meio de um parágrafo
 * começa exatamente ali. Sem capítulos, o livro inteiro é um capítulo com o
 * nome do livro.
 */
export function capitulosDoTexto(textoBruto: string, aprovados: CapituloAprovado[], tituloDoLivro: string): CapituloTexto[] {
  const texto = normalizarTexto(textoBruto);
  const validos = aprovados
    .filter((c) => Number.isFinite(c.pos) && c.pos >= 0 && c.pos < texto.length)
    .map((c) => {
      const ini = texto.lastIndexOf("\n", c.pos) + 1;
      return { titulo: c.titulo, pos: c.pos - ini <= 2 ? ini : c.pos };
    })
    .sort((a, b) => a.pos - b.pos);
  if (validos.length === 0) return [{ titulo: tituloDoLivro, texto: texto.trim() }];

  const r: CapituloTexto[] = [];
  const abertura = texto.slice(0, validos[0].pos).trim();
  if (abertura) r.push({ titulo: "", texto: abertura });
  validos.forEach((c, i) => {
    const fim = i + 1 < validos.length ? validos[i + 1].pos : texto.length;
    const corpo = texto.slice(c.pos, fim).trim();
    const nl = corpo.indexOf("\n");
    const primeira = (nl > -1 ? corpo.slice(0, nl) : corpo).trim();
    const ehTitulo = primeira.length <= 120 && (primeira.toLowerCase().startsWith(c.titulo.trim().toLowerCase().slice(0, 40)) || primeira.length <= 80);
    const semTitulo = !ehTitulo ? corpo : nl > -1 ? corpo.slice(nl).trim() : "";
    r.push({ titulo: c.titulo, texto: semTitulo });
  });
  return r;
}

/**
 * Corta o livro no limite da demonstração: entram capítulos inteiros
 * enquanto couberem; se nem o primeiro cabe, ele entra até o último
 * parágrafo que couber.
 */
export function cortarNoLimite(capitulos: CapituloTexto[], limite: number): { capitulos: CapituloTexto[]; cortado: boolean } {
  const r: CapituloTexto[] = [];
  let usados = 0;
  for (const c of capitulos) {
    if (usados + c.texto.length <= limite) {
      r.push(c);
      usados += c.texto.length;
      continue;
    }
    if (r.length === 0) {
      let texto = "";
      for (const p of c.texto.split("\n\n")) {
        const novo = texto ? `${texto}\n\n${p}` : p;
        if (novo.length > limite) break;
        texto = novo;
      }
      if (texto) r.push({ titulo: c.titulo, texto });
    }
    return { capitulos: r, cortado: true };
  }
  return { capitulos: r, cortado: false };
}
