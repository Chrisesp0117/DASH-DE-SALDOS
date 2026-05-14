# Correção: Persistência do Cursor na Atualização da Planilha

## Problema Identificado

O processo de atualização da planilha estava **interrompendo no meio** e precisando ser acionado novamente para continuar. A raiz do problema era que **o cursor não estava sendo salvo corretamente** quando a execução era interrompida por timeout ou erro.

### Cenário do Bug:

```
1ª execução: Começa com cursor=0, processa clientes 0-19
   - nextCursor vira 20
   - Timeout é atingido → releaseJobState() é chamado
   - ❌ BUG: cursor não foi atualizado antes de liberar

2ª execução: Começa novamente com cursor=0 (não 20!)
   - Processa os mesmos clientes 0-19 NOVAMENTE
   - Resultado: Duplicação de dados e progresso lento
```

## Causa Raiz

Em [src/core/serverlessJobs.js](src/core/serverlessJobs.js), quando a execução era interrompida por:
- **Timeout** (tempo máximo da função atingido)
- **Erro/Quota** (erro ao processar ou limite de quota do Google)
- **Falha** (erro na execução)

O código chamava `releaseJobState()` **sem antes atualizar o cursor** para o próximo ponto onde deveria continuar.

## Solução Implementada

Adicionadas três chamadas `touchJobState()` antes de `releaseJobState()` para **salvar o cursor correto** em cada situação:

### 1. Quando Timeout é Atingido (linha ~175)
```javascript
if (elapsed >= maxMs) {
  // ✅ NOVO: Salvar cursor antes de liberar
  if (result && result.nextCursor !== undefined) {
    await touchJobState(sheets, spreadsheetId, jobControl, {
      cursor: result.nextCursor,
      stage: 'database',
      lastAction: 'timeout_save_cursor'
    });
  }
  await releaseJobState(sheets, spreadsheetId, jobControl, 'idle');
  // ... retorna com finished: false
}
```

### 2. Quando Há Erro (linha ~220)
```javascript
catch (error) {
  // ... tratamento do erro
  // ✅ NOVO: Salvar cursor antes de liberar
  if (result && result.nextCursor !== undefined) {
    await touchJobState(...);
  }
  await releaseJobState(...);
}
```

### 3. Quando Resultado é Inválido (linha ~250)
```javascript
if (!result || !result.ok) {
  // ✅ NOVO: Salvar cursor antes de liberar
  if (result && result.nextCursor !== undefined) {
    await touchJobState(...);
  }
  await releaseJobState(...);
}
```

## Comportamento Após Correção

```
1ª execução: cursor=0 → processa clientes 0-19 → timeout
   - touchJobState(cursor: 20) ✅
   - releaseJobState()
   - Retorna: finished=false

2ª execução: cursor=20 ✅ (carregado do estado)
   - Processa clientes 20-39
   - Continua do ponto correto!
```

## Benefícios

✅ **Continuidade garantida**: A atualização retoma exatamente do ponto onde parou  
✅ **Sem duplicação**: Clientes não são processados duas vezes  
✅ **Progresso consistente**: Cada execução avança o cursor corretamente  
✅ **Resiliência**: Mesmo com timeout ou erro, o estado é preservado  

## Mudanças Realizadas

- Arquivo: `src/core/serverlessJobs.js`
- Função: `runFullUpdateJob()`
- Linhas modificadas: ~175, ~220-250
- Tipo de mudança: Adição de lógica de persistência de estado antes de liberar lock

---

**Status**: ✅ Corrigido e testado
**Data**: 14 de Maio de 2026
