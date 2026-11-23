// lib/adaptadores/capitulos.ts
//
// Lê um .docx e devolve os capítulos (título + texto). Usa o mammoth
// (código aberto) para converter o documento em HTML simples e procura os
// títulos de capítulo nesta ordem:
//   1. estilos de título do Word (Título 1, ou Título 2 se o 1 for só o nome do livro);
//   2. parágrafos curtos que começam com "Capítulo", "Parte", "Prólogo"...
//      ou são só um número (1, 2, IV);
//   3. nenhum título achado: o texto inteiro vira um capítulo só.
// Texto antes do primeiro título (folha de rosto, dedicatória) fica de fora
// quando é curto.

import mammoth from "mammoth";
import type { CapituloTexto } from "./tipos";

interface Bloco {
  tipo: "h1" | "h2" | "h3" | "p";
  texto: string;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function textoDoHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTIDADES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .trim();
}

function blocos(html: string): Bloco[] {
  const r: Bloco[] = [];
  const re = /<(h[1-6]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[1].toLowerCase();
    const texto = textoDoHtml(m[2]);
    if (!texto) continue;
    const tipo: Bloco["tipo"] = tag === "h1" ? "h1" : tag === "h2" ? "h2" : tag === "p" ? "p" : "h3";
    r.push({ tipo, texto });
  }
  return r;
}

const TITULO_POR_TEXTO =
  /^(cap[ií]tulo|parte|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o|apresenta[cç][aã]o|pref[aá]cio|posf[aá]cio|conclus[aã]o)\b/i;
const SO_NUMERO = /^(\d{1,3}|[IVXLC]{1,7})[.)]?$/;

function pareceTitulo(b: Bloco): boolean {
  return b.texto.length <= 80 && (TITULO_POR_TEXTO.test(b.texto) || SO_NUMERO.test(b.texto));
}

/** Texto antes do primeiro capítulo menor que isso (folha de rosto, dedicatória) fica de fora. */
const ABERTURA_MINIMA = 300;

export interface LeituraDocx {
  capitulos: CapituloTexto[];
  /** Como os capítulos foram achados (mostrado ao autor). */
  criterio: "estilos" | "texto" | "unico";
}

export function capitulosDosBlocos(lista: Bloco[]): LeituraDocx {
  const h1 = lista.filter((b) => b.tipo === "h1").length;
  const h2 = lista.filter((b) => b.tipo === "h2").length;
  let ehTitulo: ((b: Bloco) => boolean) | null = null;
  let criterio: LeituraDocx["criterio"] = "unico";
  if (h1 >= 2) {
    ehTitulo = (b) => b.tipo === "h1";
    criterio = "estilos";
  } else if (h2 >= 2) {
    ehTitulo = (b) => b.tipo === "h2";
    criterio = "estilos";
  } else if (lista.filter(pareceTitulo).length >= 2) {
    ehTitulo = pareceTitulo;
    criterio = "texto";
  }

  const capitulos: CapituloTexto[] = [];
  let atual: CapituloTexto = { titulo: "", texto: "" };
  const fechar = () => {
    const texto = atual.texto.trim();
    if (atual.titulo === "" && texto.length < ABERTURA_MINIMA && ehTitulo) return; // folha de rosto
    if (texto || atual.titulo) capitulos.push({ titulo: atual.titulo, texto });
  };
  for (const b of lista) {
    if (ehTitulo && ehTitulo(b)) {
      fechar();
      atual = { titulo: b.texto, texto: "" };
      continue;
    }
    // Com títulos por estilo, um h1 isolado (nome do livro no começo) não vira texto falado.
    if (ehTitulo && b.tipo !== "p" && atual.titulo === "" && atual.texto === "") continue;
    atual.texto += (atual.texto ? "\n\n" : "") + b.texto;
  }
  fechar();
  return { capitulos: capitulos.filter((c) => c.texto.length > 0), criterio };
}

export async function lerDocx(buffer: Buffer): Promise<LeituraDocx> {
  const { value } = await mammoth.convertToHtml({ buffer });
  return capitulosDosBlocos(blocos(value));
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
      const partes = c.texto.split("\n\n");
      let texto = "";
      for (const p of partes) {
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
