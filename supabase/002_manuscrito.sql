-- =============================================================================
-- autoria-audio — 002: manuscrito em .docx, .pdf ou .txt e aprovação de capítulos
-- Aplicar uma vez no SQL Editor do projeto autoria-audio, depois do schema.sql.
-- Idempotente.
--   livros.formato, blocos, candidatos  → texto do manuscrito e a proposta de
--                                          capítulos (antes da aprovação)
--   livros.declaracao_aceita_em         → quando o autor aceitou a declaração
--   livros.capitulos_aprovados_em       → quando aprovou os capítulos
--   capitulos e texto_hash ficam vazios até a aprovação
--   bucket manuscritos                  → o arquivo enviado (apagado depois da leitura)
-- =============================================================================

BEGIN;

ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS formato text;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS blocos jsonb;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS candidatos jsonb;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS declaracao_aceita_em timestamptz;
ALTER TABLE public.livros ADD COLUMN IF NOT EXISTS capitulos_aprovados_em timestamptz;
ALTER TABLE public.livros ALTER COLUMN capitulos DROP NOT NULL;
ALTER TABLE public.livros ALTER COLUMN texto_hash DROP NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('manuscritos', 'manuscritos', false, 52428800)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Conferência: deve devolver 5 colunas e 1 bucket.
SELECT 'coluna' AS tipo, column_name AS nome FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'livros'
   AND column_name IN ('formato', 'blocos', 'candidatos', 'declaracao_aceita_em', 'capitulos_aprovados_em')
UNION ALL
SELECT 'bucket', id FROM storage.buckets WHERE id = 'manuscritos';
