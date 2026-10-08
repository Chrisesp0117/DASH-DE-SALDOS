# DASH-DE-SALDOS

## Dashboard financeiro de saldos (planilha-first)

Projeto serverless para monitorar saldos e gastos de contas Google Ads e Meta Ads e gravar os resultados no Google Sheets. A interação é feita via planilha e endpoints HTTP.

### Objetivo da arquitetura

Executar atualizações e relatórios sem processo contínuo, usando:

- **Vercel** para hospedar endpoints HTTP
- **Apps Script** (gatilho de tempo) para disparar o worker a cada 1 minuto

---

## Fluxo ponta a ponta

### 0) Página web única (atualizações + configurações)

A configuração agora é **100% pela página web** — a aba CONFIGS da planilha não é mais usada pelo sistema. Tudo é gerenciado em uma única página:

`https://<seu-dominio>.vercel.app/api/update-now?secret=<CRON_SECRET>#configuracoes`

A página tem duas abas:

- **Atualizações** — monitor de fila (progresso, pipeline, log)
- **Configurações** — seleção das contas de anúncio:
  1. A lista de contas **carrega automaticamente** ao abrir a aba, com TODAS as contas vinculadas aos tokens do ambiente — `REFRESH_TOKEN` (Google Ads: acesso direto + hierarquia dos gerenciadores) e `META_TOKEN` (Meta Ads: `/me/adaccounts`)
  2. Cada conta tem um **ícone** (Google/Meta) e um **check** — marque as que devem entrar na planilha e preencha gestor/supervisor. Alterações são **salvas automaticamente**. Filtro por plataforma (Todas/Google/Meta) e por nome
  3. O **MCC/Login é detectado automaticamente** pela hierarquia do gerenciador (não precisa configurar)

As escolhas ficam na tabela `accounts_config` (Supabase) — fonte única do job.

> **Aba CONFIGS da planilha:** pode ser esvaziada. Se quiser, deixe nela apenas um botão que abre a página de configurações: *Inserir → Desenho* → crie um botão → nos 3 pontinhos do desenho → **Atribuir script** → `abrirConfiguracoesWeb`.

### 1) Atualização da planilha

O job principal lê as contas da tabela **`accounts_config`** (Supabase), consulta as APIs externas e escreve o resultado no Supabase (tabela `database_rows`). O progresso entre invocações fica em `job_state` no Supabase (cursor e lease). Em seguida gera as abas **SUPERVISOR** e **DASH-{Gestor}** na planilha.

### 2) Relatórios automáticos

Relatórios podem ser gerados através de chamadas HTTP (por exemplo `api/report`) e agendados externamente.

### 3) Cores das linhas (SUPERVISOR + DASH-{Gestor})

A lógica de destaque vive em **um único módulo** (`src/core/severity.js`), usado tanto pelo SUPERVISOR quanto pelas abas DASH-{Gestor} — as duas abas nunca divergem. A severidade é a maior entre:

| Condição | Cor da linha | Texto |
|---|---|---|
| Sem gasto ontem (gasto ≤ 0) | 🔴 Vermelho | Branco, em negrito |
| Duração ≤ 2 dias | 🔴 Vermelho | Branco, em negrito |
| Duração ≤ 4 dias | 🟠 Laranja | Preto, em negrito |
| Duração ≤ 6 dias | 🟡 Amarelo | Preto, em negrito |
| Duração > 6 dias (e gastando) | Zebra normal da plataforma (verde p/ Google, azul p/ Meta) | Preto |

A duração aceita textos como `"5 dias"`, `"10 horas"`, `"3,5"` e números; valores vazios ou `"-"` não destacam a linha.

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
| `/api/update-now` | GET: página única (abas Atualizações + Configurações); POST: enfileira um job (JSON). `#configuracoes` abre a aba de configurações. |
| `/api/settings-ui` | Redirect para a página única, aba Configurações (compatibilidade). |
| `/api/settings` | JSON: presença dos tokens + contas salvas. |
| `/api/settings/accounts` | GET: contas salvas · POST: substitui a lista de contas. |
| `/api/accounts/discover` | GET: lista contas Google Ads + Meta vinculadas aos tokens do ambiente. |
| `/api/cron/enqueue` | Enfileira um job (202 Accepted). Aceita `batchSize`, `reset=1`, `databaseOnly=1`, `triggered_by`. |
| `/api/cron/advance-queue` | Worker: pega próximo `pending`, processa, re-enfileira ou completa. |
| `/api/cron/dashboards` | Supervisor + dashboards. |
| `/api/update-now` | GET: página única (abas) · POST: enfileira um job (JSON). |
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

- `src/run.js` — job principal: lê `accounts_config` (Supabase), escreve métricas no Supabase e estado `job_state` no Supabase
- `src/core/calculator.js` — cálculos e normalização de métricas
- `src/core/severity.js` — severidade compartilhada das linhas (amarelo ≤ 6 dias, laranja ≤ 4, vermelho ≤ 2 ou sem gasto)
- `src/core/reportGenerator.js` — geração do relatório (lê DATABASE do Supabase)
- `src/core/serverlessJobs.js` — jobs serverless, auth de cron, `runQueuedUpdateJob`
- `src/core/visualBlocks.js` — blocos visuais por gestor (lê DATABASE do Supabase)
- `src/core/gestorDashboards.js` — abas DASH-{Gestor} (lê DATABASE do Supabase)
- `src/core/jobStateSupabase.js` — lock/cursor/heartbeat do `job_state` no Supabase
- `src/services/supabase.js` — cliente Supabase + helpers de DATABASE
- `src/services/jobQueue.js` — helpers da fila `job_queue`
- `src/services/connections.js` — tokens das variáveis de ambiente (REFRESH_TOKEN / META_TOKEN)
- `src/services/accountsConfig.js` — contas selecionadas na web (`accounts_config`, fonte única)
- `src/services/googleAds.js` — Google Ads
- `src/services/meta.js` — Meta Ads
- `src/services/sheets.js` — Google Sheets (apenas escrita visual: SUPERVISOR + DASH-{Gestor})
- `api/app-ui.js` — página web única (abas: monitor de atualizações + configuração/seleção de contas)
- `api/settings-ui.js` — redirect de compatibilidade para a aba de configurações
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
3. Abra `/api/update-now?secret=<CRON_SECRET>#configuracoes` → a lista de contas carrega sozinha → marque as que vão para a planilha (salva automático).
4. Configure o acionador do Apps Script `avancarFilaAutomaticamente` a cada 1 minuto (worker).
5. (Opcional) Configure um acionador para `enfileirarAtualizacaoAutomatica` a cada 2 horas (enfileirador).
6. Agende `api/report` conforme desejado (por exemplo 8h e 17h locais).

---

## Resumo rápido

Este projeto coleta dados de Google Ads e Meta Ads, grava métricas no Supabase, gera abas DASH-{Gestor} e SUPERVISOR na planilha, oferece atualização manual em `/api/update-now` e roda sem processo contínuo. A página única `/api/update-now` tem aba de monitor e aba de configuração, onde se escolhe — com os tokens fixos do ambiente — quais contas de anúncio entram na planilha.
