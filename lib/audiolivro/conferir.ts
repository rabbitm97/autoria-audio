// lib/audiolivro/conferir.ts
//
// D60-A2. Conferência do áudio contra o texto: um modelo ouve o trecho e
// transcreve; aqui a transcrição é alinhada palavra a palavra com o texto
// falado (texto_fala). Reprova quando sobra um bloco de palavras que não está
// no texto (ex.: a instrução de estilo lida em voz alta, achado de 17/nov) ou
// falta um bloco do texto (frase pulada), ou quando a semelhança geral é baixa.
// Erros soltos de transcrição (nome próprio, uma palavra trocada) não
// reprovam: viram blocos de 1 ou 2 palavras.
//
// Números: horas, valores e ordinais já vêm por extenso no texto_fala, mas
// números soltos ("1962", "47") ficam em algarismos; a transcrição pode vir
// de um jeito ou de outro. Os DOIS lados passam pelas regras do normalizador
// e os números que sobrarem viram extenso antes de comparar.
//
// Módulo PURO (importa só módulos puros).

import { normalizarParaFala } from "./normalizar";
import { cardinal, decimalPorExtenso } from "./numeros";

export const CONFERENCIA_SEMELHANCA_MIN = 0.85;
/** Bloco seguido de palavras a mais ou a menos que reprova o trecho. */
export const CONFERENCIA_BLOCO_MAX = 5;

export interface ResultadoConferencia {
  ok: boolean;
  /** 0 a 1: 2 x palavras em comum / (palavras do texto + palavras ouvidas). */
  semelhanca: number;
  /** Maior bloco seguido de palavras do texto que não foram ouvidas. */
  maior_falta: number;
  /** Maior bloco seguido de palavras ouvidas que não estão no texto. */
  maior_sobra: number;
}

export function palavras(t: string): string[] {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Transcrição → mesma forma do texto_fala (regras do normalizador + números por extenso). */
export function prepararOuvido(ouvido: string): string {
  return normalizarParaFala(ouvido).replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g, (v) =>
    v.includes(",") ? decimalPorExtenso(v) : cardinal(Number(v.replace(/\./g, ""))),
  );
}

export function conferirTranscricao(textoFala: string, ouvido: string): ResultadoConferencia {
  // D60-B1.1: o texto falado também passa pela conversão de números ("1962"
  // fica no texto_fala em algarismos; a transcrição vem por extenso). Sem isso
  // todo ano virava bloco de 5 ou 6 palavras "a mais" e o trecho era refeito à toa.
  const a = palavras(prepararOuvido(textoFala));
  const b = palavras(prepararOuvido(ouvido));
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return { ok: n === 0 && m === 0, semelhanca: n === m ? 1 : 0, maior_falta: n, maior_sobra: m };
  }
  // Maior subsequência comum (tabela de (n+1) x (m+1)).
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // Caminha pelo alinhamento contando blocos seguidos de falta e de sobra.
  let i = 0;
  let j = 0;
  let falta = 0;
  let sobra = 0;
  let maiorFalta = 0;
  let maiorSobra = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++; j++; falta = 0; sobra = 0;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      j++; sobra++; falta = 0;
      if (sobra > maiorSobra) maiorSobra = sobra;
    } else {
      i++; falta++; sobra = 0;
      if (falta > maiorFalta) maiorFalta = falta;
    }
  }
  const semelhanca = Math.round(((2 * lcs[0][0]) / (n + m)) * 1000) / 1000;
  return {
    ok: semelhanca >= CONFERENCIA_SEMELHANCA_MIN && maiorFalta <= CONFERENCIA_BLOCO_MAX && maiorSobra <= CONFERENCIA_BLOCO_MAX,
    semelhanca,
    maior_falta: maiorFalta,
    maior_sobra: maiorSobra,
  };
}
