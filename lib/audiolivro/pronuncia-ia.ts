// lib/audiolivro/pronuncia-ia.ts
//
// Sugestão de pronúncia de nomes: os candidatos do livro (candidatos.ts) vão
// para a IA, que escolhe os que uma voz brasileira provavelmente lê errado e
// escreve como se fala. O autor revisa e decide; nada é gravado aqui.
// Adaptado do motor da Autoria: chama a API da Anthropic direto (sem o
// registro de prompts e o rastreamento da plataforma).
//
// SERVER-ONLY (usa a chave da Anthropic).

import Anthropic from "@anthropic-ai/sdk";
import type { Pronuncia } from "./normalizar";
import { nomesCandidatos } from "./candidatos";

export const PRONUNCIA_PROMPT = `\
Você ajuda a preparar a narração de um livro em português do Brasil, feita
por uma voz sintética brasileira. Você recebe os nomes próprios do livro,
com quantas vezes cada um aparece.

Escolha SÓ os que essa voz provavelmente vai pronunciar errado: nomes
estrangeiros, grafias incomuns, nomes inventados de fantasia, siglas que
devem ser lidas como palavra. NÃO inclua nomes comuns no Brasil (João,
Maria, Silva, Rio de Janeiro), palavras comuns em maiúscula, abreviações
(Dr., Sr., Dra.) nem números romanos.

Para cada nome escolhido, escreva como ele deve soar, usando a grafia do
português do Brasil, com acento na sílaba tônica quando ajudar.
Exemplos (só para mostrar o formato; vale para qualquer livro):
Nguyen → Nuiên; Jacques → Jác; Leicester → Léster; Joaquín → Rroaquín;
Yerevan → Ierevân.

Prefira palavra por palavra (o mesmo nome aparece sozinho em outros
lugares); junte duas palavras só quando a pronúncia depende das duas.
Copie a grafia EXATAMENTE como veio na lista.

Retorne EXCLUSIVAMENTE JSON válido, no máximo 40 itens:
{ "sugestoes": [ { "grafia": "Jacques", "fala": "Jác" } ] }
Se nenhum nome precisar, retorne { "sugestoes": [] }.`;

const MODELO = process.env.AUDIO_PRONUNCIA_MODELO || "claude-sonnet-5-5";

export class SemChaveIa extends Error {}

/** Primeiro objeto JSON da resposta (aceita texto ou bloco de código em volta). */
function jsonDaResposta(texto: string): { sugestoes?: { grafia?: unknown; fala?: unknown }[] } {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return {};
  try {
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    return {};
  }
}

export async function sugerirPronuncias(textos: string[], jaCadastradas: Pronuncia[]): Promise<Pronuncia[]> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new SemChaveIa("ANTHROPIC_API_KEY não configurada.");
  const candidatos = nomesCandidatos(textos);
  if (candidatos.length === 0) return [];
  const conteudo = `Nomes do livro (${candidatos.length}):\n${candidatos.map((c) => `${c.nome} (${c.vezes})`).join("\n")}`;
  const msg = await new Anthropic({ apiKey: chave }).messages.create({
    model: MODELO,
    max_tokens: 2048,
    system: PRONUNCIA_PROMPT,
    messages: [{ role: "user", content: conteudo }],
  });
  const texto = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const bruto = jsonDaResposta(texto);
  const livro = textos.join("\n");
  const jaTem = new Set(jaCadastradas.map((p) => p.grafia.trim()));
  const vistas = new Set<string>();
  const saida: Pronuncia[] = [];
  for (const s of bruto.sugestoes ?? []) {
    const grafia = typeof s.grafia === "string" ? s.grafia.trim().slice(0, 80) : "";
    const fala = typeof s.fala === "string" ? s.fala.trim().slice(0, 80) : "";
    // Só o que existe no livro, ainda não cadastrado, e que muda algo.
    if (!grafia || !fala || grafia === fala || !livro.includes(grafia) || jaTem.has(grafia) || vistas.has(grafia)) continue;
    vistas.add(grafia);
    saida.push({ grafia, fala });
    if (saida.length >= 40) break;
  }
  return saida;
}
