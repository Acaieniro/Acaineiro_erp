const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');
const path = require('path');

const useTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let db;
if (useTurso) {
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} else {
  const dbPath = path.join(__dirname, '..', 'acaineiro.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

async function run(sql, ...params) {
  if (useTurso) {
    const r = await db.execute({ sql, args: params });
    return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) };
  }
  return db.prepare(sql).run(...params);
}

async function get(sql, ...params) {
  if (useTurso) {
    const r = await db.execute({ sql, args: params });
    return r.rows[0] || null;
  }
  return db.prepare(sql).get(...params);
}

async function all(sql, ...params) {
  if (useTurso) {
    const r = await db.execute({ sql, args: params });
    return r.rows;
  }
  return db.prepare(sql).all(...params);
}

function raw() { return db; }

module.exports = { db, run, get, all, useTurso, raw };
