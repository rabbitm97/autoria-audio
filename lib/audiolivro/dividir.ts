// lib/audiolivro/dividir.ts
//
// D60-A. Divide o texto de um capítulo em trechos de narração.
//
// Regra (aprovada em 17/nov):
// - A unidade é o PARÁGRAFO. Parágrafos inteiros são agrupados até perto do
//   alvo (~1.500 caracteres, cerca de 1min50s de fala).
// - Parágrafo maior que o máximo é quebrado em FRASES, nunca no meio de uma.
//   Frase maior que o máximo (raro) quebra na última vírgula/ponto e vírgula,
//   e só em último caso no último espaço.
// - Trecho pequeno (sobra) junta ao vizinho que couber no máximo.
// Por quê: trecho curto o bastante para o modelo não perder o tom nem
// "inventar" (os desvios aparecem em saídas longas), para refazer barato e
// para caber folgado numa chamada; longo o bastante para manter a prosódia
// entre frases. O mesmo texto sempre gera os mesmos trechos (determinístico):
// é isso que permite refazer só o que mudou.
//
// Módulo PURO (zero imports).

export interface OpcoesDivisao {
  /** Tamanho que o agrupamento procura atingir. */
  alvo: number;
  /** Nenhum trecho passa disso. */
  maximo: number;
  /** Trecho menor que isso junta a um vizinho (se couber no máximo). */
  minimo: number;
}

export const DIVISAO_PADRAO: OpcoesDivisao = { alvo: 1500, maximo: 2200, minimo: 400 };

// Abreviações e iniciais que terminam em ponto sem terminar a frase.
const NAO_FIM_DE_FRASE =
  /(?:^|[\s(])(?:Sr|Sra|Srta|Srs|Sras|Dr|Dra|Drs|Prof|Profa|Av|Exmo|Exma|n|nº|pág|p|cap|vol|ed|[A-ZÁÉÍÓÚ])\.$/u;

const SEPARADOR = /^[\s*#~_=•·.\-–—]+$/;

export function paragrafos(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !SEPARADOR.test(p));
}

export function frases(paragrafo: string): string[] {
  const pedacos = paragrafo.split(/(?<=[.!?…]["”»)]*)\s+(?=[\p{Lu}\d—–"“«(])/u);
  const r: string[] = [];
  for (const p of pedacos) {
    if (r.length > 0 && NAO_FIM_DE_FRASE.test(r[r.length - 1])) r[r.length - 1] += ` ${p}`;
    else r.push(p);
  }
  return r;
}

function quebrarFraseLonga(frase: string, maximo: number): string[] {
  const r: string[] = [];
  let resto = frase;
  while (resto.length > maximo) {
    const janela = resto.slice(0, maximo);
    let corte = Math.max(janela.lastIndexOf("; "), janela.lastIndexOf(", "), janela.lastIndexOf(": "));
    if (corte < maximo * 0.5) corte = janela.lastIndexOf(" ");
    if (corte <= 0) corte = maximo - 1;
    r.push(resto.slice(0, corte + 1).trim());
    resto = resto.slice(corte + 1).trim();
  }
  if (resto) r.push(resto);
  return r;
}

/** Agrupa unidades (parágrafos ou frases) em blocos perto do alvo. */
function agrupar(unidades: string[], sep: string, op: OpcoesDivisao): string[] {
  const blocos: string[] = [];
  let atual = "";
  for (const u of unidades) {
    if (!atual) { atual = u; continue; }
    const junto = atual.length + sep.length + u.length;
    const cabeNoAlvo = junto <= op.alvo;
    const atualMuitoCurto = atual.length < op.alvo * 0.5 && junto <= op.maximo;
    if (cabeNoAlvo || atualMuitoCurto) atual += sep + u;
    else { blocos.push(atual); atual = u; }
  }
  if (atual) blocos.push(atual);
  return blocos;
}

/**
 * Texto de um capítulo → trechos. Parágrafos dentro de um trecho ficam
 * separados por linha em branco (o narrador faz a pausa de parágrafo).
 */
export function dividirEmTrechos(texto: string, op: OpcoesDivisao = DIVISAO_PADRAO): string[] {
  // Cada parágrafo vira uma ou mais unidades que cabem no máximo.
  const unidades: string[] = [];
  for (const p of paragrafos(texto)) {
    if (p.length <= op.maximo) { unidades.push(p); continue; }
    const fr = frases(p).flatMap((f) => (f.length > op.maximo ? quebrarFraseLonga(f, op.maximo) : [f]));
    unidades.push(...agrupar(fr, " ", op));
  }
  const trechos = agrupar(unidades, "\n\n", op);

  // Trecho pequeno (sobra de parágrafo quebrado, fim de capítulo) junta ao
  // vizinho que couber: primeiro o anterior, senão o seguinte.
  for (let i = 0; i < trechos.length && trechos.length > 1; i++) {
    const t = trechos[i];
    if (t.length >= op.minimo) continue;
    const anterior = i > 0 ? trechos[i - 1] : null;
    const seguinte = i + 1 < trechos.length ? trechos[i + 1] : null;
    if (anterior !== null && anterior.length + 2 + t.length <= op.maximo) {
      trechos.splice(i - 1, 2, `${anterior}\n\n${t}`);
      i -= 2;
    } else if (seguinte !== null && t.length + 2 + seguinte.length <= op.maximo) {
      trechos.splice(i, 2, `${t}\n\n${seguinte}`);
      i -= 1;
    }
  }
  return trechos;
}

/** Título do capítulo pronto para ser falado antes do texto ("Capítulo 3. A gráfica."). */
export function tituloFalado(titulo: string): string {
  const t = titulo.trim();
  if (!t) return "";
  return /[.!?…:]$/.test(t) ? t : `${t}.`;
}
