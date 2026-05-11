# DASH-DE-SALDOS

## 📊 Dashboard Financeiro de Saldos (Planilha-First)

Projeto serverless para monitorar saldos e gastos de contas Google Ads e Meta Ads e gravar os resultados no Google Sheets. A integração com bots/webhooks foi removida — toda interação é feita via planilha e endpoints HTTP.

### Objetivo da arquitetura

Executar atualizações e relatórios sem processo contínuo, usando:

- **Vercel** para hospedar endpoints HTTP
- **cron-job.org** para agendamentos periódicos

---

## Fluxo ponta a ponta

### 1) Atualização da planilha

O job principal lê a aba **Clientes**, consulta as APIs externas e escreve o resultado na aba **DATABASE**.

**Passos:**

1. Lê a lista de clientes em Google Sheets.
2. Filtra linhas marcadas para processar.
3. Consulta Google Ads ou Meta, conforme a plataforma.
4. Calcula saldo, gasto, média e dias restantes.
5. Grava os resultados na aba **DATABASE**.
6. Atualiza formatação e blocos visuais.

### 2) Relatórios automáticos

Relatórios podem ser gerados através de chamadas HTTP (ex.: `api/report`) e agendados externamente.

---

## Endpoints principais

- `api/update` — atualiza a planilha
- `api/report` — gera o relatório atual (retorna texto)

### Endpoints de compatibilidade / legado

- `api/cron/update`
- `api/cron/report-8h`
- `api/cron/report-17h`
- `api/cron/bootstrap-webhook` (pode ser removido se não usado)

---

## Estrutura do projeto

- `src/index.js` — job principal de atualização da planilha
- `src/core/calculator.js` — cálculos e normalização de métricas
- `src/core/reportGenerator.js` — geração do relatório (string)
- `src/core/serverlessJobs.js` — helpers de jobs serverless e auth de cron
- `src/core/visualBlocks.js` — blocos visuais por gestor
- `src/services/googleAds.js` — integração com Google Ads
- `src/services/meta.js` — integração com Meta Ads
- `src/services/sheets.js` — integração com Google Sheets

---

## Dependências externas

O sistema usa:

- Google Sheets API
- Google Ads API
- Meta Graph API
- cron-job.org

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

# Ambiente
NODE_ENV=production
```

---

## Como usar

1. Configure as variáveis de ambiente no Vercel.
2. Agende `api/cron/update-full` no `cron-job.org` (ex.: a cada 2 horas) e envie o `CRON_SECRET` via query (`?secret=...`) ou header (`x-cron-secret`).
3. Agende `api/report` conforme desejado (ex.: 8h e 17h locais).

---

## Resumo rápido

Este projeto:

- coleta dados de Google Ads e Meta Ads
- grava métricas no Google Sheets
- gera relatórios sob demanda
- aceita atualização manual via `/atualizar`
- roda sem processo contínuo

É uma arquitetura enxuta, compatível com serverless, barata de manter e fácil de operar.
