// lib/adaptadores/tipos.ts
//
// Tipos da demonstração: o livro enviado e o estado do audiolivro.
// Módulo PURO (só tipos).

import type { Pronuncia } from "@/lib/audiolivro/normalizar";

export type { Pronuncia };

/** Bloco do manuscrito: título (h1-h3, estilos do Word) ou parágrafo. */
export interface Bloco {
  t: "h1" | "h2" | "h3" | "p";
  x: string;
}

export type OrigemCandidato = "estilo" | "padrao" | "maiusculas";

/** Possível início de capítulo, para o autor aprovar. */
export interface Candidato {
  /** Posição do bloco de título no manuscrito. */
  pos: number;
  titulo: string;
  origem: OrigemCandidato;
  marcado: boolean;
  /** Começo do texto que vem depois (para o autor reconhecer o capítulo). */
  inicio: string;
  caracteres: number;
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
