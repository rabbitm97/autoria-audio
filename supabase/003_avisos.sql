-- =============================================================================
-- autoria-audio — 003: aviso de créditos de narração esgotados
-- Aplicar uma vez no SQL Editor do projeto autoria-audio. Idempotente.
--   avisos_demo → uma linha por aviso ("creditos_voz": até quando a narração
--                 fica pausada porque a cota ou o orçamento da voz acabou)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.avisos_demo (
  id            text        PRIMARY KEY,
  ate           timestamptz NOT NULL,
  motivo        text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.avisos_demo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avisos_demo FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avisos_demo TO service_role;

COMMIT;

-- Conferência: deve devolver 1 linha (avisos_demo).
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'avisos_demo';
