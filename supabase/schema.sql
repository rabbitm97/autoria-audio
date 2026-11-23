-- =============================================================================
-- autoria-audio — banco da demonstração
-- Aplicar uma vez no SQL Editor do projeto autoria-audio. Idempotente.
--   livros            → o livro enviado (.docx já lido em capítulos) e o estado
--                        do audiolivro (dados)
--   trechos           → 1 linha por trecho narrado (capítulo, ordem)
--   reservar_trechos  → reserva o próximo lote para gerar (FOR UPDATE SKIP
--                        LOCKED: duas chamadas ao mesmo tempo nunca pegam o
--                        mesmo trecho)
--   bucket audiolivros → MP3 dos trechos, dos capítulos, das amostras e o ZIP
-- Acesso: só o servidor (chave secreta). RLS ligado e sem policies; a chave
-- pública não lê nem grava nada.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.livros (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text        NOT NULL,
  subtitulo     text,
  autor         text        NOT NULL,
  capitulos     jsonb       NOT NULL,
  texto_hash    text        NOT NULL,
  cortado       boolean     NOT NULL DEFAULT false,
  dados         jsonb,
  token_hash    text        NOT NULL,
  ip_hash       text,
  exemplo       boolean     NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  preparado_em  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_livros_ip_criado ON public.livros (ip_hash, criado_em);
CREATE INDEX IF NOT EXISTS idx_livros_preparado ON public.livros (preparado_em);

CREATE TABLE IF NOT EXISTS public.trechos (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  livro_id             uuid        NOT NULL REFERENCES public.livros(id) ON DELETE CASCADE,
  capitulo             integer     NOT NULL,
  ordem                integer     NOT NULL,
  texto                text        NOT NULL,
  texto_fala           text        NOT NULL,
  texto_fala_original  text,
  hash                 text        NOT NULL,
  estado               text        NOT NULL DEFAULT 'pendente',
  tentativas           integer     NOT NULL DEFAULT 0,
  reservado_ate        timestamptz,
  storage_path         text,
  duracao_ms           integer,
  avisos               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  erro                 text,
  pedido_pelo_autor    boolean     NOT NULL DEFAULT false,
  conferencia          jsonb,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trechos_posicao_uq UNIQUE (livro_id, capitulo, ordem),
  CONSTRAINT trechos_estado_ck CHECK (estado IN ('pendente', 'gerando', 'pronto', 'falhou'))
);

CREATE INDEX IF NOT EXISTS idx_trechos_livro_estado ON public.trechos (livro_id, estado);

ALTER TABLE public.livros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trechos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.livros, public.trechos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.livros, public.trechos TO service_role;

-- Reserva até p_limite trechos para gerar: os pendentes e os presos em
-- 'gerando' com a reserva vencida (função derrubada no meio). Preso que já
-- gastou todas as tentativas vira 'falhou'.
CREATE OR REPLACE FUNCTION public.reservar_trechos(
  p_livro_id uuid,
  p_limite integer,
  p_max_tentativas integer
)
RETURNS SETOF public.trechos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trechos
     SET estado = 'falhou',
         erro = coalesce(erro, 'reserva vencida sem resposta'),
         reservado_ate = NULL,
         atualizado_em = now()
   WHERE livro_id = p_livro_id
     AND estado = 'gerando'
     AND reservado_ate < now()
     AND tentativas >= p_max_tentativas;

  RETURN QUERY
  UPDATE public.trechos t
     SET estado = 'gerando',
         tentativas = t.tentativas + 1,
         reservado_ate = now() + interval '5 minutes',
         atualizado_em = now()
   WHERE t.id IN (
     SELECT id
       FROM public.trechos
      WHERE livro_id = p_livro_id
        AND (estado = 'pendente' OR (estado = 'gerando' AND reservado_ate < now()))
        AND tentativas < p_max_tentativas
      ORDER BY capitulo, ordem
      LIMIT p_limite
      FOR UPDATE SKIP LOCKED
   )
  RETURNING t.*;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_trechos(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservar_trechos(uuid, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_trechos(uuid, integer, integer) TO service_role;

-- Bucket privado dos áudios (só o servidor lê e grava; a tela recebe links
-- assinados que valem 1 hora).
INSERT INTO storage.buckets (id, name, public)
VALUES ('audiolivros', 'audiolivros', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Conferência: deve devolver 2 linhas (livros, trechos), 1 função e 1 bucket.
SELECT 'tabela' AS tipo, tablename AS nome FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('livros', 'trechos')
UNION ALL
SELECT 'funcao', proname FROM pg_proc WHERE proname = 'reservar_trechos'
UNION ALL
SELECT 'bucket', id FROM storage.buckets WHERE id = 'audiolivros';
