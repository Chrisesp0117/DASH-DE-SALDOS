# Apps Script — FINANCE DASH

## Variáveis (editar em `Config.gs`)

Abra **Config.gs** e edite só o bloco **SUAS VARIÁVEIS**:

```javascript
const FINANCE_DASH_HOST = 'https://dash-de-saldos.vercel.app';
const CRON_SECRET = 'crs_...';
const URL_UPDATE_FULL = FINANCE_DASH_HOST + '/api/cron/update-full';
const URL_UPDATE_NOW = FINANCE_DASH_HOST + '/api/update-now';
const URL_UPDATE_STATUS = FINANCE_DASH_HOST + '/api/update-status';
const POPUP_LARGURA = 680;
const POPUP_ALTURA = 720;
```

Script Properties são **opcionais** — se definir `CRON_SECRET` lá, sobrescreve o valor do código.

## Estrutura (3 arquivos)

No Apps Script, **cada `.gs` vira um arquivo separado** no editor (+ → Script). Todos compartilham o mesmo escopo global.

| Arquivo no editor | Arquivo no repo | Função |
|---|---|---|
| **Config** | `Config.gs` | Constantes, secret, URLs |
| **Menu** | `Menu.gs` | Menu da planilha + popup manual |
| **Cron** | `Cron.gs` | Trigger automático por tempo |

Opcional (pode ignorar):

| **Legacy** | `Legacy.gs` | Loop antigo com aba AUTO_LOG — **não usar** se já usa `Cron.gs` |

## O que você precisa no dia a dia

### 1. Colar os 3 arquivos

1. Apague o conteúdo do `Code.gs` padrão (ou renomeie para `Config` e vá criando os outros).
2. Crie **Config**, **Menu** e **Cron**.
3. Cole o conteúdo de cada arquivo `.gs` desta pasta.

### 2. Menu da planilha

`Menu.gs` define `onOpen()` → aparece **FINANCE DASH → Abrir atualização manual**.

Se você **já tem** um menu/`abrirLinkPopUp` em outro arquivo:

- Mantenha **só um** `onOpen()` no projeto (senão um sobrescreve o outro).
- Mantenha **só um** `abrirLinkPopUp()` — use o de `Menu.gs` (já com popup 680×720).

### 3. Trigger automático (manual no painel)

**Não** é criado pelo código. Configure em:

**Extensões → Apps Script → Acionadores → Adicionar acionador**

| Campo | Valor |
|---|---|
| Função | `atualizarPlanilhaAutomaticamente` |
| Origem | Baseado em tempo |
| Tipo | Timer (ex.: a cada 5 ou 10 minutos) |

### 4. Script Properties (opcional)

Se quiser tirar o secret do código, em **Configurações do projeto → Propriedades do script**:

| Chave | Valor |
|---|---|
| `CRON_SECRET` | seu secret |
| `UPDATE_URL` | `https://dash-de-saldos.vercel.app/api/cron/update-full` |

Se não definir, usa os defaults em `Config.gs`.

## Fluxo resumido

```
Menu FINANCE DASH          Trigger (relógio)
       │                          │
       ▼                          ▼
 abrirLinkPopUp()     atualizarPlanilhaAutomaticamente()
       │                          │
       ▼                          ▼
 /api/update-now          /api/cron/update-full
 (interface manual)       (cron server-side)
```

## Arquivo `Code.gs` monolítico

`Code.gs` na raiz desta pasta é a **versão tudo-em-um** (legado). Prefira os 3 arquivos separados acima.

## Segurança

Evite commitar o `CRON_SECRET` em repositórios públicos. Preferir Script Properties no Apps Script.
