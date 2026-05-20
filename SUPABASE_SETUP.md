# Migração para Supabase

## 1. Criar Projeto Supabase

1. Ir em https://supabase.com
2. Create New Project
3. Nome: `dash-de-saldos`
4. Region: São Paulo (sa-east-1) ou mais próximo
5. Copy `URL` e `anon key` para `.env`

## 2. Variáveis de Ambiente

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGc...
```

## 3. Criar Tabelas

Execute este SQL no Supabase SQL Editor:

```sql
-- Tabela de estado do job (única linha, sempre sobrescrita)
CREATE TABLE job_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status TEXT DEFAULT 'idle',
  jobId TEXT,
  generation INTEGER DEFAULT 0,
  cursor INTEGER DEFAULT 0,
  progressCursor INTEGER DEFAULT 0,
  totalClients INTEGER DEFAULT 0,
  leaseUntil BIGINT DEFAULT 0,
  updatedAt TIMESTAMP DEFAULT NOW(),
  owner TEXT,
  heartbeatAt TIMESTAMP,
  attempts INTEGER DEFAULT 0,
  lastError TEXT,
  lastAction TEXT,
  takeoverBy TEXT,
  auditPointer TEXT DEFAULT 'JOB_HISTORY',
  stage TEXT DEFAULT 'idle',
  CHECK (id = 1) -- Force single row
);

-- Histórico de ações (audit trail)
CREATE TABLE job_history (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  jobId TEXT,
  generation INTEGER,
  action TEXT,
  owner TEXT,
  cursor INTEGER,
  leaseUntil BIGINT,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_job_history_timestamp ON job_history(timestamp DESC);
CREATE INDEX idx_job_history_jobId ON job_history(jobId);

-- Enable Row Level Security
ALTER TABLE job_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_history ENABLE ROW LEVEL SECURITY;

-- Policies (allow all for now, tighten later)
CREATE POLICY "Enable all for authenticated users" ON job_state
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Enable all for authenticated users" ON job_history
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Upsert function para jobState
CREATE OR REPLACE FUNCTION upsert_job_state(
  p_status TEXT,
  p_jobId TEXT,
  p_generation INTEGER,
  p_cursor INTEGER,
  p_progressCursor INTEGER,
  p_totalClients INTEGER,
  p_leaseUntil BIGINT,
  p_updatedAt TIMESTAMP,
  p_owner TEXT,
  p_heartbeatAt TIMESTAMP,
  p_attempts INTEGER,
  p_lastError TEXT,
  p_lastAction TEXT,
  p_takeoverBy TEXT,
  p_auditPointer TEXT,
  p_stage TEXT
) RETURNS job_state AS $$
  INSERT INTO job_state (
    id, status, jobId, generation, cursor, progressCursor, totalClients,
    leaseUntil, updatedAt, owner, heartbeatAt, attempts, lastError,
    lastAction, takeoverBy, auditPointer, stage
  ) VALUES (
    1, p_status, p_jobId, p_generation, p_cursor, p_progressCursor,
    p_totalClients, p_leaseUntil, p_updatedAt, p_owner, p_heartbeatAt,
    p_attempts, p_lastError, p_lastAction, p_takeoverBy, p_auditPointer, p_stage
  )
  ON CONFLICT (id) DO UPDATE SET
    status = p_status,
    jobId = p_jobId,
    generation = p_generation,
    cursor = p_cursor,
    progressCursor = p_progressCursor,
    totalClients = p_totalClients,
    leaseUntil = p_leaseUntil,
    updatedAt = p_updatedAt,
    owner = p_owner,
    heartbeatAt = p_heartbeatAt,
    attempts = p_attempts,
    lastError = p_lastError,
    lastAction = p_lastAction,
    takeoverBy = p_takeoverBy,
    auditPointer = p_auditPointer,
    stage = p_stage
  RETURNING *;
$$ LANGUAGE SQL;
```

## 4. Verificar

```sql
SELECT * FROM job_state;
SELECT * FROM job_history ORDER BY created_at DESC LIMIT 10;
```

## Próximo: Implementar adapter em Node.js
