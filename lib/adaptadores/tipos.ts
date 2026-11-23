// lib/adaptadores/tipos.ts
//
// Tipos da demonstração: o livro enviado e o estado do audiolivro.
// Módulo PURO (só tipos).

import type { Pronuncia } from "@/lib/audiolivro/normalizar";

export type { Pronuncia };

/** Um capítulo lido do .docx. Título vazio = texto antes do primeiro título. */
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
  capitulos: CapituloTexto[];
  texto_hash: string;
  cortado: boolean;
  dados: DadosAudio | null;
  exemplo: boolean;
  criado_em: string;
}
