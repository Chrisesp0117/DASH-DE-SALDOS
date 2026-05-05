# DASH-DE-SALDOS

## 📊 Dashboard Financeiro de Saldos

Sistema serverless para monitorar saldos e gastos de contas Google Ads e Meta Ads, gravar os dados no Google Sheets e enviar alertas por Telegram.

### Objetivo da arquitetura

Este projeto foi simplificado para rodar **sem processo contínuo**, usando apenas:

- **Vercel** para hospedar endpoints HTTP
- **cron-job.org** para agendamentos periódicos
- **Telegram Webhook** para comandos e alertas

---

## Fluxo ponta a ponta

### 1) Atualização da planilha

O job principal lê a aba **Clientes**, consulta as APIs externas e escreve o resultado na aba **DATABASE**.

**O que acontece:**

1. Lê a lista de clientes em Google Sheets.
2. Filtra linhas marcadas para processar.
3. Consulta Google Ads ou Meta, conforme a plataforma.
4. Calcula saldo, gasto, média e dias restantes.
5. Grava tudo na aba **DATABASE**.
6. Atualiza formatação, blocos visuais e a área **BEM VINDO!**.

### 2) Telegram Webhook

O bot responde por webhook em vez de polling.

**Comandos disponíveis:**

- `/start` — resposta de boas-vindas
- `/help` — lista de comandos
- `/exam` — lê a planilha e envia o relatório atual
- `/atualizar` — dispara a atualização da planilha

### 3) Relatórios automáticos

Os relatórios são enviados por jobs agendados externos:

- **8h** — relatório matinal
- **17h** — relatório da tarde

Esses jobs são chamados pelo **cron-job.org** diretamente nos endpoints da Vercel.

---

## Endpoints principais

- [`api/update`](api/update.js) — atualiza a planilha
- [`api/report`](api/report.js) — gera e envia relatório atual
- [`api/telegram`](api/telegram.js) — recebe updates do Telegram
- [`api/setup-webhook`](api/setup-webhook.js) — registra o webhook do Telegram
- [`api/webhook-info`](api/webhook-info.js) — mostra o status do webhook

### Endpoints de compatibilidade / legado

- [`api/cron/update`](api/cron/update.js)
- [`api/cron/report-8h`](api/cron/report-8h.js)
- [`api/cron/report-17h`](api/cron/report-17h.js)
- [`api/cron/bootstrap-webhook`](api/cron/bootstrap-webhook.js)

---

## Estrutura do projeto

- [`src/index.js`](src/index.js) — job principal de atualização da planilha
- [`src/core/calculator.js`](src/core/calculator.js) — cálculos e normalização de métricas
- [`src/core/reportGenerator.js`](src/core/reportGenerator.js) — geração do relatório para Telegram
- [`src/core/serverlessJobs.js`](src/core/serverlessJobs.js) — helpers de jobs serverless e auth de cron
- [`src/core/visualBlocks.js`](src/core/visualBlocks.js) — blocos visuais por gestor
- [`src/services/googleAds.js`](src/services/googleAds.js) — integração com Google Ads
- [`src/services/meta.js`](src/services/meta.js) — integração com Meta Ads
- [`src/services/sheets.js`](src/services/sheets.js) — integração com Google Sheets
- [`src/services/telegram.js`](src/services/telegram.js) — bot Telegram, webhook e alertas

---

## Arquitetura recomendada

### Modelo final

**Event-driven e serverless**

- Vercel hospeda as rotas HTTP.
- cron-job.org chama os jobs agendados.
- Telegram chama o webhook quando houver comando.
- A lógica principal é executada sob demanda.

### O que não deve existir mais em produção

- processo contínuo / daemon
- scheduler interno com timers
- dependência de memória local para agendamento
- dependência de `users.json` para persistir alertas

---

## Como os dados fluem

1. A planilha recebe um POST do cron-job.org em `/api/update`.
2. O job lê **Clientes** e atualiza a aba **DATABASE**.
3. O Telegram chama `/api/telegram` por webhook.
4. O bot interpreta o comando e responde.
5. O cron-job.org chama `/api/report` às 8h e 17h.
6. O relatório é lido da planilha atualizada e enviado aos destinos configurados.

---

## Dependências externas

O sistema usa:

- **Google Sheets API**
- **Google Ads API**
- **Meta Graph API**
- **Telegram Bot API**
- **cron-job.org**

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

# Telegram
TELEGRAM_BOT_TOKEN=seu_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=segredo_do_webhook
TELEGRAM_WEBHOOK_URL=https://seu-dominio-vercel-ou-personalizado
TELEGRAM_ALERT_CHAT_ID=123456789
TELEGRAM_ALERT_CHAT_IDS=123456789,987654321

# Cron
CRON_SECRET=segredo_compartilhado_para_cron

# Ambiente
NODE_ENV=production
```

### Regras das variáveis

- `TELEGRAM_WEBHOOK_URL` deve ser a **base pública** do projeto.
- `TELEGRAM_ALERT_CHAT_ID` ou `TELEGRAM_ALERT_CHAT_IDS` definem para onde os alertas serão enviados.
- `CRON_SECRET` protege os endpoints de job contra chamadas públicas.

---

## Comandos do Telegram

### `/start`
Responde com uma mensagem de boas-vindas e confirma que o webhook está ativo.

### `/help`
Lista os comandos suportados.

### `/exam`
Gera o relatório atual com base na aba DATABASE.

### `/atualizar`
Executa o job de atualização na hora.

---

## Deploy e operação

### Vercel

Use Vercel apenas para hospedar os endpoints HTTP.

### cron-job.org

Configure 3 jobs HTTP:

- `/api/update` a cada 2 horas
- `/api/report` às 8h
- `/api/report` às 17h

Passe `CRON_SECRET` no header `x-cron-secret`.

### Telegram

Depois do deploy, abra:

- `/api/setup-webhook` para registrar o webhook
- `/api/webhook-info` para validar o status

---

## Arquivos legados

Os arquivos abaixo deixam de ser necessários no fluxo serverless final:

- [`daemon.js`](daemon.js)
- [`src/core/scheduler.js`](src/core/scheduler.js)
- [`users.json`](users.json)
- `node-schedule` como dependência de produção

---

## Problemas conhecidos e cuidados

- O webhook do Telegram deve apontar para uma URL pública estável.
- O cron-job.org é externo; se ele falhar, o job não roda.
- Alertas precisam de destino fixo ou armazenamento persistente.
- Se `CRON_SECRET` estiver errado, os endpoints de job recusam a requisição.

---

## Resumo rápido

Este projeto:

- coleta dados de Google Ads e Meta Ads
- grava métricas no Google Sheets
- gera relatórios sob demanda
- envia alertas por Telegram
- aceita atualização manual via `/atualizar`
- roda sem processo contínuo

É uma arquitetura enxuta, compatível com serverless, barata de manter e fácil de operar.
