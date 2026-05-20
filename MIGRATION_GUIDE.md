# 🚀 Plano de Migração para Supabase - Passo a Passo

## FASE 1: Setup Inicial (5-10 min)

### 1.1 Criar Projeto Supabase
```
1. Ir em https://supabase.com/dashboard
2. Click "New Project"
3. Nome: dash-de-saldos
4. Region: São Paulo (sa-east-1) ou mais próximo
5. Password: salvar em local seguro
6. Click "Create new project" (esperar 2-3 min)
```

### 1.2 Copiar Credenciais
```
1. Ir em Settings > API
2. Copiar "Project URL" → SUPABASE_URL no .env
3. Copiar "anon public" key → SUPABASE_KEY no .env
4. Salvar e testar conexão
```

### 1.3 Criar Tabelas
```
1. No Supabase, ir em SQL Editor
2. Click "New Query"
3. Copiar TODO o SQL de SUPABASE_SETUP.md
4. Click "Run"
5. Verificar: Deve criar job_state, job_history, upsert_job_state, policies
```

### 1.4 Verificar Setup
```sql
-- Execute no SQL Editor do Supabase:
SELECT * FROM job_state;
SELECT * FROM job_history ORDER BY created_at DESC LIMIT 5;
```

---

## FASE 2: Testar Localmente (5-10 min)

### 2.1 Adicionar Credenciais ao .env
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc...
USE_SUPABASE=false  # Começar com false (fallback pra Sheets)
SUPABASE_FALLBACK=true
```

### 2.2 Rodar Testes
```bash
npm test -- test/supabase-migration.test.js
```

Esperado:
```
✓ Teste 1: Read job state
✓ Teste 2: Acquire job lock
✓ Teste 3: Touch job state
✓ Teste 4: Heartbeat
✓ Teste 5: Release job state
✅ Todos os testes passaram!
```

### 2.3 Verificar Dados no Supabase
```
1. Ir em https://supabase.com/dashboard/project/XXX/editor
2. Table "job_state" → deve ter 1 linha com dados do teste
3. Table "job_history" → deve ter 3-5 linhas (acquire, touch, release)
```

---

## FASE 3: Deploy em Produção (com Fallback)

### 3.1 Deploy Primeira Versão
```bash
# NO VERCEL ou seu deploy:
git push origin main

# Configurar variáveis em Vercel:
# USE_SUPABASE=false (ainda usa Sheets, mas código pronto)
# SUPABASE_URL=https://xxxxx.supabase.co
# SUPABASE_KEY=eyJhbGc...
```

Resultado: Tudo continua funcionando com Sheets, Supabase fica pronto

### 3.2 Monitorar 24h
```
- Update-now continua funcionando
- Não deve haver novos bugs
- Logs devem estar limpos
```

---

## FASE 4: Switch para Supabase (Gradual)

### 4.1 Dia 1: 10% em Supabase
```bash
# Usar canary deployment ou feature flag
# USE_SUPABASE=true para 10% dos requests

# Monitorar:
- npm logs no Vercel
- Procurar por [jobStateAdapter-fallback] (se houver, é fallback)
- Procurar por [readJobState-supabase] (deve aparecer)
```

### 4.2 Dia 2: 50% em Supabase
Se Dia 1 OK:
```bash
USE_SUPABASE=true para 50% (metade dos usuários)
```

### 4.3 Dia 3: 100% em Supabase
```bash
USE_SUPABASE=true para TODOS
SUPABASE_FALLBACK=true ainda ativo (fallback se algo quebrar)
```

### 4.4 Dia 4: Remover Fallback
```bash
SUPABASE_FALLBACK=false
# Agora é 100% Supabase, sem rede de segurança
```

---

## FASE 5: Cleanup (após 1 semana)

### 5.1 Remover Código de Sheets
```javascript
// src/core/jobState.js → pode ser deletado
// src/core/jobStateAdapter.js → pode ser deletado
// Manter apenas jobStateSupabase.js

// Em serverlessJobs.js, trocar:
const jobState = require('./jobStateAdapter');
// Para:
const jobState = require('./jobStateSupabase');
```

### 5.2 Limpar Dados Antigos
```sql
-- No Supabase SQL Editor (após 30 dias):
DELETE FROM job_history 
WHERE created_at < NOW() - INTERVAL '30 days';
```

### 5.3 Atualizar Documentação
- Remover referências a Google Sheets para jobState
- Documentar que configs ainda estão em Sheets

---

## ✅ Checkpoints de Validação

### Durante cada fase, verificar:

```
✓ Logs aparecem [readJobState-supabase] ou [readJobState] (Sheets)
✓ totalClients está correto em update-status
✓ progressCursor avança sem travar
✓ Múltiplas chamadas a update-now retornam 409 (não afeta Supabase)
✓ Generation incrementa e é respeitada
✓ Heartbeat está acontecendo (logs a cada 20s)
✓ Job completa com stage=done
✓ Nenhum [jobStateAdapter-fallback] nos logs (indicaria problema)
```

---

## ⚠️ Troubleshooting

### Se Supabase falhar durante testes:

1. **Erro: SUPABASE_URL não definida**
   ```
   Solução: Copiar URL do Supabase dashboard → .env
   ```

2. **Erro: 401 Unauthorized**
   ```
   Solução: SUPABASE_KEY errada → copiar novamente do dashboard
   ```

3. **Erro: Row not found**
   ```
   Solução: Tabela vazia → código cria automaticamente, retry
   ```

4. **Erro: Generation mismatch**
   ```
   Solução: Normal durante testes de múltiplos workers, verificar logs
   ```

### Se Fallback para Sheets:

1. Verificar erro no log: `[jobStateAdapter-fallback]`
2. Ir no Supabase → SQL Editor → verificar se tabelas existem
3. Verificar se SUPABASE_URL e SUPABASE_KEY estão corretos
4. Reintentar testes

---

## 📊 Métricas para Acompanhar

Após cada fase, verificar no Vercel:

```
- Tempo de resposta de /api/update-now (deve manter < 2s)
- Taxa de erro (deve manter 0%)
- Uso de CPU/memória (pode reduzir, menos I/O com Sheets)
- Logs (devem estar limpos)
```

---

## 📝 Comandos Úteis

```bash
# Testar localmente
npm test -- test/supabase-migration.test.js

# Ver logs em produção
vercel logs

# Acessar Supabase
https://supabase.com/dashboard/project/XXX/editor

# SQL queries úteis
SELECT COUNT(*) FROM job_history;  -- Ver histórico
SELECT * FROM job_state;           -- Ver estado atual
TRUNCATE TABLE job_history;        -- Limpar histórico (cuidado!)
```

---

**Status: Pronto para começar FASE 1!**

Próximo: 
1. Criar projeto no Supabase
2. Executar SQL do SUPABASE_SETUP.md
3. Rodar testes locais
4. Deploy em prod com USE_SUPABASE=false
