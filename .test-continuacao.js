// Teste local da página de atualização manual
// Abre em NODE e simula o comportamento

require('dotenv').config({ path: '.env' });
const axios = require('axios');

const BASE = 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET;

async function testUpdateFlow() {
  console.log('🧪 Iniciando teste de continuação automática...\n');

  const statusUrl = `${BASE}/api/update-status?secret=${SECRET}`;
  const updateUrl = `${BASE}/api/update-now?secret=${SECRET}`;

  try {
    // 1. Check status inicial
    console.log('1️⃣  Status inicial:');
    let res = await axios.get(statusUrl);
    console.log('   cursor:', res.data.displayCursor);
    console.log('   total:', res.data.totalClients);
    console.log('   running:', res.data.running);
    console.log('');

    // 2. Inicia update
    console.log('2️⃣  Iniciando update...');
    res = await axios.post(updateUrl);
    console.log('   Status:', res.status);
    console.log('   Response:', JSON.stringify(res.data, null, 2));
    console.log('');

    // 3. Polling para monitorar progresso
    console.log('3️⃣  Monitorando progresso (polling a cada 2s)...\n');
    let lastCursor = 0;
    let iterations = 0;
    const maxIterations = 120; // 240 segundos = 4 minutos

    while (iterations < maxIterations) {
      await new Promise(r => setTimeout(r, 2000));
      iterations++;

      res = await axios.get(statusUrl);
      const cursor = res.data.displayCursor;
      const total = res.data.totalClients;
      const running = res.data.running;
      const stage = res.data.state && res.data.state.stage;

      const pct = total > 0 ? Math.round((cursor / total) * 100) : 0;
      const indicator = running ? '⏳' : '✅';

      console.log(`[${iterations}] ${indicator} cursor=${cursor}/${total} (${pct}%) | stage=${stage} | running=${running}`);

      // Se progrediu, reseta contador
      if (cursor > lastCursor) {
        lastCursor = cursor;
      }

      // Terminou?
      if (!running && cursor >= total && total > 0) {
        console.log('\n✅ ATUALIZAÇÃO COMPLETA!');
        break;
      }

      // Timeout?
      if (iterations >= maxIterations) {
        console.log('\n⏰ Timeout - estourou tempo máximo de espera');
        break;
      }
    }

    console.log('\nStatus final:');
    console.log('   cursor:', res.data.displayCursor);
    console.log('   total:', res.data.totalClients);
    console.log('   running:', res.data.running);

  } catch (e) {
    console.error('❌ Erro:', e.message);
    if (e.response) {
      console.error('Response:', e.response.data);
    }
  }
}

testUpdateFlow();
