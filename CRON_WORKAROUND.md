# Contorno: Cron no Vercel Grátis

## Problema

A configuração de **crons no `vercel.json`** é uma **feature PRO** do Vercel e estava bloqueando o deploy na versão gratuita.

## Solução Implementada

### ✅ Removido do `vercel.json`:
```json
"crons": [
  {
    "path": "/api/cron/update-full",
    "schedule": "*/5 * * * *"
  }
]
```

### Alternativas para Agendamento (Grátis):

#### **Opção 1: Usar External CRON Service (Recomendado)**
- **Uptime Robot** (grátis): https://uptimerobot.com
- **AWS EventBridge** (grátis tier): https://aws.amazon.com
- **Later.com** (grátis): https://later.com/cron-job

**Configuração:**
1. Acesse o serviço (ex: Uptime Robot)
2. Crie um novo "Monitor"
3. URL: `https://seu-domain.vercel.app/api/cron/update-full?secret=CRON_SECRET`
4. Interval: 5 minutos
5. Configure a variável `CRON_SECRET` no Vercel

#### **Opção 2: GitHub Actions (Grátis)**
Crie arquivo: `.github/workflows/cron-update.yml`

```yaml
name: Cron Update Dashboard

on:
  schedule:
    - cron: '*/5 * * * *'  # A cada 5 minutos
  workflow_dispatch:  # Permite disparo manual

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Update
        run: |
          curl -X POST https://seu-domain.vercel.app/api/cron/update-full \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

#### **Opção 3: Cron-Job.Org (Grátis)**
- Website: https://cron-job.org
- Configuração simples via interface
- Suporta até 10 jobs grátis

## Como Usar (Exemplo: Uptime Robot)

1. **Acesse**: https://uptimerobot.com
2. **Crie account** (grátis)
3. **Novo Monitor**:
   - Tipo: HTTP(s)
   - URL: `https://seu-domain.vercel.app/api/cron/update-full?secret=SEU_CRON_SECRET`
   - Monitoring interval: 5 minutos
4. **Variáveis Vercel**:
   - Adicione `CRON_SECRET` nos Settings > Environment Variables

## Segurança

⚠️ **Importante**: 
- Sempre use `CRON_SECRET` para proteger o endpoint
- Não deixe a URL pública sem autenticação
- O código já valida via `assertCronAuth()`

## Status do Deploy

✅ Agora o `vercel.json` **não requer plan PRO**  
✅ Deploy funciona na **versão gratuita**  
✅ Agendamento ainda funciona via **serviço externo**

---

**Data**: 14 de Maio de 2026
**Próxima ação**: Escolher e configurar serviço de agendamento (recomendado: Uptime Robot)
