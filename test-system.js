#!/usr/bin/env node

/**
 * Quick Test Script
 * Verifica integridade do sistema antes de rodar daemon
 */

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');

console.log('\n🧪 Verificando integridade do sistema...\n');

// 1. Check required files
const requiredFiles = [
  'src/index.js',
  'src/services/googleAds.js',
  'src/services/meta.js',
  'src/services/sheets.js',
  'src/services/telegram.js',
  'src/core/calculator.js',
  'src/core/scheduler.js',
  'src/core/reportGenerator.js',
  'src/core/visualBlocks.js',
  'daemon.js',
  '.env',
  'package.json'
];

console.log('📁 Verificando arquivos...');
let allFilesOk = true;
for (const file of requiredFiles) {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesOk = false;
}

// 2. Check environment variables
console.log('\n🔐 Verificando variáveis de ambiente...');
const requiredEnvVars = [
  'SPREADSHEET_ID',
  'GOOGLE_PRIVATE_KEY_ID',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_CLIENT_EMAIL',
  'REFRESH_TOKEN',
  'META_TOKEN',
  'TELEGRAM_BOT_TOKEN'
];

let allEnvOk = true;
for (const envVar of requiredEnvVars) {
  const exists = !!process.env[envVar];
  console.log(`  ${exists ? '✅' : '❌'} ${envVar}${exists ? '' : ' (MISSING)'}`);
  if (!exists) allEnvOk = false;
}

// 3. Check modules
console.log('\n📦 Verificando módulos Node...');
const requiredModules = [
  'dotenv',
  'googleapis',
  'google-ads-api',
  'axios',
  'node-telegram-bot-api',
  'node-schedule'
];

let allModulesOk = true;
for (const mod of requiredModules) {
  try {
    require(mod);
    console.log(`  ✅ ${mod}`);
  } catch (e) {
    console.log(`  ❌ ${mod} (NOT INSTALLED)`);
    allModulesOk = false;
  }
}

// 4. Summary
console.log('\n📊 Resultado:');
console.log(`  Arquivos: ${allFilesOk ? '✅ OK' : '❌ FALHA'}`);
console.log(`  Variáveis: ${allEnvOk ? '✅ OK' : '❌ FALHA'}`);
console.log(`  Módulos: ${allModulesOk ? '✅ OK' : '❌ FALHA'}`);

if (allFilesOk && allEnvOk && allModulesOk) {
  console.log('\n✅ Sistema pronto! Execute: node daemon.js\n');
  process.exit(0);
} else {
  console.log('\n❌ Resolva os problemas acima e tente novamente.\n');
  process.exit(1);
}
