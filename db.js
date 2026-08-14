const fs = require('fs');
const path = require('path');
const { initialDb } = require('./seed');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let memory = null;
let persistMode = 'file';
let pool = null;
let persistTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readFileDb() {
  ensureDir();
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeFileDb(db) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function needsSsl(url) {
  return /render\.com|neon\.tech|supabase\.co|sslmode=require/i.test(url || '')
    || process.env.PGSSL === '1'
    || process.env.NODE_ENV === 'production';
}

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (pool) return pool;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  pool = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 12000,
    connectionTimeoutMillis: 20000,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gta_store (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return pool;
}

async function readPg() {
  const p = await getPool();
  if (!p) return null;
  const res = await p.query('SELECT data FROM gta_store WHERE id = $1', ['main']);
  return res.rows[0] ? res.rows[0].data : null;
}

async function writePg(db) {
  const p = await getPool();
  if (!p) return;
  await p.query(
    `INSERT INTO gta_store (id, data, updated_at)
     VALUES ('main', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(db)]
  );
}

async function persistNow(db) {
  if (persistMode === 'postgres') await writePg(db);
  else writeFileDb(db);
}

function schedulePersist(db) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistNow(db).catch((err) => console.error('GTA persist:', err.message));
  }, 250);
}

function load() {
  if (!memory) memory = readFileDb() || initialDb();
  return memory;
}

function save(db) {
  memory = db;
  if (persistMode === 'postgres') schedulePersist(db);
  else writeFileDb(db);
}

async function flush() {
  clearTimeout(persistTimer);
  if (memory) {
    try { await persistNow(memory); } catch (err) {
      console.error('GTA flush:', err.message);
    }
  }
}

async function boot() {
  try {
    if (process.env.DATABASE_URL) {
      const fromPg = await readPg();
      if (fromPg && Array.isArray(fromPg.users)) {
        memory = fromPg;
        persistMode = 'postgres';
        console.log('GTA: Postgres chargé (' + memory.users.length + ' membres)');
      } else {
        memory = readFileDb() || initialDb();
        persistMode = 'postgres';
        await writePg(memory);
        console.log('GTA: Postgres initialisé');
      }
    } else {
      memory = readFileDb() || initialDb();
      persistMode = 'file';
      writeFileDb(memory);
      console.log('GTA: fichier ' + FILE);
    }
  } catch (err) {
    console.error('GTA: Postgres indisponible → fichier. ' + err.message);
    memory = readFileDb() || initialDb();
    persistMode = 'file';
    writeFileDb(memory);
  }
  return { mode: persistMode };
}

function mode() {
  return persistMode;
}

function shutdown() {
  flush().finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { load, save, boot, flush, mode, FILE };
