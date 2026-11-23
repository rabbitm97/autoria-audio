// lib/audiolivro/numeros.ts
//
// D60-A. Números por extenso em português do Brasil, para o texto que vai à
// narração. Módulo PURO (zero imports).
//
// Gênero: "m" (padrão) ou "f". Concorda unidades e centenas ("duas", "duzentas")
// no grupo das unidades e no grupo dos milhares ("duas mil pessoas"). Milhão e
// bilhão são masculinos, então os grupos deles são sempre masculinos.

export type Genero = "m" | "f";

const UNIDADES_M = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const UNIDADES_F = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "catorze", "quinze",
  "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS_M = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];
const CENTENAS_F = [
  "", "cento", "duzentas", "trezentas", "quatrocentas", "quinhentas",
  "seiscentas", "setecentas", "oitocentas", "novecentas",
];

/** 0..999, sem o "zero" (0 devolve ""). */
function ate999(n: number, g: Genero): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push((g === "f" ? CENTENAS_F : CENTENAS_M)[c]);
  if (resto > 0) {
    if (resto < 10) partes.push((g === "f" ? UNIDADES_F : UNIDADES_M)[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${(g === "f" ? UNIDADES_F : UNIDADES_M)[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

/** Inteiro de 0 a 999.999.999.999 por extenso. Fora disso, devolve os dígitos. */
export function cardinal(n: number, g: Genero = "m"): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) return String(n);
  if (n === 0) return "zero";

  const bilhoes = Math.floor(n / 1_000_000_000);
  const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const unidades = n % 1000;

  const grupos: { valor: number; texto: string }[] = [];
  if (bilhoes > 0) grupos.push({ valor: bilhoes, texto: `${ate999(bilhoes, "m")} ${bilhoes === 1 ? "bilhão" : "bilhões"}` });
  if (milhoes > 0) grupos.push({ valor: milhoes, texto: `${ate999(milhoes, "m")} ${milhoes === 1 ? "milhão" : "milhões"}` });
  if (milhares > 0) grupos.push({ valor: milhares, texto: milhares === 1 ? "mil" : `${ate999(milhares, g)} mil` });
  if (unidades > 0) grupos.push({ valor: unidades, texto: ate999(unidades, g) });

  if (grupos.length === 1) return grupos[0].texto;
  const ultimo = grupos[grupos.length - 1];
  const antes = grupos.slice(0, -1).map((x) => x.texto).join(" ");
  const usaE = ultimo.valor < 100 || ultimo.valor % 100 === 0;
  return `${antes}${usaE ? " e " : " "}${ultimo.texto}`;
}

const ORD_UNIDADES = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono"];
const ORD_DEZENAS = [
  "", "décimo", "vigésimo", "trigésimo", "quadragésimo", "quinquagésimo",
  "sexagésimo", "septuagésimo", "octogésimo", "nonagésimo",
];
const ORD_CENTENAS = [
  "", "centésimo", "ducentésimo", "trecentésimo", "quadringentésimo", "quingentésimo",
  "sexcentésimo", "septingentésimo", "octingentésimo", "nongentésimo",
];

/** Ordinal de 1 a 1999 ("primeiro", "vigésima terceira"). Fora disso, cardinal. */
export function ordinal(n: number, g: Genero = "m"): string {
  if (!Number.isInteger(n) || n < 1 || n > 1999) return cardinal(n, g);
  const partes: string[] = [];
  if (n >= 1000) partes.push("milésimo");
  const c = Math.floor((n % 1000) / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (c > 0) partes.push(ORD_CENTENAS[c]);
  if (d > 0) partes.push(ORD_DEZENAS[d]);
  if (u > 0) partes.push(ORD_UNIDADES[u]);
  const texto = partes.join(" ");
  return g === "f" ? texto.replace(/o\b/g, "a") : texto;
}

/** "12,5" ou "12.000" (padrão brasileiro) para número. null se não for número. */
export function lerNumeroBr(s: string): number | null {
  const limpo = s.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(limpo)) return null;
  const v = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Decimal por extenso com "vírgula" ("dois vírgula cinco"). Inteiro vai direto. */
export function decimalPorExtenso(s: string, g: Genero = "m"): string {
  const limpo = s.trim().replace(/\./g, "");
  const [inteira, fracao] = limpo.split(",");
  const parteInteira = cardinal(Number(inteira), g);
  if (!fracao) return parteInteira;
  // Zeros à esquerda da fração são falados ("um vírgula zero cinco").
  const zeros = fracao.match(/^0+/)?.[0].length ?? 0;
  const resto = fracao.slice(zeros);
  const falaZeros = Array(zeros).fill("zero").join(" ");
  const falaResto = resto ? cardinal(Number(resto), "m") : "";
  return `${parteInteira} vírgula ${[falaZeros, falaResto].filter(Boolean).join(" ")}`;
}

const ROMANOS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** "XIV" para 14. null se não for algarismo romano válido e canônico. */
export function romanoParaNumero(s: string): number | null {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMANOS[s[i]];
    const prox = ROMANOS[s[i + 1]] ?? 0;
    total += v < prox ? -v : v;
  }
  return total > 0 && numeroParaRomano(total) === s ? total : null;
}

function numeroParaRomano(n: number): string {
  const tabela: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let r = "";
  let x = n;
  for (const [v, l] of tabela) while (x >= v) { r += l; x -= v; }
  return r;
}
