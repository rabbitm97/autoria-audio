// lib/adaptadores/deteccao.ts
//
// Proposta de capítulos sobre o texto do livro (um parágrafo por linha, linha
// em branco entre parágrafos). Mesmo comportamento da conferência de
// capítulos da Autoria, escrito de novo para a demonstração:
//   1. cada linha recebe a leitura mais forte entre sete padrões (marcador
//      "Capítulo N", título entre divisores, seção nomeada, título Markdown,
//      número isolado, linha em maiúsculas isolada, linha curta isolada);
//   2. linhas a até 5 caracteres uma da outra contam como uma só;
//   3. ajustes do conjunto: padrão dominante, índice remissivo, trecho curto,
//      título repetido e sequência de sumário;
//   4. no .docx, os estilos do Word decidem (Título = nome do livro,
//      maior nível de "Título N" = capítulo, níveis abaixo = intertítulo).
// Também: busca de uma linha no texto e reaplicação das decisões do autor.
// Módulo puro (sem banco e sem IA).

import type { CandidatoCapitulo, CapituloAprovado, OrigemCandidato, TituloWord } from "./tipos";

// ─── Padrões de linha ───────────────────────────────────────────────────────

const MAIUSCULA = /[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇ]/;
const LETRA = /[A-Za-zÁÀÂÃÉÈÊÍÏÓÔÕÚÜÇáàâãéèêíïóôõúüç]/;
const MARCADOR =
  /^(cap[íi]tulo|cap\.|parte)\s+(?:\d+|[ivxlcdm]+|primeiro|segundo|terceiro|quarto|quinto|sexto|sétimo|oitavo|nono|décimo|um|dois|três|quatro|cinco|seis|sete|oito|nove|dez)\b/i;
const SECAO =
  /^(prefácio|prólogo|epílogo|preâmbulo|introdução geral|introdução|conclusão|apresentação|posfácio|dedicatória|agradecimentos|sobre o autor|nota do autor|nota de edição|nota explicativa)/i;
const MARKDOWN = /^(#{1,3})\s+(.+)$/;
const SO_DIVISOR = /^[─━═=—\s]+$/;
const MOLDURA = /[│┃╎╏║▌▐]/;

const palavras = (s: string) => s.split(/\s+/).filter(Boolean).length;
const arred = (n: number) => Math.round(n * 1000) / 1000;

function ehDivisor(linha: string): boolean {
  const t = linha.trim();
  return t.length >= 5 && /^[─━═=—]+$/.test(t);
}

function ehMaiusculas(s: string): boolean {
  return s.length >= 2 && s.length <= 100 && MAIUSCULA.test(s) && s === s.toUpperCase();
}

function ehNumero(s: string): boolean {
  if (/^\d{1,2}\.?$/.test(s)) return true;
  return /^(?:X{0,3})(?:IX|IV|V?I{0,3})\.?$/i.test(s) && s.replace(/\./g, "").trim().length > 0;
}

/** Fala de diálogo ou citação nunca é título de capítulo. */
function ehFala(s: string): boolean {
  return /^[—–]\s?/.test(s) || /^["“«]/.test(s);
}

interface Leitura {
  titulo: string;
  origem: OrigemCandidato;
  score: number;
  sugerido: boolean;
}

/** A leitura mais forte de uma linha (empate: o padrão listado antes). */
function lerLinha(linhas: string[], i: number): Leitura | null {
  const bruta = linhas[i];
  const t = bruta.trim();
  if (!t) return null;
  const antesVazia = i === 0 || linhas[i - 1].trim() === "";
  const depoisVazia = i >= linhas.length - 1 || linhas[i + 1].trim() === "";
  const isolada = antesVazia && depoisVazia;
  const fala = ehFala(t);
  const opcoes: Leitura[] = [];

  if (MARCADOR.test(t)) opcoes.push({ titulo: t, origem: "marcador_explicito", score: 0.98, sugerido: true });
  if (
    !fala && i > 0 && i < linhas.length - 1 &&
    ehDivisor(linhas[i - 1]) && ehDivisor(linhas[i + 1]) && ehMaiusculas(t) && palavras(t) <= 15
  ) {
    opcoes.push({ titulo: t, origem: "marcador_divisor", score: 0.92, sugerido: true });
  }
  if (antesVazia && SECAO.test(t)) opcoes.push({ titulo: t, origem: "secao_nomeada", score: 0.9, sugerido: true });
  const md = bruta.match(MARKDOWN);
  if (md) opcoes.push({ titulo: md[2].trim(), origem: "markdown_heading", score: 0.88, sugerido: true });

  if (!fala && isolada) {
    if (ehNumero(t)) opcoes.push({ titulo: t, origem: "numero_isolado", score: 0.55, sugerido: false });
    const caixaAlta = MAIUSCULA.test(t) && t === t.toUpperCase();
    if (caixaAlta && palavras(t) <= 10 && t.length <= 80 && !SO_DIVISOR.test(t)) {
      if (t.length === 1) opcoes.push({ titulo: t, origem: "all_caps_isolado", score: 0.05, sugerido: false });
      else if (MOLDURA.test(t)) opcoes.push({ titulo: t, origem: "all_caps_isolado", score: 0.1, sugerido: false });
      else opcoes.push({ titulo: t, origem: "all_caps_isolado", score: 0.4, sugerido: true });
    }
    if (
      t.length >= 2 && t.length <= 80 && palavras(t) <= 10 && LETRA.test(t) && !caixaAlta &&
      !/[.!?,;:]$/.test(t) && !SO_DIVISOR.test(t)
    ) {
      opcoes.push({ titulo: t, origem: "linha_curta_isolada", score: 0.3, sugerido: false });
    }
  }
  return opcoes.reduce<Leitura | null>((melhor, o) => (!melhor || o.score > melhor.score ? o : melhor), null);
}

function previas(texto: string, pos: number) {
  return {
    preview_antes: texto.slice(Math.max(0, pos - 60), pos).replace(/\n/g, " ").trim(),
    preview_depois: texto.slice(pos, pos + 400).replace(/\n/g, " ").trim(),
  };
}

/** Palavras de cada candidato até o próximo (lista já em ordem de posição). */
function contarSegmentos(lista: CandidatoCapitulo[], texto: string) {
  lista.forEach((c, i) => {
    const fim = i + 1 < lista.length ? lista[i + 1].pos : texto.length;
    c.palavras_no_segmento = palavras(texto.slice(c.pos, fim));
  });
}

// ─── Proposta ───────────────────────────────────────────────────────────────

export function proporCapitulos(textoBruto: string): CandidatoCapitulo[] {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  const linhas = texto.split("\n");

  const lidos: CandidatoCapitulo[] = [];
  let inicio = 0;
  linhas.forEach((_, i) => {
    const leitura = lerLinha(linhas, i);
    if (leitura) lidos.push({ id: "", ...leitura, pos: inicio, ...previas(texto, inicio), palavras_no_segmento: 0 });
    inicio += linhas[i].length + 1;
  });

  // Linhas a até 5 caracteres uma da outra: fica a de maior score.
  const lista: CandidatoCapitulo[] = [];
  for (const c of lidos) {
    const k = lista.findIndex((d) => Math.abs(d.pos - c.pos) <= 5);
    if (k < 0) lista.push(c);
    else if (c.score > lista[k].score) lista[k] = c;
  }
  contarSegmentos(lista, texto);

  // Padrão dominante: 3 ou mais "Capítulo N" rebaixam maiúsculas e números isolados.
  if (lista.filter((c) => c.origem === "marcador_explicito").length >= 3) {
    for (const c of lista) {
      if (c.origem === "all_caps_isolado" || c.origem === "numero_isolado") {
        c.sugerido = false;
        c.score = arred(c.score * 0.4);
      }
    }
  }

  // Letras soltas na segunda metade do livro: índice remissivo.
  const letras = lista.filter((c) => c.titulo.trim().length === 1 && c.pos > texto.length / 2);
  if (letras.length >= 4) {
    for (const c of letras) {
      c.sugerido = false;
      c.score = 0.05;
      c.motivo_descartado = "provavelmente índice remissivo";
    }
  }

  // Menos de 50 palavras até o próximo: não parece corpo de capítulo.
  for (const c of lista) {
    if (c.palavras_no_segmento >= 50) continue;
    c.sugerido = false;
    c.score = arred(c.score * 0.5);
    c.motivo_descartado ??= `trecho curto (${c.palavras_no_segmento} palavras) — provavelmente sumário ou cabeçalho de página`;
  }

  // Mesmo título mais de uma vez: as cópias sem corpo são sumário ou cabeçalho.
  const porTitulo = new Map<string, CandidatoCapitulo[]>();
  for (const c of lista) {
    const k = c.titulo.trim().toLowerCase().replace(/\s+/g, " ");
    porTitulo.set(k, [...(porTitulo.get(k) ?? []), c]);
  }
  for (const grupo of porTitulo.values()) {
    if (grupo.length < 2) continue;
    for (const c of grupo.filter((g) => g.palavras_no_segmento < 50)) {
      c.sugerido = false;
      c.score = Math.min(c.score, 0.1);
      c.motivo_descartado = "título repetido no texto — provavelmente sumário ou cabeçalho de página";
      c.bloqueado_ia = true;
    }
  }

  // 3 ou mais seguidos sem corpo: desenho de sumário.
  let i = 0;
  while (i < lista.length) {
    let j = i;
    while (j < lista.length && lista[j].palavras_no_segmento < 50) j++;
    if (j - i >= 3) {
      for (const c of lista.slice(i, j)) {
        c.sugerido = false;
        c.score = Math.min(c.score, 0.1);
        c.bloqueado_ia = true;
        c.motivo_descartado = "sequência de títulos sem texto entre eles — provavelmente sumário";
      }
    }
    i = j + 1;
  }

  lista.forEach((c, k) => (c.id = `cand-${k}`));
  return lista;
}

// ─── Estilos do Word ────────────────────────────────────────────────────────

const chave = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const ORIGENS_FRACAS: OrigemCandidato[] = ["all_caps_isolado", "linha_curta_isolada", "markdown_heading"];

/**
 * Aplica os estilos do .docx e o nome do livro aos candidatos (no lugar).
 * Devolve os ids decididos aqui, que ficam fora da conferência por IA.
 */
export function aplicarTitulosDoWord(
  candidatos: CandidatoCapitulo[],
  textoBruto: string,
  titulosWord: TituloWord[],
  tituloDoLivro: string,
): Set<string> {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  const decididos = new Set<string>();

  const numeros = titulosWord.map((t) => t.nivel).filter((n): n is number => typeof n === "number");
  const nivelCapitulo = numeros.length ? Math.min(...numeros) : 1;
  const tipo = new Map<string, "livro" | "capitulo" | "intertitulo">();
  const capitulos: string[] = [];
  for (const t of titulosWord) {
    const k = chave(t.texto);
    if (!k) continue;
    const qual = t.nivel === "titulo" ? "livro" : t.nivel <= nivelCapitulo ? "capitulo" : "intertitulo";
    if (!tipo.has(k)) tipo.set(k, qual);
    if (qual === "capitulo") capitulos.push(k);
  }

  // Capítulo marcado no Word que nenhum padrão pegou entra na lista.
  if (capitulos.length > 0) {
    const procurados = new Set(capitulos);
    const ja = new Set(candidatos.map((c) => chave(c.titulo)));
    let inicio = 0;
    for (const linha of texto.split("\n")) {
      const k = chave(linha);
      if (k && procurados.has(k) && !ja.has(k)) {
        candidatos.push({
          id: "", titulo: linha.trim(), pos: inicio, origem: "estilo_word", score: 0.95, sugerido: true,
          ...previas(texto, inicio), palavras_no_segmento: 0,
        });
        ja.add(k);
      }
      inicio += linha.length + 1;
    }
    candidatos.sort((a, b) => a.pos - b.pos);
    contarSegmentos(candidatos, texto);
    candidatos.forEach((c, k) => (c.id = `cand-${k}`));
  }

  const usaCapitulosDoWord = capitulos.length >= 2;
  const nomeDoLivro = chave(tituloDoLivro);
  const primeiro = candidatos[0];
  for (const c of candidatos) {
    if (c.origem === "manual") continue;
    const qual = tipo.get(chave(c.titulo));
    const noTopo = c === primeiro && texto.slice(0, c.pos).trim() === "";
    if (qual === "livro" || (noTopo && nomeDoLivro && chave(c.titulo) === nomeDoLivro)) {
      c.sugerido = false;
      c.motivo_descartado = "título do livro — fica na abertura";
    } else if (qual === "capitulo") {
      c.sugerido = true;
      c.origem = "estilo_word";
      c.score = Math.max(c.score, 0.95);
      delete c.motivo_descartado;
    } else if (qual === "intertitulo") {
      c.sugerido = false;
      c.motivo_descartado = "intertítulo (Título 2 ou menor no Word) — fica dentro do capítulo";
    } else if (usaCapitulosDoWord && ORIGENS_FRACAS.includes(c.origem)) {
      c.sugerido = false;
      c.motivo_descartado = "o livro marca os capítulos com Título 1 do Word";
    } else {
      continue;
    }
    decididos.add(c.id);
  }
  return decididos;
}

// ─── Decisões anteriores do autor ───────────────────────────────────────────

/**
 * Reaplica a lista que o autor já decidiu (quando as posições ainda valem):
 * candidato perto de um aprovado fica marcado com o título do autor; aprovado
 * sem candidato entra como "manual"; o resto fica desmarcado.
 */
export function reaplicarDecisoes(candidatos: CandidatoCapitulo[], textoBruto: string, aprovados: CapituloAprovado[]): void {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  let n = 0;
  for (const a of aprovados) {
    const perto = candidatos.find((c) => Math.abs(c.pos - a.pos) <= 5);
    if (perto) {
      perto.sugerido = true;
      perto.titulo = a.titulo;
      continue;
    }
    const proximo = aprovados.filter((b) => b.pos > a.pos).reduce((m, b) => Math.min(m, b.pos), texto.length);
    candidatos.push({
      id: `reidratado-manual-${n++}`, titulo: a.titulo, pos: a.pos, origem: "manual", score: 1, sugerido: true,
      preview_antes: texto.slice(Math.max(0, a.pos - 200), a.pos).replace(/\n/g, " ").trim(),
      preview_depois: texto.slice(a.pos, a.pos + 400).replace(/\n/g, " ").trim(),
      palavras_no_segmento: palavras(texto.slice(a.pos, proximo)),
    });
  }
  for (const c of candidatos) {
    if (c.origem !== "manual" && !aprovados.some((a) => Math.abs(a.pos - c.pos) <= 5)) c.sugerido = false;
  }
}

// ─── Busca de uma linha ─────────────────────────────────────────────────────

export interface Ocorrencia {
  pos: number;
  linha: string;
  contexto_antes: string;
  contexto_depois: string;
  alinhada_a_linha: boolean;
}

/** Até 5 ocorrências do termo; no começo da linha, o capítulo começa na linha. */
export function buscarNoTexto(textoBruto: string, termo: string): Ocorrencia[] {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  const baixo = texto.toLowerCase();
  const alvo = termo.toLowerCase();
  const achadas: Ocorrencia[] = [];
  let de = 0;
  while (achadas.length < 5) {
    const k = baixo.indexOf(alvo, de);
    if (k < 0) break;
    const ini = texto.lastIndexOf("\n", k - 1) + 1;
    const nl = texto.indexOf("\n", k);
    const fim = nl >= 0 ? nl : texto.length;
    const alinhada = k - ini <= 2 || texto.slice(ini, k).trim() === "";
    achadas.push({
      pos: alinhada ? ini : k,
      linha: alinhada ? texto.slice(ini, fim).trim().slice(0, 120) : texto.slice(k, k + termo.length + 60).trim(),
      contexto_antes: texto.slice(Math.max(0, ini - 200), ini).replace(/\s+/g, " ").trim(),
      contexto_depois: texto.slice(fim + 1, fim + 401).replace(/\s+/g, " ").trim(),
      alinhada_a_linha: alinhada,
    });
    de = fim + 1;
  }
  return achadas;
}
