// lib/adaptadores/manuscrito.ts
//
// Texto do manuscrito a partir de .docx, .pdf ou .txt, com um parágrafo por
// linha e uma linha em branco entre parágrafos (o formato em que a proposta
// de capítulos e o editor de texto trabalham).
//   .docx: mammoth (código aberto) → HTML simples; cada parágrafo e cada título
//          vira um parágrafo do texto. Os títulos marcados com estilo no Word
//          (Título, Título 1, 2, 3…) ficam guardados à parte para orientar a
//          proposta de capítulos. Imagens são ignoradas.
//   .pdf:  unpdf (código aberto) → linhas por página; cabeçalho, rodapé e
//          número de página repetidos saem; linhas viram parágrafos e a palavra
//          hifenizada no fim da linha é emendada.
//   .txt:  o texto como está no arquivo.

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { TituloWord } from "./tipos";

interface Bloco {
  /** "p" = parágrafo; "titulo" = estilo Título; 1-6 = Título N. */
  t: "p" | "titulo" | number;
  x: string;
}

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
    {
      // O estilo Título (nome do livro) sai com classe própria.
      styleMap: ["p[style-name='Title'] => h1.titulo-do-livro:fresh", "p[style-name='Título'] => h1.titulo-do-livro:fresh"],
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    },
  );
  const r: Bloco[] = [];
  for (const m of value.matchAll(/<(h[1-6]|p)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    const x = textoDoHtml(m[3]);
    if (!x) continue;
    if (tag === "p") r.push({ t: "p", x });
    else if (/titulo-do-livro/.test(m[2] ?? "")) r.push({ t: "titulo", x });
    else r.push({ t: Number(tag[1]), x });
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

function textoDoTxt(bytes: Uint8Array): string {
  return decodificar(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
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

export interface TextoDoManuscrito {
  texto: string;
  titulosWord: TituloWord[];
}

export async function lerArquivoDoManuscrito(bytes: Uint8Array, formato: FormatoManuscrito): Promise<TextoDoManuscrito> {
  if (formato === "txt") return { texto: textoDoTxt(bytes), titulosWord: [] };
  const blocos = formato === "docx" ? await blocosDoDocx(Buffer.from(bytes)) : await blocosDoPdf(bytes);
  return {
    texto: blocos.map((b) => b.x).join("\n\n"),
    titulosWord: blocos.filter((b) => b.t !== "p").map((b) => ({ texto: b.x, nivel: b.t as TituloWord["nivel"] })),
  };
}
