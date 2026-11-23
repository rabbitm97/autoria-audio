// lib/adaptadores/manuscrito.ts
//
// Texto do manuscrito em blocos (títulos e parágrafos), a partir de .docx,
// .pdf ou .txt. Os blocos são a base da proposta de capítulos e da aprovação.
//   .docx: mammoth (código aberto) → HTML simples; Título 1/2/3 do Word viram
//          blocos de título, o resto parágrafos. Imagens são ignoradas.
//   .pdf:  unpdf (código aberto) → linhas por página; cabeçalho, rodapé e
//          número de página repetidos saem; linhas viram parágrafos e a palavra
//          hifenizada no fim da linha é emendada.
//   .txt:  parágrafos separados por linha em branco (ou uma linha por
//          parágrafo, quando o arquivo não tem linhas em branco).

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { Bloco } from "./tipos";

export type FormatoManuscrito = "docx" | "pdf" | "txt";

export function formatoDoNome(nome: string): FormatoManuscrito | null {
  const m = /\.(docx|pdf|txt)$/i.exec(nome.trim());
  return m ? (m[1].toLowerCase() as FormatoManuscrito) : null;
}

const espacos = (s: string) => s.replace(/[ \t ]+/g, " ").trim();

// ─── .docx ──────────────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function textoDoHtml(html: string): string {
  return espacos(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === "#") {
          const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTIDADES[e.toLowerCase()] ?? m;
      }),
  );
}

async function blocosDoDocx(buffer: Buffer): Promise<Bloco[]> {
  const { value } = await mammoth.convertToHtml(
    { buffer },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  const r: Bloco[] = [];
  for (const m of value.matchAll(/<(h[1-6]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    const x = textoDoHtml(m[2]);
    if (!x) continue;
    r.push({ t: tag === "p" ? "p" : tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3", x });
  }
  return r;
}

// ─── .txt ───────────────────────────────────────────────────────────────────

function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function blocosDoTxt(bytes: Uint8Array): Bloco[] {
  const texto = decodificar(bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const temLinhaEmBranco = /\n[ \t]*\n/.test(texto);
  const partes = temLinhaEmBranco ? texto.split(/\n[ \t]*\n+/).map((p) => p.replace(/\n/g, " ")) : texto.split("\n");
  return partes.map(espacos).filter(Boolean).map((x) => ({ t: "p" as const, x }));
}

// ─── .pdf ───────────────────────────────────────────────────────────────────

/** Linha que é só número de página ("12", "- 12 -", "xii"). */
const SO_PAGINA = /^[-–—\s]*(\d{1,4}|[ivxlc]{1,6})[-–—\s]*$/i;
const FIM_DE_FRASE = /[.!?…:;"”»)]$/;
const PARECE_TITULO =
  /^(cap[ií]tulo|parte|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o|apresenta[cç][aã]o|pref[aá]cio|posf[aá]cio|conclus[aã]o)\b|^(\d{1,3}|[IVXLC]{1,7})[.)]?$/i;

function mediana(ns: number[]): number {
  if (!ns.length) return 0;
  const o = [...ns].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

async function blocosDoPdf(bytes: Uint8Array): Promise<Bloco[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const paginas = text.map((p) => p.split("\n").map(espacos).filter(Boolean));

  // Cabeçalho e rodapé: linha (com números trocados por #) que se repete no
  // começo ou no fim de muitas páginas.
  const chave = (l: string) => l.replace(/\d+/g, "#").toLowerCase();
  const contagem = new Map<string, number>();
  for (const p of paginas) {
    const pontas = new Set([...p.slice(0, 2), ...p.slice(-2)].map(chave));
    for (const k of pontas) contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  const minimo = Math.max(3, Math.ceil(paginas.length * 0.3));
  // Cabeçalho é curto e não termina como linha de texto corrido.
  const repetida = (l: string) => l.length <= 60 && !/[-,;]$/.test(l) && (contagem.get(chave(l)) ?? 0) >= minimo;

  const linhas: string[] = [];
  for (const p of paginas) {
    p.forEach((l, i) => {
      const ponta = i < 2 || i >= p.length - 2;
      if (ponta && (repetida(l) || SO_PAGINA.test(l))) return;
      linhas.push(l);
    });
  }

  const tipica = mediana(linhas.filter((l) => l.length > 20).map((l) => l.length));
  const r: Bloco[] = [];
  let atual = "";
  const fechar = () => {
    if (atual) r.push({ t: "p", x: atual });
    atual = "";
  };
  for (const l of linhas) {
    if (l.length <= 80 && PARECE_TITULO.test(l)) {
      fechar();
      r.push({ t: "p", x: l });
      continue;
    }
    if (atual && /^[—–-]\s/.test(l)) fechar(); // fala de diálogo começa parágrafo
    if (!atual) {
      atual = l;
    } else if (/[A-Za-zÀ-ÿ]-$/.test(atual) && /^[a-zà-ÿ]/.test(l)) {
      atual = atual.slice(0, -1) + l; // pala- / vra
    } else {
      atual = `${atual} ${l}`;
    }
    // Linha curta terminando em ponto: fim de parágrafo.
    if (FIM_DE_FRASE.test(l) && tipica > 0 && l.length < tipica * 0.8) fechar();
  }
  fechar();
  return r;
}

// ─── Entrada ────────────────────────────────────────────────────────────────

export async function blocosDoManuscrito(bytes: Uint8Array, formato: FormatoManuscrito): Promise<Bloco[]> {
  if (formato === "docx") return blocosDoDocx(Buffer.from(bytes));
  if (formato === "pdf") return blocosDoPdf(bytes);
  return blocosDoTxt(bytes);
}
