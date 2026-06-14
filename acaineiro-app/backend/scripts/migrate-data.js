require('dotenv').config();
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');
const path = require('path');

const local = new Database(path.join(__dirname, '..', 'acaineiro.db'));
local.pragma('journal_mode = WAL');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function migrate(table, columns) {
  const rows = local.prepare(`SELECT ${columns} FROM ${table}`).all();
  if (rows.length === 0) { console.log(`  ${table}: 0 linhas (vazio)`); return; }

  const placeholders = columns.split(',').map(() => '?').join(',');
  const sql = `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${placeholders})`;

  for (const row of rows) {
    const vals = columns.split(',').map(c => {
      const v = row[c.trim()];
      return v === undefined ? null : v;
    });
    try {
      await turso.execute({ sql, args: vals });
    } catch (e) {
      // skip duplicates
    }
  }
  console.log(`  ${table}: ${rows.length} linhas migradas`);
}

async function migrateSettings() {
  const rows = local.prepare('SELECT key, value FROM settings').all();
  for (const r of rows) {
    try {
      await turso.execute({
        sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        args: [r.key, r.value]
      });
    } catch (e) {}
  }
  console.log(`  settings: ${rows.length} migradas`);
}

async function run() {
  console.log('Migrando dados do SQLite local para Turso...\n');

  await migrate('categories', 'id, name, slug, icon, sort_order');
  await migrate('products', 'id, category_id, name, description, price, promo_price, has_promo, image, icon, active');
  await migrate('banners', 'id, title, subtitle, button_text, button_action, image_url, bg_color, sort_order, active');
  await migrate('coupons', 'id, code, discount_percent, discount_value, min_value, description, image_url, active, usage_limit, times_used, expires_at, created_at, name');
  await migrate('combos', 'id, name, description, price, old_price, icon, active, sort_order, created_at');
  await migrate('combo_items', 'id, combo_id, product_id');
  await migrate('customers', 'id, name, phone, address, neighborhood, created_at');
  await migrate('loyalty', 'id, phone, count');
  await migrate('loyalty_rewards', 'id, phone, coupon_code, created_at');
  await migrateSettings();

  console.log('\n✅ Migração concluída!');
}

run().catch(err => { console.error('Erro:', err); process.exit(1); });
