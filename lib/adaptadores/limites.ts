// lib/adaptadores/limites.ts
//
// Limites da demonstração pública: cada narração gasta a API de voz, então
// o envio é curto e o número de livros por dia é contado.

function numero(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

/** Caracteres narrados por livro (cerca de 2 capítulos curtos, ~16 min de áudio). */
export const LIMITE_CARACTERES = numero("LIMITE_CARACTERES", 15_000);

/** Livros narrados nas últimas 24 horas, no total e por endereço. */
export const LIMITE_LIVROS_DIA = numero("LIMITE_LIVROS_DIA", 40);
export const LIMITE_LIVROS_IP_DIA = numero("LIMITE_LIVROS_IP_DIA", 3);

/** Envios de .docx por endereço nas últimas 24 horas (ler o arquivo não gasta voz). */
export const LIMITE_ENVIOS_IP_DIA = numero("LIMITE_ENVIOS_IP_DIA", 15);

/** Trechos refeitos ou editados a pedido, por livro. */
export const LIMITE_REGENERACOES = numero("LIMITE_REGENERACOES", 10);

/** Tamanho máximo do .docx enviado. */
export const TAMANHO_MAX_DOCX = 4 * 1024 * 1024;
