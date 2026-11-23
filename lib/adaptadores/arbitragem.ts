// lib/adaptadores/arbitragem.ts
//
// Conferência por IA dos candidatos a capítulo que os padrões não decidem
// sozinhos (score abaixo de 0,90, até 120 por livro, os de maior score
// primeiro). A IA lê cada linha com o texto em volta e diz se é título de
// capítulo; com confiança de 0,6 ou mais, o candidato vem marcado. Se a IA
// falhar ou não houver chave, a proposta segue só com os padrões.
// Só servidor.

import Anthropic from "@anthropic-ai/sdk";
import type { CandidatoCapitulo } from "./tipos";

const MODELO = process.env.AUDIO_ARBITRO_MODELO || "claude-haiku-5-5";
const MAXIMO = 120;
const CONFIANCA_MINIMA = 0.6;

const INSTRUCAO = `Você ajuda um editor brasileiro a montar os capítulos de um livro.
Para cada linha candidata, com o texto que vem antes e depois, diga se ela é
o TÍTULO de um capítulo ou de uma seção do livro.

Responda só com JSON válido, neste formato:
{ "resultados": [ { "id": "cand-0", "e_capitulo": true, "confianca": 0.9, "motivo": "parece título de capítulo" } ] }

Como decidir:
- Não é título: fala de personagem, grito ou onomatopeia, legenda, enfeite
  separador, linha de sumário.
- É título: nome de capítulo ou de seção do livro, mesmo estilizado ou em
  maiúsculas.
- Em dúvida, responda false e diga por quê.
- "motivo": até 8 palavras, em português simples, como para um leitor
  ("parece fala de personagem", "parece título de capítulo"). Sem termos em inglês.`;

export type EstadoArbitragem = "ok" | "indisponivel" | "nao_necessaria";

function contexto(texto: string, pos: number): string {
  const nl = texto.indexOf("\n", pos);
  const fim = nl >= 0 ? nl : texto.length;
  const antes = texto.slice(Math.max(0, pos - 200), pos).replace(/\s+/g, " ").trim();
  const depois = texto.slice(fim + 1, fim + 201).replace(/\s+/g, " ").trim();
  return `ANTES: ${antes}\nLINHA: ${texto.slice(pos, fim).trim()}\nDEPOIS: ${depois}`;
}

function jsonDaResposta(texto: string): { resultados?: { id?: unknown; e_capitulo?: unknown; confianca?: unknown; motivo?: unknown }[] } {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return {};
  try {
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    return {};
  }
}

/**
 * Anota os candidatos no lugar (arbitrado, ia_e_capitulo, motivo_ia e a
 * marcação sugerida). Os ids em `fora` (decididos pelos estilos do Word),
 * os manuais e os bloqueados (sumário) não passam pela IA.
 */
export async function conferirComIa(
  textoBruto: string,
  candidatos: CandidatoCapitulo[],
  fora: Set<string>,
): Promise<{ estado: EstadoArbitragem; truncado: boolean }> {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  const elegiveis = candidatos.filter((c) => !fora.has(c.id) && c.origem !== "manual" && c.score < 0.9 && !c.bloqueado_ia);
  const enviados = [...elegiveis].sort((a, b) => b.score - a.score).slice(0, MAXIMO);
  if (enviados.length === 0) return { estado: "nao_necessaria", truncado: false };

  try {
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave) throw new Error("ANTHROPIC_API_KEY não configurada.");
    const lista = enviados.map((c) => ({ id: c.id, titulo: c.titulo, contexto: contexto(texto, c.pos) }));
    const msg = await new Anthropic({ apiKey: chave }).messages.create({
      model: MODELO,
      max_tokens: 4096,
      system: INSTRUCAO,
      messages: [{ role: "user", content: `Candidatos (${lista.length}):\n\n${JSON.stringify(lista, null, 2)}` }],
    });
    const resposta = jsonDaResposta(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    const porId = new Map((resposta.resultados ?? []).map((r) => [String(r.id), r]));
    for (const c of elegiveis) {
      const r = porId.get(c.id);
      if (!r) {
        c.arbitrado = false;
        continue;
      }
      c.arbitrado = true;
      c.ia_e_capitulo = r.e_capitulo === true;
      c.motivo_ia = String(r.motivo ?? "").trim().slice(0, 80);
      c.sugerido = r.e_capitulo === true && Number(r.confianca ?? 0) >= CONFIANCA_MINIMA;
    }
    return { estado: "ok", truncado: elegiveis.length > enviados.length };
  } catch (e) {
    console.error("[arbitragem] IA indisponível:", e instanceof Error ? e.message : e);
    for (const c of candidatos) if (c.origem !== "manual") c.arbitrado = false;
    return { estado: "indisponivel", truncado: false };
  }
}
