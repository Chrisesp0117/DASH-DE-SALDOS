# 🚀 Guia de Deploy no Vercel

## Passos para Deploy Automático

### 1. Conectar Repositório no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Clique em "Import Git Repository"
3. Selecione **DASH-DE-SALDOS** da sua conta GitHub
4. Clique em "Import"

### 2. Configurar Variáveis de Ambiente

Na tela de configuração do projeto (ou após criar), acesse **Settings > Environment Variables** e adicione:

```
CLIENT_ID = seu_client_id_google_ads
CLIENT_SECRET = seu_client_secret
DEVELOPER_TOKEN = seu_developer_token
REFRESH_TOKEN = seu_refresh_token
SPREADSHEET_ID = seu_spreadsheet_id
META_TOKEN = seu_meta_token
TELEGRAM_BOT_TOKEN = seu_bot_token
MCC_ID = seu_mcc_principal
MCC_FALLBACK_1 = seu_mcc_fallback_1
MCC_FALLBACK_2 = seu_mcc_fallback_2
NODE_ENV = production
```

### 3. Deploy

Clique em "Deploy" e aguarde o build terminar.

## Verificar Status

Após o deploy:
- ✅ Verifique a aba "Deployments" para acompanhar
- ✅ Acesse a URL do projeto para confirmar que está rodando
- ✅ Os logs aparecerão em "Logs" na aba "Deployments"

## Atualizações Automáticas

Toda vez que você fizer push para `main`, o Vercel automaticamente:
1. Detecta a mudança
2. Faz o build
3. Realiza o deploy

## Troubleshooting

### Bot não responde
- Verifique se `TELEGRAM_BOT_TOKEN` está correto nas variáveis de ambiente
- Confira se o token foi atualizado no Telegram

### Dados não atualizam
- Verifique `SPREADSHEET_ID`
- Confirme se a conta Google tem acesso à planilha
- Verifique `REFRESH_TOKEN`

### Erro de API
- Revise as credenciais do Google Ads em `CLIENT_ID` e `CLIENT_SECRET`
- Confirme se `DEVELOPER_TOKEN` é válido
- Verifique os `MCC_ID`s

## Logs em Tempo Real

Para monitorar o bot em produção:
1. Acesse seu projeto no Vercel
2. Vá para **Deployments**
3. Clique no deployment ativo
4. Acesse a aba **Logs**

## Parar o Bot

Se precisar pausar o bot:
1. Vá para **Settings**
2. Clique em **Environment Variables**
3. Adicione `PAUSE=true`
4. O bot continuará rodando mas não processará dados

## Rollback

Para voltar a uma versão anterior:
1. Vá para **Deployments**
2. Clique nos três pontos do deployment desejado
3. Selecione "Promote to Production"

---

**Dica**: Configure webhooks do GitHub para notificar quando o deploy terminar!
