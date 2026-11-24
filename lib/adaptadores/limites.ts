// lib/adaptadores/limites.ts
//
// Limites da demonstração. Para a competição, nenhum limite de uso vale por
// padrão: livro de qualquer tamanho, quantos livros e envios quiser,
// regenerações à vontade. Cada um pode ser religado por variável de ambiente
// (um número maior que zero), se o gasto com a API de voz precisar de freio.
// O que continua valendo vem de fora: o arquivo de até 50 MB (limite de envio
// do Supabase, o mesmo da plataforma) e os créditos das contas de voz e de IA.

function numero(nome: string): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? v : Number.POSITIVE_INFINITY;
}

/** Caracteres narrados por livro (sem limite: o livro inteiro). */
export const LIMITE_CARACTERES = numero("LIMITE_CARACTERES");

/** Livros narrados nas últimas 24 horas, no total e por endereço. */
export const LIMITE_LIVROS_DIA = numero("LIMITE_LIVROS_DIA");
export const LIMITE_LIVROS_IP_DIA = numero("LIMITE_LIVROS_IP_DIA");

/** Envios de manuscrito por endereço nas últimas 24 horas. */
export const LIMITE_ENVIOS_IP_DIA = numero("LIMITE_ENVIOS_IP_DIA");

/** Trechos refeitos ou editados a pedido, por livro. */
export const LIMITE_REGENERACOES = numero("LIMITE_REGENERACOES");

/** Tamanho máximo do manuscrito enviado (.docx, .pdf ou .txt). */
export const TAMANHO_MAX_MANUSCRITO = 50 * 1024 * 1024;

/** Para o navegador: sem limite vira null. */
export const paraTela = (n: number) => (Number.isFinite(n) ? n : null);
