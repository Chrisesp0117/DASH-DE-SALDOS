# DASH-DE-SALDOS

## Dashboard financeiro de saldos (planilha-first)

Projeto serverless para monitorar saldos e gastos de contas Google Ads e Meta Ads e gravar os resultados no Google Sheets. A interação é feita via planilha e endpoints HTTP.

### Objetivo da arquitetura

Executar atualizações e relatórios sem processo contínuo, usando:

- **Vercel** para hospedar endpoints HTTP
- **cron-job.org** (ou similar) para agendamentos periódicos

---

## Fluxo ponta a ponta

### 1) Atualização da planilha

O job principal lê a aba **CONFIGS**, consulta as APIs externas e escreve o resultado na aba **DATABASE**. O progresso entre invocações fica na aba **JOB_STATE** (cursor e lease).

### 2) Relatórios automáticos

Relatórios podem ser gerados através de chamadas HTTP (por exemplo `api/report`) e agendados externamente.

---

## Atualização automática (cron)

Use o endpoint principal (atualização completa em fatias dentro do tempo da função, depois supervisor + dashboards ao terminar):

`GET` ou `POST`  
`https://<seu-dominio>.vercel.app/api/cron/update-full?secret=<CRON_SECRET>`

Autenticação: query `secret` ou `token`, ou header `x-cron-secret` / `x-cron-job-secret` (valor igual a `CRON_SECRET` no ambiente).

Comportamento típico:

- Cada chamada processa até esgotar o orçamento de tempo (`CRON_MAX_RUNTIME_MS`, padrão 45000 ms na função) e pode retornar `finished: false` com `reason` (por exemplo `time_budget_reached`). O próximo disparo do cron continua a partir do cursor na planilha.
- Quando `finished: true`, a DATABASE foi percorrida e os agregados/dashboards foram atualizados nessa execução.

**Frequência sugerida:** intervalo curto o suficiente para vários ticks completarem um ciclo (por exemplo a cada 2–5 minutos), ou aumente `batchSize` na query se as APIs aguentarem.

Query opcionais em `update-full`:

| Parâmetro | Efeito |
|-----------|--------|
| `batchSize` | Tamanho do lote por iteração interna (mínimo 5 neste endpoint). |
| `reset=true` ou `reset=1` | Inicia um ciclo novo do zero (`cursor` zerado ao adquirir o lock). |
| `databaseOnly=true` ou `databaseOnly=1` | Só fase DATABASE até concluir; não roda supervisor/dashboards nesta execução. Use em conjunto com o cron de dashboards abaixo. |

**Cron só DATABASE (fase A):**  
`/api/cron/update-full?secret=...&databaseOnly=1`

**Cron dashboards e blocos (fase B):** após a DATABASE estável, pode agendar:

`/api/cron/dashboards?secret=...`

**Lote leve (uma invocação, sem loop completo):**  
`/api/cron/update?secret=...` — executa um único passo de atualização da DATABASE (útil para testes ou carga baixa).

**Compatibilidade:** `GET` ou `POST` em `/api/update?secret=...` equivale ao mesmo handler que `update-full` (arquivo `api/update.js`).

---

## Atualização manual

1. Abra no navegador:  
   `https://<seu-dominio>.vercel.app/api/update-now?secret=<CRON_SECRET>`
2. A página consulta `GET /api/update-status?secret=...` (JSON) e dispara `POST /api/update-now` ao clicar em atualizar.

Query opcionais no POST (mesma URL): `batchSize`, `force=1` (ignora checagem de job já em execução no servidor), `reset=1`, `databaseOnly=1`.

---

## Endpoints (resumo)

| Caminho | Uso |
|---------|-----|
| `/api/cron/update-full` | Cron principal: DATABASE em fatias + agregados ao final (ou só DATABASE com `databaseOnly`). |
| `/api/cron/update` | Um único lote de DATABASE (sem loop multi-iteração deste handler). |
| `/api/cron/dashboards` | Supervisor + dashboards. |
| `/api/update` | Mesmo comportamento que delegar para `update-full` (compatível com agendamentos antigos). |
| `/api/update-now` | GET: página manual; POST: mesmo motor que `update-full` (JSON). |
| `/api/update-status` | JSON: estado do job e contagem de linhas em CONFIGS. |
| `/api/report` | Relatório em texto. |
| `/api/cron/report-8h` / `/api/cron/report-17h` | Relatórios agendados. |

Rotas em `/api/...` que não existem respondem **JSON** `404` com `{ ok: false, error: 'Not found', path }` (não `text/plain`).

Se o deploy encaminhar todo o tráfego pelo `index.js` da raiz, ele espelha as mesmas rotas da pasta `api/`.

---

## Estrutura do projeto

- `src/run.js` — job principal de escrita na planilha e estado `JOB_STATE`
- `src/core/calculator.js` — cálculos e normalização de métricas
- `src/core/reportGenerator.js` — geração do relatório (string)
- `src/core/serverlessJobs.js` — jobs serverless, auth de cron, `runFullUpdateJob`
- `src/core/visualBlocks.js` — blocos visuais por gestor
- `src/services/googleAds.js` — Google Ads
- `src/services/meta.js` — Meta Ads
- `src/services/sheets.js` — Google Sheets

---

## Dependências externas

- Google Sheets API
- Google Ads API
- Meta Graph API
- Agendador HTTP (ex.: cron-job.org)

---

## Variáveis de ambiente

Crie um `.env` com:

```env
# Google Ads
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret
REFRESH_TOKEN=seu_refresh_token
DEVELOPER_TOKEN=seu_developer_token

# MCCs
MCC_ID=seu_mcc_principal
MCC_FALLBACK_1=seu_mcc_fallback_1
MCC_FALLBACK_2=seu_mcc_fallback_2

# Google Sheets
SPREADSHEET_ID=seu_spreadsheet_id

# Meta
META_TOKEN=seu_meta_token

# Cron
CRON_SECRET=segredo_compartilhado_para_cron

# Opcional: tempo máximo por invocação de update-full (ms)
# CRON_MAX_RUNTIME_MS=45000

# Opcional: tamanho de lote padrão
# UPDATE_BATCH_SIZE=5

# Ambiente
NODE_ENV=production
```

---

## Como usar

1. Configure as variáveis de ambiente na Vercel.
2. Agende `api/cron/update-full` no cron-job.org com `secret` na query ou header, na frequência adequada para concluir ciclos parciais.
3. Opcional: cron separado com `databaseOnly=1` e outro com `api/cron/dashboards`.
4. Agende `api/report` conforme desejado (por exemplo 8h e 17h locais).

---

## Resumo rápido

Este projeto coleta dados de Google Ads e Meta Ads, grava métricas no Google Sheets, gera relatórios sob demanda, oferece atualização manual em `/api/update-now` e roda sem processo contínuo.
