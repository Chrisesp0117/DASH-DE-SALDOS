/**
 * nomes.js — catálogo de gestores e supervisores (dropdowns da página web).
 *
 * As listas ficam em app_settings (Supabase): key 'gestores' / 'supervisores',
 * value = array de nomes. Ao excluir um nome, ele também é limpado das contas
 * que o usavam (accounts_config).
 */
const { getClient, describeSupabaseError } = require('./supabase');
const { ACCOUNTS_TABLE } = require('./accountsConfig');

const SETTINGS_TABLE = process.env.SUPABASE_SETTINGS_TABLE || 'app_settings';
const TYPE_KEYS = {
  gestor: 'gestores',
  supervisor: 'supervisores'
};

function validateType(type) {
  const key = TYPE_KEYS[type];
  if (!key) throw new Error("tipo inválido — use 'gestor' ou 'supervisor'");
  return key;
}

async function readList(key) {
  const client = getClient();
  const { data, error } = await client
    .from(SETTINGS_TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.warn('[nomes] falha ao ler ' + SETTINGS_TABLE + ' (key=' + key + '): ' + describeSupabaseError(error));
    return [];
  }
  const value = data && data.value;
  return Array.isArray(value) ? value.map(v => String(v)) : [];
}

async function writeList(key, list) {
  const client = getClient();
  const { error } = await client
    .from(SETTINGS_TABLE)
    .upsert({ key, value: list, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    throw new Error('Falha ao salvar lista em ' + SETTINGS_TABLE + ': ' + describeSupabaseError(error));
  }
}

async function getNomeLists() {
  const [gestores, supervisores] = await Promise.all([
    readList('gestores'),
    readList('supervisores')
  ]);
  return { gestores, supervisores };
}

/**
 * Adiciona um nome ao catálogo (ignora duplicado, case-insensitive).
 */
async function addNome(type, nomeRaw) {
  const key = validateType(type);
  const nome = String(nomeRaw || '').trim();
  if (!nome) throw new Error('nome vazio');
  if (nome.length > 80) throw new Error('nome muito longo (máx. 80 caracteres)');

  const list = await readList(key);
  const exists = list.some(n => n.toLowerCase() === nome.toLowerCase());
  if (!exists) {
    list.push(nome);
    await writeList(key, list);
  }
  return getNomeLists();
}

/**
 * Remove um nome do catálogo e limpa o campo das contas que o usavam.
 */
async function deleteNome(type, nomeRaw) {
  const key = validateType(type);
  const nome = String(nomeRaw || '').trim();
  if (!nome) throw new Error('nome vazio');

  const list = await readList(key);
  const next = list.filter(n => n.toLowerCase() !== nome.toLowerCase());

  // Limpa das contas salvas (não bloqueia a exclusão se falhar — só avisa)
  const col = type === 'gestor' ? 'gestor' : 'supervisor';
  try {
    const client = getClient();
    const { error } = await client
      .from(ACCOUNTS_TABLE)
      .update({ [col]: '' })
      .eq(col, nome);
    if (error) {
      console.warn('[nomes] falha ao limpar ' + col + ' das contas: ' + describeSupabaseError(error));
    }
  } catch (e) {
    console.warn('[nomes] falha ao limpar ' + col + ' das contas:', e && e.message);
  }

  if (next.length !== list.length) {
    await writeList(key, next);
  }
  return getNomeLists();
}

module.exports = {
  SETTINGS_TABLE,
  TYPE_KEYS,
  getNomeLists,
  addNome,
  deleteNome
};
