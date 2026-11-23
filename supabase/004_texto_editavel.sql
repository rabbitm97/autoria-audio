-- =============================================================================
-- autoria-audio — 004: texto do livro editável e capítulos por posição
-- Aplicar uma vez no SQL Editor do projeto autoria-audio, depois do 003.
-- Idempotente. Não mexe em dados existentes.
--   livros.texto                    → texto do manuscrito (o autor pode editar
--                                     na etapa Capítulos)
--   livros.titulos_word             → títulos marcados com estilo no .docx
--   livros.capitulos_aprovados      → [{ titulo, pos }] decididos pelo autor
--   livros.capitulos_aprovados_hash → md5 do texto em que as posições valem
--   livros.incluir_abertura         → narrar o texto antes do 1º capítulo
-- =============================================================================

BEGIN;

ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS texto text;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS titulos_word jsonb;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS capitulos_aprovados jsonb;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS capitulos_aprovados_hash text;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS incluir_abertura boolean NOT NULL DEFAULT true;

COMMIT;

-- Conferência: deve devolver as 5 colunas.
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'livros'
   AND column_name IN ('texto', 'titulos_word', 'capitulos_aprovados', 'capitulos_aprovados_hash', 'incluir_abertura')
 ORDER BY column_name;
