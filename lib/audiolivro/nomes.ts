// lib/audiolivro/nomes.ts
//
// D60-B2. Créditos falados e nomes dos arquivos do audiolivro.
//   Créditos: as lojas pedem um arquivo de abertura (título, autor) e um de
//   encerramento. D60-B2d: sem "Narrado por voz digital." no áudio (decisão de
//   19/nov): o aviso de narração digital vai nos dados da loja (campo do
//   narrador / opção de narração digital), não falado. Entram como dois segmentos a mais, com índices
//   negativos para nunca colidir com os capítulos do livro (0, 1, 2...).
//   Nomes: "03 - Capítulo 1 — A chegada.mp3", numerados na ordem do
//   audiolivro, contando só o que é narrado (ordem alfabética = ordem certa,
//   como o Google Play lê um ZIP).
//
// Módulo PURO (zero imports): usado no servidor e na tela.

export const CREDITOS_INICIAIS = -1;
export const CREDITOS_FINAIS = -2;

export const TITULO_CREDITOS_INICIAIS = "Créditos iniciais";
export const TITULO_CREDITOS_FINAIS = "Créditos finais";

function frase(t: string): string {
  const s = t.trim();
  if (!s) return "";
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/** Texto falado dos créditos. Sem autor cadastrado, a frase do autor sai. */
export function textoCreditos(titulo: string, subtitulo: string, autor: string): { inicio: string; fim: string } {
  const t = titulo.trim();
  const a = autor.trim();
  const inicio = [frase(t), frase(subtitulo), a ? `Escrito por ${a}.` : ""]
    .filter(Boolean)
    .join(" ");
  const fim = ["Fim.", t ? frase(`Você ouviu ${t}${a ? `, de ${a}` : ""}`) : ""].filter(Boolean).join(" ");
  return { inicio, fim };
}

/** Nome do segmento para a tela e para o arquivo ("" = abertura do livro). */
export function nomeSegmento(titulo: string): string {
  return titulo.trim() || "Abertura";
}

/** Tira o que o Windows e o macOS não aceitam em nome de arquivo. */
function limparNome(t: string): string {
  const semControle = Array.from(t).filter((ch) => ch.charCodeAt(0) >= 32).join("");
  return semControle.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90).trim();
}

/**
 * Nome do arquivo de cada segmento narrado, na ordem do audiolivro.
 * Recebe a lista na ordem em que é tocada (créditos iniciais, capítulos,
 * créditos finais); segmento sem trechos não ganha arquivo nem número.
 */
export function nomesDosArquivos(segmentos: { index: number; titulo: string; trechos: number }[]): Map<number, string> {
  const narrados = segmentos.filter((s) => s.trechos > 0);
  const largura = Math.max(2, String(narrados.length).length);
  const nomes = new Map<number, string>();
  narrados.forEach((s, i) => {
    nomes.set(s.index, `${String(i + 1).padStart(largura, "0")} - ${limparNome(nomeSegmento(s.titulo))}.mp3`);
  });
  return nomes;
}

/** "Capítulo 1 — A chegada - trecho 2.mp3" */
export function nomeArquivoTrecho(tituloSegmento: string, ordem: number): string {
  return `${limparNome(nomeSegmento(tituloSegmento))} - trecho ${ordem + 1}.mp3`;
}
