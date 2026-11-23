// lib/audiolivro/gemini.ts
//
// D60-A. Adaptador do Gemini: texto de um trecho → PCM 16 bits mono (voz) e
// áudio de um trecho → transcrição (conferência, D60-A2).
// Só servidor. Trocar de fornecedor = trocar este arquivo; o resto do motor
// recebe PCM e texto e não sabe de onde vieram.
//
// Variáveis de ambiente (Vercel e .env.local):
//   GEMINI_TTS_API_KEY   chave da API do Google AI Studio (vale para os dois)
//   GEMINI_TTS_MODELO    id exato do modelo de voz (AI Studio > Get code)
//   GEMINI_STT_MODELO    id exato do modelo que ouve e transcreve (conferência)
//
// D60-A2: o pedido de voz separa a direção do texto com os cabeçalhos do guia
// do Google ("### DIRECTOR'S NOTES" e "#### TRANSCRIPT"). Sem eles, a voz lia a
// instrução de estilo em voz alta no começo da maioria dos trechos (17/nov).

import { AUDIO_ESTILO_INSTRUCAO, AUDIO_ESTILO_NOTAS_EN } from "./config";
import { pcmDeBytes, TAXA_GEMINI } from "./pcm";

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TEMPO_LIMITE_MS = 150_000;

/** limite: cota/minuto estourada (esperar e tentar de novo, sem gastar tentativa).
 *  temporario: falha do serviço (tentar de novo).
 *  definitivo: pedido inválido ou configuração faltando (não adianta repetir). */
export type TipoErroTts = "limite" | "temporario" | "definitivo";

export class ErroTts extends Error {
  /** diario: o limite estourado é o de pedidos por DIA (só volta no dia seguinte do Google). */
  constructor(message: string, public readonly tipo: TipoErroTts, public readonly status?: number, public readonly diario = false) {
    super(message);
    this.name = "ErroTts";
  }
}

export interface ResultadoTts {
  pcm: Int16Array;
  taxa: number;
  tokensEntrada: number | null;
  tokensSaida: number | null;
}

interface RespostaGemini {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Formatos do pedido de voz (D60-A3, experimento de 19/nov):
 *   notas_pt         direção em português (a instrução aprovada) + transcrição
 *   notas_en         direção curta em inglês + transcrição
 *   notas_en_lingua  igual ao anterior, com languageCode pt-BR na API
 *   texto_lingua     só o texto, com languageCode pt-BR (sem direção)
 * FORMATO_VOZ_PADRAO é o que a geração usa. Trocar o padrão exige subir
 * AUDIO_VERSAO_MOTOR (os trechos são refeitos).
 */
export const FORMATOS_VOZ = ["notas_pt", "notas_en", "notas_en_lingua", "texto_lingua"] as const;
export type FormatoVoz = (typeof FORMATOS_VOZ)[number];
export const FORMATO_VOZ_PADRAO: FormatoVoz = "notas_en_lingua"; // D60-A4: escolhido no experimento de 19/nov

export function isFormatoVoz(x: unknown): x is FormatoVoz {
  return typeof x === "string" && (FORMATOS_VOZ as readonly string[]).includes(x);
}

/** Pedido de voz: direção e texto em seções separadas (guia de prompts do Gemini TTS). */
export function pedidoDeVoz(texto: string, formato: FormatoVoz = FORMATO_VOZ_PADRAO): string {
  if (formato === "texto_lingua") return texto;
  const notas = formato === "notas_pt" ? AUDIO_ESTILO_INSTRUCAO : AUDIO_ESTILO_NOTAS_EN;
  return `### DIRECTOR'S NOTES\n${notas}\n\n#### TRANSCRIPT\n${texto}`;
}

async function chamar(modelo: string, chave: string, corpo: unknown, rotulo: string): Promise<RespostaGemini> {
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": chave, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (e) {
    throw new ErroTts(`Falha de rede no Gemini (${rotulo}): ${e instanceof Error ? e.message : String(e)}`, "temporario");
  }
  if (!res.ok) {
    const corpoInteiro = await res.text().catch(() => "");
    const tipo: TipoErroTts = res.status === 429 ? "limite" : res.status >= 500 ? "temporario" : "definitivo";
    const diario = res.status === 429 && /per_day|perday|per day/i.test(corpoInteiro);
    throw new ErroTts(`Gemini ${rotulo} ${res.status}: ${corpoInteiro.slice(0, 300)}`, tipo, res.status, diario);
  }
  return (await res.json()) as RespostaGemini;
}

export async function sintetizar(texto: string, voz: string, formato: FormatoVoz = FORMATO_VOZ_PADRAO): Promise<ResultadoTts> {
  const chave = process.env.GEMINI_TTS_API_KEY;
  const modelo = process.env.GEMINI_TTS_MODELO;
  if (!chave || !modelo) {
    throw new ErroTts("GEMINI_TTS_API_KEY ou GEMINI_TTS_MODELO não configurada.", "definitivo");
  }
  const data = await chamar(modelo, chave, {
    contents: [{ role: "user", parts: [{ text: pedidoDeVoz(texto, formato) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } },
        ...(formato.endsWith("_lingua") ? { languageCode: "pt-BR" } : {}),
      },
    },
  }, "voz");

  const cand = data.candidates?.[0];
  const parte = cand?.content?.parts?.find((p) => p.inlineData?.data);
  if (!parte?.inlineData?.data) {
    throw new ErroTts(`Gemini respondeu sem áudio (finishReason=${cand?.finishReason ?? "?"}).`, "temporario");
  }
  const mime = parte.inlineData.mimeType ?? "";
  const bruto = Uint8Array.from(Buffer.from(parte.inlineData.data, "base64"));
  const { bytes, taxa } = audioDaResposta(bruto, mime);
  return {
    pcm: pcmDeBytes(bytes),
    taxa,
    tokensEntrada: data.usageMetadata?.promptTokenCount ?? null,
    tokensSaida: data.usageMetadata?.candidatesTokenCount ?? null,
  };
}

/**
 * A voz chega em PCM puro (modelos de voz até a geração 3.1) ou em WAV (3.8).
 * No WAV, descarta o cabeçalho (senão ele vira um estalo no começo do
 * trecho) e lê a taxa do próprio arquivo.
 */
function audioDaResposta(bruto: Uint8Array, mime: string): { bytes: Uint8Array; taxa: number } {
  const marca = (i: number) => String.fromCharCode(bruto[i], bruto[i + 1], bruto[i + 2], bruto[i + 3]);
  if (bruto.length < 44 || marca(0) !== "RIFF" || marca(8) !== "WAVE") {
    return { bytes: bruto, taxa: Number(/rate=(\d+)/.exec(mime)?.[1] ?? TAXA_GEMINI) };
  }
  const dv = new DataView(bruto.buffer, bruto.byteOffset, bruto.byteLength);
  let taxa = TAXA_GEMINI;
  let pos = 12;
  while (pos + 8 <= bruto.length) {
    const id = marca(pos);
    const tamanho = dv.getUint32(pos + 4, true);
    if (id === "fmt " && pos + 16 <= bruto.length) taxa = dv.getUint32(pos + 12, true);
    if (id === "data") return { bytes: bruto.subarray(pos + 8, Math.min(bruto.length, pos + 8 + tamanho)), taxa };
    pos += 8 + tamanho + (tamanho % 2);
  }
  return { bytes: bruto.subarray(44), taxa };
}

const PEDIDO_TRANSCRICAO =
  "Transcreva literalmente, em português do Brasil, tudo o que é falado neste áudio, do começo ao fim. " +
  "Não corrija, não resuma, não acrescente nem omita nada. Escreva números, horas e valores por extenso, como foram falados. " +
  "Responda só com a transcrição, sem comentários.";

/** Conferência: o modelo ouve o trecho (WAV) e devolve o que foi falado. */
export async function transcrever(wav: Uint8Array): Promise<string> {
  const chave = process.env.GEMINI_TTS_API_KEY;
  const modelo = process.env.GEMINI_STT_MODELO;
  if (!chave || !modelo) {
    throw new ErroTts("GEMINI_TTS_API_KEY ou GEMINI_STT_MODELO não configurada.", "definitivo");
  }
  const data = await chamar(modelo, chave, {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } },
        { text: PEDIDO_TRANSCRICAO },
      ],
    }],
    generationConfig: { temperature: 0 },
  }, "transcrição");
  const texto = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!texto) throw new ErroTts("Gemini devolveu transcrição vazia.", "temporario");
  return texto;
}
