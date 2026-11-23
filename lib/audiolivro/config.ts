// lib/audiolivro/config.ts
//
// D60-A. Regras do audiolivro num lugar só (decisões de 15 a 17/nov).
// Módulo PURO (zero imports): a tela (D60-B) lê daqui também.

/** Incluído no plano Pro (e no avulso): até 500 mil caracteres por livro. */
export const AUDIO_CARACTERES_INCLUIDOS = 500_000;

/** Regenerações de trecho pedidas pelo autor, incluídas por livro. */
export const AUDIO_REGENERACOES_INCLUIDAS = 30;

/** D60-C: o que cada pacote acrescenta (preço em lib/creditos-custos.ts). */
export const AUDIO_PACOTE_CARACTERES = 100_000;
export const AUDIO_PACOTE_REGENERACOES = 10;

/** D60-C: amostras de nome (etapa de pronúncia) que um livro pode gerar. */
export const AUDIO_AMOSTRAS_NOMES_MAX = 60;

/** Arquivos ficam guardados por 90 dias depois de concluído. */
export const AUDIO_RETENCAO_DIAS = 90;

/** Trechos gerados em paralelo por chamada do processamento. */
export const AUDIO_CONCORRENCIA = 3;

/** Tentativas automáticas por trecho (erro temporário ou áudio fora do esperado). */
export const AUDIO_MAX_TENTATIVAS = 3;

/**
 * Ritmo medido em 19/nov em 11 trechos LIMPOS (conferidos, sem a instrução
 * lida): mediana de 951 caracteres do texto falado por minuto, variação de
 * 0,92 a 1,07. A medição de 17/nov (724) estava inflada pela instrução lida.
 */
export const AUDIO_CARACTERES_POR_SEGUNDO = 951 / 60;

/**
 * Duração aceita: entre MIN e MAX vezes a esperada pelo ritmo, mais uma folga
 * fixa (que protege trechos curtos, como um título sozinho). Fora disso o
 * trecho é refeito antes mesmo da conferência por transcrição.
 */
export const AUDIO_DURACAO_MIN = 0.8;
export const AUDIO_DURACAO_MAX = 1.2;
export const AUDIO_DURACAO_FOLGA_MS = 2000;

/** Pausas da montagem do capítulo (ms). D60-B2: início de 1000 para 600 (com a
 * folga do corte, o arquivo abre com ~0,7 s de silêncio; as lojas pedem 0,5 a 1 s). */
export const AUDIO_PAUSA_INICIO_MS = 600;
export const AUDIO_PAUSA_ENTRE_TRECHOS_MS = 700;
export const AUDIO_PAUSA_FIM_MS = 2000;

/**
 * As 6 vozes do Gemini aprovadas (19/nov), com o nome e a descrição que o
 * autor vê. `id` é o nome da voz na API (gravado em dados_audio.voz).
 */
export const AUDIO_VOZES = [
  { id: "Leda", nome: "Helena", descricao: "Feminina, jovem e clara" },
  { id: "Kore", nome: "Marina", descricao: "Feminina, firme e segura" },
  { id: "Aoede", nome: "Luísa", descricao: "Feminina, leve e descontraída" },
  { id: "Charon", nome: "Eduardo", descricao: "Masculina, clara e didática" },
  { id: "Orus", nome: "Rafael", descricao: "Masculina, firme e grave" },
  { id: "Iapetus", nome: "Tiago", descricao: "Masculina, nítida e serena" },
] as const;
export type VozAudio = (typeof AUDIO_VOZES)[number]["id"];

export function isVozAudio(x: unknown): x is VozAudio {
  return typeof x === "string" && AUDIO_VOZES.some((v) => v.id === x);
}

/**
 * Instrução de estilo aprovada no teste de 15/nov (a "anterior", mais curta).
 * Vai na frente de cada trecho. Mudar este texto muda a versão do estilo e
 * faz todos os trechos serem refeitos na próxima preparação.
 */
export const AUDIO_ESTILO_INSTRUCAO = `Você é uma narradora brasileira nativa, de São Paulo, gravando um audiolivro. Fale com sotaque e pronúncia do português do Brasil o tempo todo, nunca com sotaque estrangeiro. Tom calmo e natural, ritmo moderado, pausas curtas nas vírgulas e mais longas entre parágrafos. Leia horas como se fala no Brasil (14h30 = catorze e trinta). Nos diálogos, diferencie levemente as falas, sem interpretar de forma exagerada.`;

/**
 * D60-A3. Direção de estilo em inglês, só adjetivos, sem a frase "Você é uma
 * narradora…" (que a voz às vezes emenda no texto). Usada pelos formatos
 * "notas_en" e "notas_en_lingua" (ver lib/audiolivro/gemini.ts).
 */
export const AUDIO_ESTILO_NOTAS_EN =
  "Style: calm, natural audiobook narration. Language and accent: native Brazilian Portuguese from São Paulo, never a foreign accent. " +
  "Pace: moderate, short pauses at commas and longer pauses between paragraphs. " +
  "Dialogue: differentiate the lines lightly, without exaggerated acting. Speak only the transcript.";

/** Versão do motor: mudar força refazer tudo (ex.: nova regra de normalização). */
export const AUDIO_VERSAO_MOTOR = "d60b2";
