# Apps Script: Popup Atualização

Este diretório contém um `Code.gs` pronto para ser colado em um projeto do Google Apps Script vinculado à sua planilha.

Objetivo
- Adicionar um menu `Atualizar` → `Abrir Atualização` que abre um modal com a página `/api/update-now`.

Configuração (passos)
1. Abra a planilha no Google Sheets.
2. Extensões → Apps Script.
3. Crie um novo projeto e cole o conteúdo de `Code.gs` no editor.
4. Em `Project Settings` → `Script properties` (ou `Editor` → `Project Settings` → `Script properties`) defina:
   - `UPDATE_URL` = `https://seu-host/api/update-now`
   - `CRON_SECRET` = (o valor do seu `CRON_SECRET`)
5. Salve e atualize a planilha. O menu `Atualizar` aparecerá.

Observações de segurança
- Evite gravar o `CRON_SECRET` em código público. Use Script Properties (acessível apenas a editores do script).
- Se o host da `update-now` bloquear embedding (X-Frame-Options), o iframe será ocultado e o botão "Abrir em nova aba" permite prosseguir.

Como usar
- Clique em `Atualizar` → `Abrir Atualização` para abrir o modal.
- No modal, botão "Abrir em nova aba" abre a página diretamente (caso o iframe seja bloqueado).

---
