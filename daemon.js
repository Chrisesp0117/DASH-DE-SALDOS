#!/usr/bin/env node

/**
 * Daemon Server para Vercel
 * Mantém um servidor HTTP vivo e executa o índice uma vez
 */

require('dotenv').config({ path: '.env' });

const http = require('http');

// Criar servidor HTTP minimalista
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'online',
    message: 'Dashboard de Saldos rodando',
    timestamp: new Date().toISOString()
  }));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`✅ Servidor HTTP rodando na porta ${PORT}`);
});

// Executar index.js uma única vez na inicialização
(async () => {
  try {
    console.log('▶️  Iniciando dashboard...');
    const { start } = require('./src/index.js');
    await start();
  } catch (err) {
    console.error('❌ Erro ao iniciar dashboard:', err.message);
    // Continua rodando mesmo com erro
  }
})();

// Manter o servidor vivo
process.on('uncaughtException', (err) => {
  console.error('❌ Erro não capturado:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise rejeitada:', reason);
});
