// lib/adaptadores/capitulos.ts
//
// Proposta de capítulos e montagem depois da aprovação do autor.
//   Proposta: cada bloco que parece título vira candidato, com a origem
//   ("Título do Word", "Começa com Capítulo, Parte...", "Linha em
//   maiúsculas"). Vêm marcados os do tipo mais confiável que aparece pelo
//   menos duas vezes; o autor marca, desmarca e renomeia.
//   Montagem: cada capítulo aprovado leva os parágrafos até o próximo. O
//   texto antes do primeiro capítulo (folha de rosto, dedicatória) entra só
//   se o autor pedir.

import type { Bloco, Candidato, CapituloTexto, OrigemCandidato } from "./tipos";

const TITULO_POR_TEXTO =
  /^(cap[ií]tulo|parte|livro|pr[oó]logo|ep[ií]logo|introdu[cç][aã]o|apresenta[cç][aã]o|pref[aá]cio|posf[aá]cio|conclus[aã]o|nota d[oa] autor[a]?|agradecimentos)\b/i;
const SO_NUMERO = /^(\d{1,3}|[IVXLC]{1,7})[.)]?$/;

function emMaiusculas(x: string): boolean {
  const letras = x.replace(/[^\p{L}]/gu, "");
  return letras.length >= 3 && letras === letras.toLocaleUpperCase("pt-BR") && letras !== letras.toLocaleLowerCase("pt-BR");
}

function origemDe(b: Bloco): OrigemCandidato | null {
  if (b.t !== "p") return "estilo";
  if (b.x.length <= 80 && (TITULO_POR_TEXTO.test(b.x) || SO_NUMERO.test(b.x))) return "padrao";
  if (b.x.length <= 60 && emMaiusculas(b.x) && !/[.,;]$/.test(b.x)) return "maiusculas";
  return null;
}

const normal = (s: string) => s.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

export function proporCandidatos(blocos: Bloco[], tituloDoLivro: string): { candidatos: Candidato[]; abertura: number } {
  const brutos: { pos: number; origem: OrigemCandidato; nivel: number }[] = [];
  blocos.forEach((b, pos) => {
    const origem = origemDe(b);
    if (!origem) return;
    // O nome do livro no topo do arquivo não é capítulo.
    if (pos < 3 && normal(b.x) === normal(tituloDoLivro)) return;
    brutos.push({ pos, origem, nivel: b.t === "h1" ? 1 : b.t === "h2" ? 2 : b.t === "h3" ? 3 : 9 });
  });

  // O que vem marcado: o tipo mais confiável que aparece pelo menos 2 vezes.
  const conta = (f: (c: (typeof brutos)[number]) => boolean) => brutos.filter(f).length;
  let marcar: (c: (typeof brutos)[number]) => boolean = () => false;
  for (const nivel of [1, 2, 3]) {
    if (conta((c) => c.origem === "estilo" && c.nivel === nivel) >= 2) {
      marcar = (c) => c.origem === "estilo" && c.nivel === nivel;
      break;
    }
  }
  if (conta(marcar) === 0 && conta((c) => c.origem === "padrao") >= 2) marcar = (c) => c.origem === "padrao";
  if (conta(marcar) === 0) {
    const n = conta((c) => c.origem === "maiusculas");
    if (n >= 2 && n <= 80) marcar = (c) => c.origem === "maiusculas";
  }

  const fimDe = (i: number) => (i + 1 < brutos.length ? brutos[i + 1].pos : blocos.length);
  const textoEntre = (de: number, ate: number) => blocos.slice(de, ate).filter((b) => b.t === "p");
  const candidatos: Candidato[] = brutos.slice(0, 400).map((c, i) => {
    const corpo = textoEntre(c.pos + 1, fimDe(i));
    return {
      pos: c.pos,
      titulo: blocos[c.pos].x.slice(0, 120),
      origem: c.origem,
      marcado: marcar(c),
      inicio: corpo.map((b) => b.x).join(" ").slice(0, 140),
      caracteres: corpo.reduce((s, b) => s + b.x.length, 0),
    };
  });
  const primeiro = brutos[0]?.pos ?? blocos.length;
  const abertura = textoEntre(0, primeiro).reduce((s, b) => s + b.x.length, 0);
  return { candidatos, abertura };
}

/** Capítulos aprovados → texto de cada um. Sem nenhum aprovado, o livro inteiro é um capítulo. */
export function montarCapitulos(
  blocos: Bloco[],
  aprovados: { pos: number; titulo: string }[],
  incluirAbertura: boolean,
): CapituloTexto[] {
  const ordem = [...aprovados]
    .filter((a) => Number.isInteger(a.pos) && a.pos >= 0 && a.pos < blocos.length)
    .sort((a, b) => a.pos - b.pos);
  const juntar = (de: number, ate: number) =>
    blocos.slice(de, ate).filter((b) => b.t === "p").map((b) => b.x).join("\n\n");
  if (ordem.length === 0) {
    const texto = juntar(0, blocos.length);
    return texto ? [{ titulo: "", texto }] : [];
  }
  const capitulos: CapituloTexto[] = [];
  if (incluirAbertura) {
    const abertura = juntar(0, ordem[0].pos);
    if (abertura) capitulos.push({ titulo: "", texto: abertura });
  }
  ordem.forEach((a, i) => {
    const fim = i + 1 < ordem.length ? ordem[i + 1].pos : blocos.length;
    const titulo = a.titulo.replace(/\s+/g, " ").trim().slice(0, 120) || blocos[a.pos].x.slice(0, 120);
    capitulos.push({ titulo, texto: juntar(a.pos + 1, fim) });
  });
  return capitulos;
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
