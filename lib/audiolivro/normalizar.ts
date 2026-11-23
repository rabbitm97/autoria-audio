// lib/audiolivro/normalizar.ts
//
// D60-A. Prepara o texto de um trecho para a narração: o que o leitor lê com os
// olhos ("14h30", "R$ 12,50", "1º", "Sr.") vira o que o narrador fala
// ("catorze e trinta", "doze reais e cinquenta centavos", "primeiro",
// "senhor"). Determinístico: o modelo de voz erra justamente nesses pontos
// (teste de 15/nov), e a regra fixa não depende da instrução de estilo.
// Números soltos ("12 mil", "1987") ficam com o modelo, que os lê bem e
// acerta o gênero pelo contexto.
//
// Módulo PURO (importa só ./numeros).

import { cardinal, ordinal, decimalPorExtenso, lerNumeroBr, romanoParaNumero } from "./numeros";

export interface Pronuncia {
  /** Como está escrito no livro ("Ailisk Furi"). */
  grafia: string;
  /** Como o narrador deve falar ("Ái-lisk Fúri"). */
  fala: string;
}

const LIMITE_ESQ = "(?<![\\p{L}\\p{N}])";
const LIMITE_DIR = "(?![\\p{L}\\p{N}])";

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mantém a maiúscula inicial da palavra trocada ("Sr." no começo da frase). */
function comCaixa(original: string, troca: string): string {
  const primeira = original.charAt(0);
  return primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase()
    ? troca.charAt(0).toUpperCase() + troca.slice(1)
    : troca;
}

function aplicarPronuncias(t: string, pronuncias: Pronuncia[]): string {
  // Grafias mais longas primeiro: "Ana Lúcia" antes de "Ana".
  const ordenadas = [...pronuncias]
    .filter((p) => p.grafia.trim() && p.fala.trim())
    .sort((a, b) => b.grafia.trim().length - a.grafia.trim().length);
  let r = t;
  for (const p of ordenadas) {
    const re = new RegExp(`${LIMITE_ESQ}${escaparRegex(p.grafia.trim())}${LIMITE_DIR}`, "gu");
    r = r.replace(re, p.fala.trim());
  }
  return r;
}

function limparCaracteres(t: string): string {
  return t
    .replace(/\u00A0|\u2007|\u202F/g, " ")
    .replace(/\u00AD|\u200B|\u200C|\u200D|\uFEFF/g, "")
    // Linhas só de símbolos (separador de cena "* * *", "———") saem: a
    // pausa vem da quebra de parágrafo, o símbolo não é lido.
    .split("\n")
    .filter((linha) => !/^[\s*#~_=•·.\-–—]+$/.test(linha) || linha.trim() === "")
    .join("\n")
    .replace(/[ \t]+/g, " ");
}

function reais(valor: string, escala?: string): string {
  if (escala) {
    const e = escala.toLowerCase();
    const n = decimalPorExtenso(valor);
    return e === "mil" ? `${n} mil reais` : `${n} ${e} de reais`;
  }
  const [inteira, fracao] = valor.replace(/\./g, "").split(",");
  const r = Number(inteira);
  const c = fracao ? Number((fracao + "0").slice(0, 2)) : 0;
  const partes: string[] = [];
  if (r > 0) {
    const deReais = r % 1_000_000 === 0;
    partes.push(`${cardinal(r)} ${deReais ? "de " : ""}${r === 1 ? "real" : "reais"}`);
  }
  if (c > 0) partes.push(`${cardinal(c)} ${c === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}

function horas(h: number, m: number | null): string {
  if (m === null || m === 0) return `${cardinal(h, "f")} ${h === 1 ? "hora" : "horas"}`;
  return `${cardinal(h, "f")} e ${cardinal(m)}`;
}

const ABREVIACOES: [RegExp, string][] = [
  [/(?<![\p{L}])Sras\.(?=\s)/gu, "senhoras"],
  [/(?<![\p{L}])Srs\.(?=\s)/gu, "senhores"],
  [/(?<![\p{L}])Srta\.(?=\s)/gu, "senhorita"],
  [/(?<![\p{L}])Sra\.(?=\s)/gu, "senhora"],
  [/(?<![\p{L}])Sr\.(?=\s)/gu, "senhor"],
  [/(?<![\p{L}])Dra\.(?=\s)/gu, "doutora"],
  [/(?<![\p{L}])Drs\.(?=\s)/gu, "doutores"],
  [/(?<![\p{L}])Dr\.(?=\s)/gu, "doutor"],
  [/(?<![\p{L}])Profa\.(?=\s)/gu, "professora"],
  [/(?<![\p{L}])Prof\.(?=\s)/gu, "professor"],
  [/(?<![\p{L}])Av\.(?=\s)/gu, "avenida"],
  // "etc." no fim da frase guarda o ponto final (a pausa da frase).
  [/(?<![\p{L}])etc\.(?=\s*$|\s+[\p{Lu}"“—])/gu, "etcétera."],
  [/(?<![\p{L}])etc\./gu, "etcétera"],
  [/(?<![\p{L}])p\. ?ex\./gu, "por exemplo"],
];

const UNIDADES_MEDIDA: [RegExp, string, string][] = [
  // [padrão depois do número, singular, plural]
  [/^km\/h(?![\p{L}])/u, "quilômetro por hora", "quilômetros por hora"],
  [/^km(?![\p{L}])/u, "quilômetro", "quilômetros"],
  [/^kg(?![\p{L}])/u, "quilo", "quilos"],
  [/^cm(?![\p{L}])/u, "centímetro", "centímetros"],
  [/^m²/u, "metro quadrado", "metros quadrados"],
];

const ANTES_DE_ROMANO = /(?<![\p{L}])(cap[íi]tulo|parte|livro|volume|ato|cena|s[ée]culo)\s+([IVXLCDM]{1,7})(?![\p{L}\p{N}])/giu;

/**
 * Texto do livro → texto falado. A ordem importa: pronúncias primeiro (o autor
 * manda), depois dinheiro e porcentagem (que contêm números), horas,
 * temperatura, ordinais, abreviações, medidas e algarismos romanos.
 */
export function normalizarParaFala(texto: string, pronuncias: Pronuncia[] = []): string {
  let t = aplicarPronuncias(texto, pronuncias);
  t = limparCaracteres(t);

  // Dinheiro: "R$ 12,50", "R$ 1.200", "R$ 3 mil", "R$ 1,5 milhão".
  t = t.replace(
    /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?:\s(mil|milhão|milhões|bilhão|bilhões)(?![\p{L}]))?/gu,
    (_m, valor: string, escala?: string) => reais(valor, escala),
  );

  // Porcentagem: "12%", "2,5 %".
  t = t.replace(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s?%/g, (_m, v: string) =>
    lerNumeroBr(v) === null ? _m : `${decimalPorExtenso(v)} por cento`,
  );

  // Horas: "14h30", "14h", "8h05min", "14 h".
  t = t.replace(
    /(?<![\p{L}\p{N}])([01]?\d|2[0-3])\s?h\s?([0-5]\d)?(?:\s?min)?(?![\p{L}\p{N}])/gu,
    (_m, h: string, m?: string) => horas(Number(h), m ? Number(m) : null),
  );
  // Horas com dois-pontos só depois de "às", "das", "até"... ("João 3:16" fica).
  t = t.replace(
    /(?<![\p{L}])(às|as|das|até|pelas|entre|e)\s+([01]?\d|2[0-3]):([0-5]\d)(?![\p{N}])/giu,
    (_m, prep: string, h: string, m: string) => `${prep} ${horas(Number(h), Number(m))}`,
  );

  // Temperatura: "30°C", "-2 °C".
  t = t.replace(/(-?\d+(?:,\d+)?)\s?°\s?C(?![\p{L}])/gu, (_m, v: string) => {
    const neg = v.startsWith("-");
    const fala = decimalPorExtenso(neg ? v.slice(1) : v);
    return `${neg ? "menos " : ""}${fala} ${v.replace("-", "") === "1" ? "grau" : "graus"}`;
  });

  // "nº", "n.º", "Nº" → número (antes dos ordinais).
  t = t.replace(/(?<![\p{L}])[nN]\.?\s?[º°]\s?(?=\d)/gu, "número ");

  // Ordinais: "1º", "3ª", "1.º".
  t = t.replace(/(?<![\p{L}\p{N}])(\d{1,4})\.?\s?([ºª°])(?![\p{L}\p{N}])/gu, (_m, n: string, s: string) =>
    ordinal(Number(n), s === "ª" ? "f" : "m"),
  );

  for (const [re, troca] of ABREVIACOES) {
    t = t.replace(re, (m) => comCaixa(m, troca));
  }

  // Medidas depois de número: "5 km", "70kg".
  t = t.replace(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s?(km\/h|km|kg|cm|m²)(?![\p{L}])/gu, (m, v: string, u: string) => {
    for (const [re, sing, plur] of UNIDADES_MEDIDA) {
      if (re.test(u)) return `${v} ${v === "1" ? sing : plur}`;
    }
    return m;
  });

  // Romanos depois de "Capítulo", "Parte", "século"... ("século XIX" → dezenove).
  t = t.replace(ANTES_DE_ROMANO, (m, palavra: string, rom: string) => {
    const n = romanoParaNumero(rom);
    return n === null ? m : `${palavra} ${cardinal(n)}`;
  });

  return t.replace(/[ \t]+/g, " ").replace(/ +\n/g, "\n").trim();
}
