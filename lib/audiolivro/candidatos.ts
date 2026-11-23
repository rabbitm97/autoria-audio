// lib/audiolivro/candidatos.ts
//
// D60-B3. Nomes próprios do livro que podem ir para a sugestão de pronúncia.
// Pega sequências de palavras com inicial maiúscula que NÃO começam frase
// ("Siobhan Ní Dhuibhir", "Vila Serena"), conta quantas vezes aparecem e
// devolve as mais frequentes. Quem decide quais a voz vai ler errado é a IA
// (pronuncia-ia.ts); aqui é só a peneira, sem custo.
//
// Módulo PURO (zero imports).

/** Palavras curtas que ligam partes de um nome ("Maria da Silva"). */
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "di", "du", "del", "van", "von", "le", "la"]);

function maiuscula(p: string): boolean {
  const c = p.charAt(0);
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Palavra toda em maiúsculas com mais de 5 letras é título ("SUMÁRIO"), não nome. */
function tituloEmCaixaAlta(p: string): boolean {
  return p.length > 5 && p === p.toUpperCase();
}

export function nomesCandidatos(textos: string[], max = 150): { nome: string; vezes: number }[] {
  const contagem = new Map<string, number>();
  const palavra = /[\p{L}][\p{L}'’-]*/gu;
  for (const texto of textos) {
    for (const paragrafo of texto.split(/\n+/)) {
      const achados = [...paragrafo.matchAll(palavra)];
      let i = 0;
      while (i < achados.length) {
        const m = achados[i];
        const p = m[0];
        if (!maiuscula(p) || tituloEmCaixaAlta(p)) { i++; continue; }
        // Começo de frase: início do parágrafo ou pontuação forte antes.
        const antes = paragrafo.slice(0, m.index ?? 0).trimEnd();
        const comecoDeFrase = antes === "" || /[.!?…:;—–"“«(]$/.test(antes);
        // Junta as palavras seguintes do mesmo nome (maiúsculas ou ligações).
        const partes = [p];
        let j = i + 1;
        while (j < achados.length) {
          const entre = paragrafo.slice((achados[j - 1].index ?? 0) + achados[j - 1][0].length, achados[j].index ?? 0);
          if (entre !== " ") break;
          const q = achados[j][0];
          if (maiuscula(q) && !tituloEmCaixaAlta(q)) { partes.push(q); j++; continue; }
          if (LIGACOES.has(q) && j + 1 < achados.length && maiuscula(achados[j + 1][0])) { partes.push(q); j++; continue; }
          break;
        }
        while (partes.length > 1 && LIGACOES.has(partes[partes.length - 1])) partes.pop();
        // Em começo de frase a primeira maiúscula pode ser só a da frase
        // ("Quando Augusto"): fica o resto. Nome que só aparece em começo de
        // frase costuma aparecer também no meio, e aí é contado.
        if (comecoDeFrase) {
          partes.shift();
          while (partes.length > 0 && LIGACOES.has(partes[0])) partes.shift();
        }
        const nome = partes.join(" ");
        if (nome.length >= 2) contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
        i = j;
      }
    }
  }
  return [...contagem.entries()]
    .map(([nome, vezes]) => ({ nome, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.nome.localeCompare(b.nome))
    .slice(0, max);
}

/**
 * D60-C. A frase do livro em que o nome aparece, para a amostra de
 * pronúncia: a voz fala o nome no contexto real (sozinho, ela pode dizer
 * diferente, e texto muito curto a faz inventar continuação). Usa a
 * primeira ocorrência que dá uma frase de pelo menos 40 caracteres (linha
 * de sumário ou título fica para trás); frase curta ganha a seguinte;
 * longa é cortada em volta do nome. null se o nome não está no livro.
 */
export function fraseComNome(textos: string[], nome: string, max = 240): string | null {
  const alvo = nome.trim();
  if (!alvo) return null;
  const esc = alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "gu");
  // Ponto de abreviação ("Dra.", "Sr.", "nº.") não fecha frase.
  const fimDeFrase = (par: string, i: number): boolean => {
    const c = par[i];
    if (c === "!" || c === "?" || c === "…") return true;
    if (c !== ".") return false;
    const antes = par.slice(Math.max(0, i - 4), i).split(/[^\p{L}]/u).pop() ?? "";
    return !(antes.length > 0 && antes.length <= 3 && antes[0] === antes[0].toUpperCase() && antes[0] !== antes[0].toLowerCase()) && antes !== "nº";
  };
  let reserva: string | null = null;
  for (const texto of textos) {
    for (const par of texto.split(/\n+/)) {
      for (const m of par.matchAll(re)) {
        const ini = (m.index ?? 0) + m[1].length;
        const fimNome = ini + alvo.length;
        let a = ini;
        while (a > 0 && !fimDeFrase(par, a - 1)) a--;
        let b = fimNome;
        while (b < par.length && !fimDeFrase(par, b)) b++;
        b = Math.min(par.length, b + 1);
        if (par.slice(a, b).trim().length < 40 && b < par.length) {
          let c = b;
          while (c < par.length && !fimDeFrase(par, c)) c++;
          b = Math.min(par.length, c + 1);
        }
        if (b - a > max) {
          let s = Math.max(a, ini - 100);
          let e = Math.min(b, fimNome + 120);
          while (s > a && par[s - 1] !== " ") s--;
          while (e < b && par[e] !== " ") e++;
          a = s;
          b = e;
        }
        const frase = par.slice(a, b).trim();
        if (frase.length >= 40) return frase;
        if (!reserva || frase.length > reserva.length) reserva = frase;
      }
    }
  }
  return reserva;
}
