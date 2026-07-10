-- ============================================================================
-- DASH-DE-SALDOS — Schema Supabase
-- Cole e rode este bloco inteiro no SQL Editor do Supabase (Dashboard > SQL > New Query).
-- Cria as 3 tabelas: database_rows, job_state, job_history
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) DATABASE — métricas coletadas (uma linha por cliente+plataforma+identificador)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.database_rows (
  id              BIGSERIAL PRIMARY KEY,
  data            TEXT,
  cliente         TEXT NOT NULL,
  plataforma      TEXT NOT NULL,
  saldo           TEXT,
  gasto_ontem     TEXT,
  media_diaria    TEXT,
  dias_restantes  TEXT,
  gestor          TEXT,
  supervisor      TEXT,
  status          TEXT DEFAULT 'Atualizada',
  obs             TEXT,
  data_iso        TIMESTAMPTZ,
  identificador   TEXT DEFAULT '',
  ordem_configs   INTEGER DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Garante que a coluna ordem_configs exista mesmo em bases já criadas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'database_rows' AND column_name = 'ordem_configs'
  ) THEN
    ALTER TABLE public.database_rows ADD COLUMN ordem_configs INTEGER DEFAULT 0;
  END IF;
END$$;

-- Constraint única: um registro por cliente + plataforma + identificador.
-- Permite o upsert idempotente usado pelo run.js (onConflict: 'cliente,plataforma,identificador').
-- O identificador costuma ser vazio (''), então a maioria dos clientes fica única por (cliente,plataforma).
-- Para Meta com cartão (identificador='💳 CARTÃO') o identificador distingue da conta normal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_database_rows_cpi'
  ) THEN
    ALTER TABLE public.database_rows
      ADD CONSTRAINT uq_database_rows_cpi UNIQUE (cliente, plataforma, identificador);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_database_rows_gestor       ON public.database_rows (gestor);
CREATE INDEX IF NOT EXISTS idx_database_rows_supervisor    ON public.database_rows (supervisor);
CREATE INDEX IF NOT EXISTS idx_database_rows_plataforma    ON public.database_rows (plataforma);
CREATE INDEX IF NOT EXISTS idx_database_rows_updated_at    ON public.database_rows (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_rows_ordem_configs ON public.database_rows (ordem_configs);

-- ---------------------------------------------------------------------------
-- 2) JOB_STATE — estado do job (linha única, sempre sobrescrita)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_state (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  status          TEXT DEFAULT 'idle',
  "jobId"         TEXT,
  generation      INTEGER DEFAULT 0,
  cursor          INTEGER DEFAULT 0,
  "progressCursor" INTEGER DEFAULT 0,
  "totalClients"  INTEGER DEFAULT 0,
  "leaseUntil"    BIGINT DEFAULT 0,
  "updatedAt"     TIMESTAMPTZ DEFAULT now(),
  owner           TEXT,
  "heartbeatAt"   TIMESTAMPTZ,
  attempts        INTEGER DEFAULT 0,
  "lastError"     TEXT,
  "lastAction"    TEXT,
  "takeoverBy"    TEXT,
  "auditPointer"  TEXT DEFAULT 'JOB_HISTORY',
  stage           TEXT DEFAULT 'idle',
  cliente_atual   TEXT DEFAULT '',
  CONSTRAINT job_state_singleton CHECK (id = 1)
);

-- Garante colunas novas mesmo em bases já criadas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'job_state' AND column_name = 'cliente_atual'
  ) THEN
    ALTER TABLE public.job_state ADD COLUMN cliente_atual TEXT DEFAULT '';
  END IF;
END$$;

-- Garante que sempre exista a linha única (id=1)
INSERT INTO public.job_state (id, status)
VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) JOB_HISTORY — auditoria de ações do job (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_history (
  id            BIGSERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ DEFAULT now(),
  "jobId"       TEXT,
  generation    INTEGER,
  action        TEXT,
  owner         TEXT,
  cursor        INTEGER,
  "leaseUntil"  BIGINT,
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_history_timestamp  ON public.job_history (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_job_history_jobId      ON public.job_history ("jobId");
CREATE INDEX IF NOT EXISTS idx_job_history_generation  ON public.job_history (generation);

-- ---------------------------------------------------------------------------
-- 4) Row Level Security (RLS)
--    Habilitamos RLS mas criamos policies permissivas para a anon key.
--    Como a aplicação usa a anon key (servidor serverless), qualquer chamada
--    com a chave consegue ler/escrever. Para ambientes mais restritivos,
--    ajuste as policies para usar service_role key.
-- ---------------------------------------------------------------------------
ALTER TABLE public.database_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_history   ENABLE ROW LEVEL SECURITY;

-- Policies permissivas para anon+authenticated (usando anon key no backend)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_all_database_rows' AND schemaname = 'public' AND tablename = 'database_rows') THEN
    CREATE POLICY public_all_database_rows ON public.database_rows
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_all_job_state' AND schemaname = 'public' AND tablename = 'job_state') THEN
    CREATE POLICY public_all_job_state ON public.job_state
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_all_job_history' AND schemaname = 'public' AND tablename = 'job_history') THEN
    CREATE POLICY public_all_job_history ON public.job_history
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 5) Função upsert para a JOB_STATE (opcional — útilizávia em casos que
--    queiram chamar via RPC em vez do client JS). Mantida para referência.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_job_state(
  p_status          TEXT,
  p_jobId           TEXT,
  p_generation      INTEGER,
  p_cursor          INTEGER,
  p_progressCursor  INTEGER,
  p_totalClients    INTEGER,
  p_leaseUntil      BIGINT,
  p_updatedAt       TIMESTAMPTZ,
  p_owner           TEXT,
  p_heartbeatAt     TIMESTAMPTZ,
  p_attempts        INTEGER,
  p_lastError       TEXT,
  p_lastAction      TEXT,
  p_takeoverBy      TEXT,
  p_auditPointer    TEXT,
  p_stage           TEXT
) RETURNS public.job_state AS $$
  INSERT INTO public.job_state (
    id, status, "jobId", generation, cursor, "progressCursor", "totalClients",
    "leaseUntil", "updatedAt", owner, "heartbeatAt", attempts, "lastError",
    "lastAction", "takeoverBy", "auditPointer", stage
  ) VALUES (
    1, p_status, p_jobId, p_generation, p_cursor, p_progressCursor,
    p_totalClients, p_leaseUntil, p_updatedAt, p_owner, p_heartbeatAt,
    p_attempts, p_lastError, p_lastAction, p_takeoverBy, p_auditPointer, p_stage
  )
  ON CONFLICT (id) DO UPDATE SET
    status          = EXCLUDED.status,
    "jobId"         = EXCLUDED."jobId",
    generation      = EXCLUDED.generation,
    cursor          = EXCLUDED.cursor,
    "progressCursor" = EXCLUDED."progressCursor",
    "totalClients"   = EXCLUDED."totalClients",
    "leaseUntil"    = EXCLUDED."leaseUntil",
    "updatedAt"     = EXCLUDED."updatedAt",
    owner           = EXCLUDED.owner,
    "heartbeatAt"   = EXCLUDED."heartbeatAt",
    attempts        = EXCLUDED.attempts,
    "lastError"     = EXCLUDED."lastError",
    "lastAction"    = EXCLUDED."lastAction",
    "takeoverBy"    = EXCLUDED."takeoverBy",
    "auditPointer"  = EXCLUDED."auditPointer",
    stage           = EXCLUDED.stage
  RETURNING *;
$$ LANGUAGE SQL;

-- ---------------------------------------------------------------------------
-- 6) Auto-update updated_at na database_rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_database_rows_updated_at ON public.database_rows;
CREATE TRIGGER trg_database_rows_updated_at
  BEFORE UPDATE ON public.database_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) JOB_QUEUE — fila de jobs (formato A: enqueue + worker polling)
--    O Apps Script dispara /api/cron/advance-queue a cada 1 min; o endpoint
--    pega o item mais antigo 'pending', marca como 'running' e processa.
--    Se esgota o tempo da função (150s), re-enfileira como 'pending' para
--    o próximo tick continuar; se termina, marca 'completed'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_queue (
  id            BIGSERIAL PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | completed | failed
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  triggered_by  TEXT DEFAULT 'cron',                 -- 'cron' | 'manual' | owner name
  options       JSONB DEFAULT '{}'::jsonb,            -- batchSize, resetCursor, databaseOnly, etc.
  attempts      INTEGER NOT NULL DEFAULT 0,          -- quantas vezes já foi claimed
  error         TEXT,
  result        JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status       ON public.job_queue (status);
CREATE INDEX IF NOT EXISTS idx_job_queue_enqueued_at  ON public.job_queue (enqueued_at);

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_all_job_queue' AND schemaname = 'public' AND tablename = 'job_queue') THEN
    CREATE POLICY public_all_job_queue ON public.job_queue
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Re-enfileira jobs 'running' que estão estourados (worker morreu no meio).
-- O endpoint advance-queue chama isso no início de cada tick.
-- Limite configurável: default 5 min (300s).
CREATE OR REPLACE FUNCTION public.reenqueue_stale_running(p_stale_after_seconds INTEGER DEFAULT 300)
RETURNS TABLE (id BIGINT, attempts INTEGER) AS $$
  WITH stale AS (
    UPDATE public.job_queue
      SET status = 'pending'
      WHERE status = 'running'
        AND started_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - started_at)) > p_stale_after_seconds
      RETURNING id, attempts
  )
  SELECT id, attempts FROM stale;
$$ LANGUAGE SQL;

-- ---------------------------------------------------------------------------
-- Verificações rápidas (rode manualmente após aplicar)
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.job_state;
-- SELECT * FROM public.job_history ORDER BY created_at DESC LIMIT 10;
-- SELECT cliente, plataforma, saldo, gestor, status, updated_at FROM public.database_rows LIMIT 20;
-- SELECT id, status, triggered_by, enqueued_at, started_at, finished_at FROM public.job_queue ORDER BY id DESC LIMIT 10;
