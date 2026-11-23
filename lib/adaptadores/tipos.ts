// lib/adaptadores/tipos.ts
//
// Tipos da demonstração: o livro enviado e o estado do audiolivro.
// Módulo PURO (só tipos).

import type { Pronuncia } from "@/lib/audiolivro/normalizar";

export type { Pronuncia };

/** Título marcado com estilo no .docx: "titulo" (estilo Título) ou o nível N de "Título N". */
export interface TituloWord {
  texto: string;
  nivel: "titulo" | number;
}

/** De onde veio a proposta de um início de capítulo. */
export type OrigemCandidato =
  | "marcador_explicito"
  | "marcador_divisor"
  | "secao_nomeada"
  | "markdown_heading"
  | "all_caps_isolado"
  | "numero_isolado"
  | "linha_curta_isolada"
  | "estilo_word"
  | "manual";

/** Possível início de capítulo no texto do livro, para o autor decidir. */
export interface CandidatoCapitulo {
  id: string;
  titulo: string;
  /** Posição (em caracteres) no texto do livro onde o capítulo começa. */
  pos: number;
  origem: OrigemCandidato;
  score: number;
  sugerido: boolean;
  preview_antes: string;
  preview_depois: string;
  palavras_no_segmento: number;
  motivo_descartado?: string;
  /** Sumário ou título repetido: a conferência por IA não mexe. */
  bloqueado_ia?: boolean;
  arbitrado?: boolean;
  ia_e_capitulo?: boolean;
  motivo_ia?: string;
}

/** Capítulo decidido pelo autor: título e posição no texto. */
export interface CapituloAprovado {
  titulo: string;
  pos: number;
}

/** Um capítulo aprovado. Título vazio = texto antes do primeiro capítulo. */
export interface CapituloTexto {
  titulo: string;
  texto: string;
}

/** Um segmento narrado (créditos ou capítulo) e o arquivo montado dele. */
export interface CapituloAudio {
  index: number;
  titulo: string;
  trechos: number;
  caracteres: number;
  storage_path: string | null;
  duracao_ms: number | null;
  montado_em: string | null;
}

/** Estado do audiolivro de um livro (coluna livros.dados). */
export interface DadosAudio {
  voz: string;
  estilo_versao: string;
  pronuncias: Pronuncia[];
  texto_hash: string;
  caracteres: number;
  regeneracoes_usadas: number;
  capitulos: CapituloAudio[];
  preparado_em: string;
}

/** Linha da tabela livros (sem o hash do token). */
export interface LivroRegistro {
  id: string;
  titulo: string;
  subtitulo: string | null;
  autor: string;
  /** null enquanto os capítulos não foram aprovados. */
  capitulos: CapituloTexto[] | null;
  texto_hash: string | null;
  cortado: boolean;
  dados: DadosAudio | null;
  exemplo: boolean;
  criado_em: string;
}
