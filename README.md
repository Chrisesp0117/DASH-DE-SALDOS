# DASH-DE-SALDOS

## Dashboard financeiro de saldos (planilha-first)

Projeto serverless para monitorar saldos e gastos de contas Google Ads e Meta Ads e gravar os resultados no Google Sheets. A interação é feita via planilha e endpoints HTTP.

### Objetivo da arquitetura

Executar atualizações e relatórios sem processo contínuo, usando:

- **Vercel** para hospedar endpoints HTTP
- **Apps Script** (gatilho de tempo) para disparar o worker a cada 1 minuto

---

## Fluxo ponta a ponta

### 0) Configuração pela página web

A aba **CONFIGS** deixou de ser o painel de configuração. Agora as contas são gerenciadas em:

`https://<seu-dominio>.vercel.app/api/settings-ui?secret=<CRON_SECRET>`

Por lá você:

1. **Busca as contas de anúncio** vinculadas aos tokens das variáveis de ambiente — `REFRESH_TOKEN` (Google Ads: `listAccessibleCustomers`) e `META_TOKEN` (Meta Ads: `/me/adaccounts`). Não há conexão de perfil/OAuth: toda conta acessível por esses tokens aparece na lista.
2. **Seleciona quais contas entram na planilha** e preenche por conta: cliente, gestor, supervisor, MCC/Login (Google) e revisão. As escolhas ficam na tabela `accounts_config`.
3. (Transição) **Importa a aba CONFIGS** com um clique, preservando gestores/supervisores/revisões já preenchidos.

A aba CONFIGS da planilha continua funcionando como **fallback** enquanto `accounts_config` estiver vazia — depois de importar/configurar pela web, a aba pode ser aposentada.

### 1) Atualização da planilha

O job principal lê as contas da tabela **`accounts_config`** (Supabase; fallback: aba CONFIGS), consulta as APIs externas e escreve o resultado no Supabase (tabela `database_rows`). O progresso entre invocações fica em `job_state` no Supabase (cursor e lease). Em seguida gera as abas **SUPERVISOR** e **DASH-{Gestor}** na planilha.

### 2) Relatórios automáticos

Relatórios podem ser gerados através de chamadas HTTP (por exemplo `api/report`) e agendados externamente.

---

## Atualização automática (Apps Script → fila → worker)

A arquitetura **desacopla disparo de execução** via uma fila de jobs no Supabase:

1. **Disparo (enfileirar):** qualquer origem (cron, botão manual, Apps Script) chama  
   `POST /api/cron/enqueue?secret=<CRON_SECRET>[&batchSize=...][&reset=1][&databaseOnly=1]`  
   Esse endpoint só cria uma linha `pending` na tabela `job_queue` do Supabase e responde **202** em <200ms. Nenhum processamento de cliente acontece aqui.

2. **Worker (consome a fila):** um acionador de tempo do Apps Script (`avancarFilaAutomaticamente` em `appscript/Cron.gs`) dispara a cada **1 minuto**:  
   `POST /api/cron/advance-queue?secret=<CRON_SECRET>`  
   Esse endpoint:
   - Re-enfileira jobs `running` stale (worker anterior morreu — default 5 min).
   - Tenta `claimNextPending()` (atomicamente; vários ticks concorrentes não duplicam).
   - Se não há `pending` → 200 OK (`idle`).
   - Se há `pending` → marca `running`, assume o lock do `job_state`, processa em fatias (cursor salvo no Postgres) até esgotar ~150s do Vercel.
     - Se esgotar o tempo → `reenqueueJob` (volta pra `pending`) e 202.
     - Se terminar → `completeJob` e 200.
     - Se falhar → `failJob` e 500.

3. **Continuação:** não há `fetch` recursivo (auto-chain). O próximo tick do Apps Script simplesmente chama `advance-queue` de novo, pega o próximo `pending` (que pode ser o mesmo re-enfileirado) e continua do cursor salvo no `job_state`. Em síntese: o cursor é fonte da verdade para o progresso; a `job_queue` é fonte da verdade para "o que falta rodar".

### Por que isso é melhor

- **Sem auto-chain frágil:** o Apps Script é o único gatilho, e é tolerante a falhas: se um tick falha, o próximo tenta de novo.
- **Endpoint síncrono super leve:** `enqueue` responde na hora; não há timeout nem fila no front-end.
- **Lock confiável:** estado em Postgres, sem competição com a cota da Sheets API.
- **Workers concorrentes:** o `claimNextPending` usa `.eq('status','pending')` para evitar duplicar jobs entre ticks concorrentes (race-safe).

### Endpoints

| Caminho | Uso |
|---------|-----|
| `/api/settings-ui` | Página web de configuração (seleção de contas de anúncio). |
| `/api/settings` | JSON: presença dos tokens + contas salvas. |
| `/api/settings/accounts` | GET: contas salvas · POST: substitui a lista de contas. |
| `/api/settings/import-configs` | POST: importa (uma última vez) a aba CONFIGS para o banco. |
| `/api/accounts/discover` | GET: lista contas Google Ads + Meta vinculadas aos tokens do ambiente. |
| `/api/cron/enqueue` | Enfileira um job (202 Accepted). Aceita `batchSize`, `reset=1`, `databaseOnly=1`, `triggered_by`. |
| `/api/cron/advance-queue` | Worker: pega próximo `pending`, processa, re-enfileira ou completa. |
| `/api/cron/dashboards` | Supervisor + dashboards. |
| `/api/update-now` | GET: página manual; POST: enfileira um job (JSON). |
| `/api/update-status` | JSON: estado do job. |
| `/api/report` | Relatório em texto. |
| `/api/cron/report-8h` / `/api/cron/report-17h` | Relatórios agendados. |

Rotas em `/api/...` que não existem respondem **JSON** `404` com `{ ok: false, error: 'Not found', path }` (não `text/plain`).

Se o deploy encaminhar todo o tráfego pelo `index.js` da raiz, ele espelha as mesmas rotas da pasta `api/`.

### Como configurar no Apps Script

No script Apps Script (`appscript/Cron.gs`):
1. **Acionadores → adicionar acionador** → função: `avancarFilaAutomaticamente` → tipo: "Minuto(a)" → "a cada 1 minuto".
2. (Opcional) Para enfileirar periodicamente, adicione um acionador para `enfileirarAtualizacaoAutomatica` (ex.: a cada 2 horas).
3. (Opcional) Para enfileirar manualmente de um menu customizado, chame `enfileirarAtualizacaoManual(batchSize, resetCursor, databaseOnly)`.

---

## Atualização manual

1. Abra no navegador:  
   `https://<seu-dominio>.vercel.app/api/update-now?secret=<CRON_SECRET>`
2. A página consulta `GET /api/update-status?secret=...` (JSON) e dispara `POST /api/cron/enqueue` ao clicar em atualizar.

Query opcionais no POST (mesma URL): `batchSize`, `force=1` (ignora checagem de job já em execução no servidor), `reset=1`, `databaseOnly=1`.

---

## Estrutura do projeto

- `src/run.js` — job principal: lê `accounts_config` (fallback CONFIGS), escreve métricas no Supabase e estado `job_state` no Supabase
- `src/core/calculator.js` — cálculos e normalização de métricas
- `src/core/reportGenerator.js` — geração do relatório (lê DATABASE do Supabase)
- `src/core/serverlessJobs.js` — jobs serverless, auth de cron, `runQueuedUpdateJob`
- `src/core/visualBlocks.js` — blocos visuais por gestor (lê DATABASE do Supabase)
- `src/core/gestorDashboards.js` — abas DASH-{Gestor} (lê DATABASE do Supabase)
- `src/core/jobStateSupabase.js` — lock/cursor/heartbeat do `job_state` no Supabase
- `src/services/supabase.js` — cliente Supabase + helpers de DATABASE
- `src/services/jobQueue.js` — helpers da fila `job_queue`
- `src/services/connections.js` — tokens das variáveis de ambiente (REFRESH_TOKEN / META_TOKEN)
- `src/services/accountsConfig.js` — contas selecionadas na web (`accounts_config`) + importação da CONFIGS
- `src/services/googleAds.js` — Google Ads
- `src/services/meta.js` — Meta Ads
- `src/services/sheets.js` — Google Sheets (planilha destino + CONFIGS legado)
- `api/settings-ui.js` — página web de configurações (conexões + seleção de contas)
- `appscript/` — Apps Script da planilha (Config.gs, Menu.gs, Cron.gs)

---

## Dependências externas

- Google Sheets API
- Google Ads API
- Meta Graph API
- Supabase (Postgres)

---

## Variáveis de ambiente

Crie um `.env` com (veja o `.env.example` completo):

```env
# Google Ads (o REFRESH_TOKEN determina quais contas aparecem na página web)
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret
DEVELOPER_TOKEN=seu_developer_token
REFRESH_TOKEN=seu_refresh_token

# Meta Ads (o META_TOKEN determina quais contas aparecem na página web)
META_TOKEN=seu_meta_token

# Google Sheets (planilha de destino — escrita via service account)
SPREADSHEET_ID=seu_spreadsheet_id

# Supabase (DATABASE + JOB_STATE + JOB_QUEUE + ACCOUNTS_CONFIG)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGc...

# Cron
CRON_SECRET=segredo_compartilhado_para_cron
```

> **Atenção:** rode primeiro o SQL em `supabase_schema.sql` no SQL Editor do Supabase (inclui `accounts_config`) antes de subir o deploy. Quem já criou a tabela legada `app_connections` pode removê-la: `DROP TABLE IF EXISTS public.app_connections;`

---

## Como usar

1. Rode o SQL em `supabase_schema.sql` no Supabase.
2. Configure as variáveis de ambiente na Vercel (tokens de Google Ads e Meta Ads).
3. Abra `/api/settings-ui?secret=<CRON_SECRET>` → busque as contas → selecione quais vão para a planilha (ou importe a CONFIGS) → salve.
4. Configure o acionador do Apps Script `avancarFilaAutomaticamente` a cada 1 minuto (worker).
5. (Opcional) Configure um acionador para `enfileirarAtualizacaoAutomatica` a cada 2 horas (enfileirador).
6. Agende `api/report` conforme desejado (por exemplo 8h e 17h locais).

---

## Resumo rápido

Este projeto coleta dados de Google Ads e Meta Ads, grava métricas no Supabase, gera abas DASH-{Gestor} e SUPERVISOR na planilha, oferece atualização manual em `/api/update-now` e roda sem processo contínuo. A seleção de quais contas de anúncio entram na planilha é feita pela página web `/api/settings-ui`, usando os tokens fixos do ambiente.
