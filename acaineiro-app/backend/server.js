const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const isNetlify = !!process.env.NETLIFY;
let PrinterManager;
try {
  PrinterManager = require('./lib/printer').PrinterManager;
} catch (e) {
  // printer module not available (Netlify or missing deps)
}

require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

const app = express();

let server, io;
if (!isNetlify) {
  server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
}

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'acaineiro@2026.';

// ─── Database: Turso (Netlify) or SQLite (local) ───
const useTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
let db;
if (useTurso) {
  const { createClient } = require('@libsql/client');
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  db.run = async (sql, ...params) => { const r = await db.execute({ sql, args: params }); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) }; };
  db.get = async (sql, ...params) => { const r = await db.execute({ sql, args: params }); return r.rows[0] || null; };
  db.all = async (sql, ...params) => { const r = await db.execute({ sql, args: params }); return r.rows; };
} else {
  const Database = require('better-sqlite3');
  const DB_PATH = path.join(__dirname, 'acaineiro.db');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.run = async (sql, ...params) => db.prepare(sql).run(...params);
  db.get = async (sql, ...params) => db.prepare(sql).get(...params);
  db.all = async (sql, ...params) => db.prepare(sql).all(...params);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  maxAge: 0,
  setHeaders(res, p) {
    if (p.includes('admin')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

const WWW_PATH = path.join(__dirname, '..', 'www');
// ─── Printer ───
let printerManager = null;

async function initPrinter() {
  if (isNetlify || !PrinterManager) return;
  try {
    printerManager = new PrinterManager();
    const settings = await getSettings();
    await printerManager.init(settings);
  } catch (e) {
    console.log('[Printer] Init error:', e.message);
  }
}

app.use('/app', express.static(WWW_PATH, {
  maxAge: 0,
  setHeaders(res, p) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(WWW_PATH, 'index.html'));
});

let dbInit = false;
app.use(async (req, res, next) => {
  if (!dbInit) { dbInit = true; await initDB().catch(e => console.error('initDB error:', e.message)); }
  next();
});

async function initDB() {
  await db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '📋', sort_order INTEGER DEFAULT 0
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL,
    name TEXT NOT NULL, description TEXT DEFAULT '', price REAL NOT NULL,
    promo_price REAL, has_promo INTEGER DEFAULT 0, image TEXT DEFAULT '',
    icon TEXT DEFAULT '🥣', active INTEGER DEFAULT 1,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
    address TEXT DEFAULT '', neighborhood TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER,
    customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
    customer_address TEXT DEFAULT '', customer_neighborhood TEXT DEFAULT '',
    items_json TEXT NOT NULL, total REAL NOT NULL, delivery_fee REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'dinheiro', payment_status TEXT DEFAULT 'pendente',
    status TEXT DEFAULT 'novo', amount_paid REAL, change_due REAL DEFAULT 0,
    notes TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS cash_register (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME,
    initial_balance REAL DEFAULT 0, expected_balance REAL, actual_balance REAL,
    difference REAL, notes TEXT DEFAULT '', status TEXT DEFAULT 'aberto'
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, register_id INTEGER NOT NULL,
    type TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL,
    reference TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (register_id) REFERENCES cash_register(id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    address TEXT DEFAULT '', neighborhood TEXT DEFAULT '',
    auth_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS saved_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    card_token TEXT NOT NULL, last_four TEXT NOT NULL, first_six TEXT NOT NULL,
    cardholder_name TEXT NOT NULL, expiration_month TEXT NOT NULL,
    expiration_year TEXT NOT NULL, brand TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    subtitle TEXT DEFAULT '', button_text TEXT DEFAULT '',
    button_action TEXT DEFAULT 'menu', image_url TEXT DEFAULT '',
    bg_color TEXT DEFAULT '#7C3AED', sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
    discount_percent INTEGER DEFAULT 0, discount_value REAL DEFAULT 0,
    min_value REAL DEFAULT 0, description TEXT DEFAULT '', image_url TEXT DEFAULT '',
    active INTEGER DEFAULT 1, usage_limit INTEGER DEFAULT 0, times_used INTEGER DEFAULT 0,
    expires_at TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    description TEXT DEFAULT '', price REAL NOT NULL, old_price REAL,
    icon TEXT DEFAULT '🎯', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS combo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, combo_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS loyalty (
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, count INTEGER DEFAULT 0
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL,
    coupon_code TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS sync_ts (
    entity TEXT PRIMARY KEY, updated_at TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS neighborhood_fees (
    neighborhood TEXT PRIMARY KEY, fee REAL NOT NULL
  )`);

  // Migrations - safe to run repeatedly
  for (const sql of [
    "ALTER TABLE coupons ADD COLUMN discount_value REAL DEFAULT 0",
    "ALTER TABLE banners ADD COLUMN emoji TEXT DEFAULT ''",
    "ALTER TABLE banners ADD COLUMN icon_url TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN mp_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN asaas_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN cpf TEXT",
    "ALTER TABLE users ADD COLUMN cep TEXT",
    "ALTER TABLE users ADD COLUMN address_number TEXT",
    "ALTER TABLE saved_cards ADD COLUMN mp_card_id TEXT",
    "ALTER TABLE saved_cards ADD COLUMN asaas_card_token TEXT",
    "ALTER TABLE saved_cards ADD COLUMN asaas_customer_id TEXT",
    "ALTER TABLE orders ADD COLUMN payment_method_detail TEXT DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''",
    "ALTER TABLE coupons ADD COLUMN name TEXT DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN amount_paid REAL",
    "ALTER TABLE orders ADD COLUMN change_due REAL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN mp_payment_id TEXT",
    "ALTER TABLE orders ADD COLUMN payment_data_json TEXT",
    "ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'delivery'",
    "ALTER TABLE loyalty_rewards ADD COLUMN reward_product_id INTEGER DEFAULT 0",
    "ALTER TABLE loyalty_rewards ADD COLUMN redeemed_at TEXT",
    "ALTER TABLE orders ADD COLUMN ps_charge_id TEXT",
    "ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN cpf TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN cep TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN address_number TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''"
  ]) {
    try { await db.run(sql); } catch (e) {}
  }
  // Remover categorias nao usadas
  for (const slug of ['pratos', 'bebidas']) {
    try {
      const cat = await db.get('SELECT id FROM categories WHERE slug=?', slug);
      if (cat) {
        const extras = await db.get('SELECT id FROM categories WHERE slug=?', 'extras');
        if (extras) await db.run('UPDATE products SET category_id=? WHERE category_id=?', extras.id, cat.id);
        await db.run('DELETE FROM categories WHERE id=?', cat.id);
      }
    } catch (e) {}
  }
  // Atribuir sort_order para produtos existentes baseado no id
  try { await db.run('UPDATE products SET sort_order = id WHERE sort_order = 0'); } catch (e) {}

  const catCount = await db.get('SELECT COUNT(*) as c FROM categories');
  if (catCount.c === 0) {
    await db.run('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?,?,?,?)', 'Açaís', 'acai', '🥣', 1);
    await db.run('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?,?,?,?)', 'Vitaminas', 'vitaminas', '🥤', 2);
    await db.run('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?,?,?,?)', 'Extras', 'extras', '➕', 3);
    const inserts = [
      [1,'Açaí Tradicional','Açaí puro com banana, granola e mel',15],
      [1,'Açaí Premium','Açaí com leite em pó, banana, granola, morango e mel',20],
      [1,'Açaí Power','Açaí com whey, banana, pasta de amendoim, granola e mel',25],
      [1,'Açaí Tropical','Açaí com abacaxi, coco ralado, granola e leite condensado',22],
      [1,'Açaí Fit','Açaí zero açúcar com chia, banana, morango e granola integral',23],
      [2,'Vitamina Tradicional','Vitamina de frutas natural',12],
      [2,'Vitamina Gourmet','Vitamina especial com frutas selecionadas',18],
      [3,'Nutella Extra','Porção extra de Nutella',5],
      [3,'Granola Extra','Porção extra de granola crocante',3],
      [3,'Frutas Extras','Banana, morango, abacaxi ou kiwi',3],
    ];
    for (const p of inserts) {
      await db.run('INSERT INTO products (category_id, name, description, price) VALUES (?,?,?,?)', ...p);
    }
  }

  const sCount = await db.get("SELECT COUNT(*) as c FROM settings WHERE key='delivery_fee'");
  if (sCount.c === 0) {
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'delivery_fee', '5');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'store_open', '13:00');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'store_close', '20:30');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'store_phone', '5531975785413');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'store_address', 'R. Venezuela, 68 - Contagem, MG');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'store_name', 'AÇAINEIRO');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'pix_key', '');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'pagseguro_token', '');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'locationiq_key', '');
    await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'delivery_rate_per_km', '2');
  }

  defaults: {
    const existingDefaults = ['flash_hours','flash_minutes','loyalty_goal','loyalty_reward','loyalty_reward_product_id','card_payment_enabled'];
    for (const k of existingDefaults) {
      const v = await db.get('SELECT value FROM settings WHERE key=?', k);
      if (!v) {
        const vals = { flash_hours: '2', flash_minutes: '30', loyalty_goal: '10', loyalty_reward: '20', card_payment_enabled: '0' };
        try { await db.run('INSERT INTO settings (key,value) VALUES (?,?)', k, vals[k]); } catch (e) {}
      }
    }
    const fe = await db.get("SELECT value FROM settings WHERE key='flash_end_time'");
    if (!fe) {
      const d = new Date();
      d.setHours(d.getHours() + 2, d.getMinutes() + 30, 0, 0);
      try { await db.run('INSERT INTO settings (key,value) VALUES (?,?)', 'flash_end_time', d.toISOString()); } catch (e) {}
    }
  }

  const bCount = await db.get('SELECT COUNT(*) as c FROM banners');
  if (bCount.c === 0) {
    await db.run('INSERT INTO banners (title,subtitle,button_text,button_action,bg_color,sort_order) VALUES (?,?,?,?,?,?)', 'O verdadeiro açaí mineiro', 'Ingredientes selecionados, sabor inesquecível', 'Ver Cardápio →', 'menu', '#7C3AED', 1);
    await db.run('INSERT INTO banners (title,subtitle,button_text,button_action,bg_color,sort_order) VALUES (?,?,?,?,?,?)', 'Promoções imperdíveis', 'Ofertas especiais por tempo limitado', 'Ver Promos →', 'promos', '#DB2777', 2);
    await db.run('INSERT INTO banners (title,subtitle,button_text,button_action,bg_color,sort_order) VALUES (?,?,?,?,?,?)', 'Delivery rápido e fácil', 'Pediu, chegou! Entrega em Contagem', 'Pedir Agora →', 'cart', '#059669', 3);
  }
}

async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

async function touchSync(entity) {
  await db.run('INSERT OR REPLACE INTO sync_ts (entity, updated_at) VALUES (?,?)', entity, new Date().toISOString());
}

if (io) {
  io.on('connection', (socket) => {
    socket.on('join-admin', () => { socket.join('admin'); });
    socket.on('join-order', (orderId) => {
      socket.join(`order-${orderId}`);
      socket.emit('connected', { orderId });
    });
  });
}

// Middleware
const adminAuth = (req, res, next) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });
  next();
};

const userAuth = async (req, res, next) => {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const user = await db.get('SELECT id, name, phone, cpf, cep, address_number, address, neighborhood FROM users WHERE auth_token=?', token);
  if (!user) return res.status(401).json({ error: 'Token inválido' });
  req.user = user;
  next();
};

// ─── CATEGORIES ───
app.get('/api/categories', async (req, res) => {
  const cats = await db.all('SELECT * FROM categories ORDER BY sort_order');
  res.json(cats);
});

// ─── PRODUCTS ───
app.get('/api/products', async (req, res) => {
  const products = await db.all(`SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p JOIN categories c ON p.category_id = c.id
    WHERE p.active = 1 ORDER BY c.sort_order, p.sort_order, p.id`);
  res.json(products);
});

app.get('/api/products/all', adminAuth, async (req, res) => {
  const products = await db.all(`SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p JOIN categories c ON p.category_id = c.id
    ORDER BY c.sort_order, p.sort_order, p.id`);
  res.json(products);
});

app.post('/api/products', adminAuth, async (req, res) => {
  const { category_id, name, description, price, promo_price, icon, image, sort_order } = req.body;
  const r = await db.run('INSERT INTO products (category_id,name,description,price,promo_price,icon,image,sort_order) VALUES (?,?,?,?,?,?,?,?)',
    category_id, name, description || '', price || 0, promo_price || null, icon || '🥣', image || '', sort_order || 0);
  await touchSync('products');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
  const { name, description, price, promo_price, has_promo, icon, image, category_id, active, sort_order } = req.body;
  await db.run('UPDATE products SET name=?,description=?,price=?,promo_price=?,has_promo=?,icon=?,image=?,category_id=?,active=?,sort_order=? WHERE id=?',
    name, description, price, promo_price, has_promo ? 1 : 0, icon, image || '', category_id, active ? 1 : 0, sort_order || 0, req.params.id);
  await touchSync('products');
  res.json({ ok: true });
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
  const id = req.params.id;
  await db.run('DELETE FROM combo_items WHERE product_id=?', id);
  await db.run('DELETE FROM products WHERE id=?', id);
  await touchSync('products');
  res.json({ ok: true });
});

app.post('/api/products/:id/promo', adminAuth, async (req, res) => {
  const { promo_price } = req.body;
  const has = promo_price > 0 ? 1 : 0;
  await db.run('UPDATE products SET promo_price=?, has_promo=? WHERE id=?', promo_price || null, has, req.params.id);
  await touchSync('products');
  res.json({ ok: true });
});

// ─── BANNERS ───
app.get('/api/banners', async (req, res) => {
  const banners = await db.all('SELECT * FROM banners WHERE active=1 ORDER BY sort_order');
  res.json(banners);
});

app.get('/api/banners/all', adminAuth, async (req, res) => {
  const banners = await db.all('SELECT * FROM banners ORDER BY sort_order');
  res.json(banners);
});

app.post('/api/banners', adminAuth, async (req, res) => {
  const { title, subtitle, button_text, button_action, image_url, bg_color, emoji, icon_url, sort_order } = req.body;
  const r = await db.run('INSERT INTO banners (title,subtitle,button_text,button_action,image_url,bg_color,emoji,icon_url,sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
    title || 'Banner', subtitle || '', button_text || '', button_action || 'menu', image_url || '', bg_color || '#7C3AED', emoji || '', icon_url || '', sort_order || 0);
  await touchSync('banners');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/banners/:id', adminAuth, async (req, res) => {
  const { title, subtitle, button_text, button_action, image_url, bg_color, active, sort_order, emoji, icon_url } = req.body;
  await db.run('UPDATE banners SET title=?,subtitle=?,button_text=?,button_action=?,image_url=?,bg_color=?,emoji=?,icon_url=?,active=?,sort_order=? WHERE id=?',
    title, subtitle || '', button_text || '', button_action || 'menu', image_url || '', bg_color || '#7C3AED', emoji || '', icon_url || '', active ? 1 : 0, sort_order || 0, req.params.id);
  await touchSync('banners');
  res.json({ ok: true });
});

app.delete('/api/banners/:id', adminAuth, async (req, res) => {
  await db.run('DELETE FROM banners WHERE id=?', req.params.id);
  await touchSync('banners');
  res.json({ ok: true });
});

// ─── COUPONS ───
app.get('/api/coupons', async (req, res) => {
  const now = new Date().toISOString();
  const coupons = await db.all("SELECT *, (usage_limit > 0 AND times_used >= usage_limit) as exhausted FROM coupons WHERE active=1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id ASC", now);
  res.json(coupons);
});

app.get('/api/coupons/all', adminAuth, async (req, res) => {
  const coupons = await db.all('SELECT * FROM coupons ORDER BY id DESC');
  res.json(coupons);
});

app.post('/api/coupons', adminAuth, async (req, res) => {
  const { code, name, discount_percent, discount_value, min_value, description, image_url, usage_limit, expires_at } = req.body;
  if (!code || (!discount_percent && !discount_value)) return res.status(400).json({ error: 'Código e valor/porcentagem obrigatórios' });
  const existing = await db.get('SELECT id FROM coupons WHERE code=?', code.toUpperCase());
  if (existing) return res.status(400).json({ error: 'Código já existe' });
  const r = await db.run('INSERT INTO coupons (code,name,discount_percent,discount_value,min_value,description,image_url,usage_limit,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
    code.toUpperCase(), name || '', discount_percent || 0, discount_value || 0, min_value || 0, description || '', image_url || '', usage_limit || 0, expires_at || null);
  await touchSync('coupons');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/coupons/:id', adminAuth, async (req, res) => {
  const { code, name, discount_percent, discount_value, min_value, description, image_url, active, usage_limit, expires_at } = req.body;
  await db.run('UPDATE coupons SET code=?,name=?,discount_percent=?,discount_value=?,min_value=?,description=?,image_url=?,active=?,usage_limit=?,expires_at=? WHERE id=?',
    (code || '').toUpperCase(), name || '', discount_percent || 0, discount_value || 0, min_value || 0, description || '', image_url || '', active ? 1 : 0, usage_limit || 0, expires_at || null, req.params.id);
  await touchSync('coupons');
  res.json({ ok: true });
});

app.delete('/api/coupons/:id', adminAuth, async (req, res) => {
  const id = req.params.id;
  const c = await db.get('SELECT code FROM coupons WHERE id=?', id);
  if (c) await db.run('DELETE FROM loyalty_rewards WHERE coupon_code=?', c.code);
  await db.run('DELETE FROM coupons WHERE id=?', id);
  await touchSync('coupons');
  res.json({ ok: true });
});

app.post('/api/coupons/validate', async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Código obrigatório' });
  const now = new Date().toISOString();
  const coupon = await db.get("SELECT * FROM coupons WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit=0 OR times_used < usage_limit)", code.toUpperCase(), now);
  if (!coupon) return res.status(400).json({ error: 'Cupom inválido ou expirado' });
  if (subtotal < coupon.min_value) return res.status(400).json({ error: `Valor mínimo de R$ ${coupon.min_value.toFixed(2).replace('.',',')} para usar este cupom` });
  const discount = coupon.discount_value > 0
    ? Math.min(coupon.discount_value, subtotal)
    : subtotal * (coupon.discount_percent / 100);
  res.json({ valid: true, code: coupon.code, discount_percent: coupon.discount_value > 0 ? 0 : coupon.discount_percent, discount, min_value: coupon.min_value, id: coupon.id });
});

app.post('/api/coupons/:id/use', async (req, res) => {
  await db.run('UPDATE coupons SET times_used = times_used + 1 WHERE id=?', req.params.id);
  res.json({ ok: true });
});

// ─── LOYALTY ───
app.get('/api/loyalty/rewards/all', adminAuth, async (req, res) => {
  const rewards = await db.all('SELECT lr.phone, lr.coupon_code, lr.created_at FROM loyalty_rewards lr ORDER BY lr.created_at DESC LIMIT 100');
  res.json(rewards);
});

app.get('/api/loyalty/:phone', async (req, res) => {
  const phone = req.params.phone;
  if (!phone) return res.json({ count: 0, rewards: [] });
  try {
    const loyalty = await db.get('SELECT * FROM loyalty WHERE phone=?', phone);
    const count = loyalty ? loyalty.count : 0;
    // Garantir colunas (seguro: ja existe, ignora)
    try { await db.run("ALTER TABLE loyalty_rewards ADD COLUMN reward_product_id INTEGER DEFAULT 0"); } catch (e) {}
    try { await db.run("ALTER TABLE loyalty_rewards ADD COLUMN redeemed_at TEXT"); } catch (e) {}
    // Buscar rewards sem depender das colunas de migracao no WHERE
    const rows = await db.all(`SELECT lr.coupon_code, lr.created_at, lr.reward_product_id, lr.redeemed_at,
      c.name as coupon_name, c.discount_percent, c.discount_value, c.description, c.image_url,
      c.times_used, c.usage_limit
      FROM loyalty_rewards lr LEFT JOIN coupons c ON lr.coupon_code = c.code
      WHERE lr.phone=? ORDER BY lr.created_at DESC`, phone);
    // Filtrar em JS (seguro: se coluna redeemed_at nao existe, retorna undefined => nao filtra)
    const rewards = [];
    const productIds = [];
    for (const r of rows) {
      if (r.redeemed_at) continue;
      const used = parseInt(r.usage_limit || 0) > 0 && parseInt(r.times_used || 0) >= parseInt(r.usage_limit);
      if (used) continue;
      const pid = parseInt(r.reward_product_id || 0);
      if (pid > 0) productIds.push(pid);
      rewards.push(r);
    }
    // Buscar dados dos produtos em lote
    if (productIds.length) {
      const ids = [...new Set(productIds)];
      const products = await db.all(`SELECT id, name, price, image_url FROM products WHERE id IN (${ids.join(',')})`);
      const pmap = {};
      for (const p of products) pmap[p.id] = p;
      for (const r of rewards) {
        const p = pmap[parseInt(r.reward_product_id)];
        if (p) { r.product_name = p.name; r.product_price = p.price; r.product_image = p.image_url; }
      }
    }
    res.json({ count, rewards });
  } catch (e) {
    console.error('Erro endpoint loyalty:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/loyalty/redeem-product', async (req, res) => {
  const { coupon_code } = req.body;
  if (!coupon_code) return res.status(400).json({ error: 'Código do cupom obrigatório' });
  await db.run("UPDATE loyalty_rewards SET redeemed_at=CURRENT_TIMESTAMP WHERE coupon_code=? AND redeemed_at IS NULL", coupon_code);
  res.json({ ok: true });
});

// ─── COMBOS ───
app.get('/api/combos', async (req, res) => {
  const s = await getSettings();
  const endTime = s.flash_end_time;
  const active = endTime ? Date.now() < new Date(endTime).getTime() : false;
  if (!active) return res.json([]);
  const combos = await db.all('SELECT * FROM combos WHERE active=1 ORDER BY sort_order');
  for (const c of combos) {
    c.items = await db.all(`SELECT ci.id as combo_item_id, ci.product_id, p.name, p.description, p.price, p.icon, p.image
      FROM combo_items ci JOIN products p ON ci.product_id = p.id WHERE ci.combo_id = ?`, c.id);
  }
  res.json(combos);
});

app.get('/api/combos/all', adminAuth, async (req, res) => {
  const combos = await db.all('SELECT * FROM combos ORDER BY sort_order');
  for (const c of combos) {
    c.items = await db.all(`SELECT ci.id as combo_item_id, ci.product_id, p.name, p.description, p.price, p.icon, p.image
      FROM combo_items ci JOIN products p ON ci.product_id = p.id WHERE ci.combo_id = ?`, c.id);
  }
  res.json(combos);
});

app.post('/api/combos', adminAuth, async (req, res) => {
  const { name, description, price, old_price, icon, sort_order } = req.body;
  const r = await db.run('INSERT INTO combos (name,description,price,old_price,icon,sort_order) VALUES (?,?,?,?,?,?)',
    name, description || '', price || 0, old_price || null, icon || '🎯', sort_order || 0);
  await touchSync('combos');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/combos/:id', adminAuth, async (req, res) => {
  const { name, description, price, old_price, icon, active, sort_order } = req.body;
  await db.run('UPDATE combos SET name=?,description=?,price=?,old_price=?,icon=?,active=?,sort_order=? WHERE id=?',
    name, description || '', price, old_price || null, icon || '🎯', active ? 1 : 0, sort_order || 0, req.params.id);
  await touchSync('combos');
  res.json({ ok: true });
});

app.delete('/api/combos/:id', adminAuth, async (req, res) => {
  const id = req.params.id;
  await db.run('DELETE FROM combo_items WHERE combo_id=?', id);
  await db.run('DELETE FROM combos WHERE id=?', id);
  await touchSync('combos');
  res.json({ ok: true });
});

app.post('/api/combos/:id/items', adminAuth, async (req, res) => {
  const { product_id } = req.body;
  const existing = await db.get('SELECT id FROM combo_items WHERE combo_id=? AND product_id=?', req.params.id, product_id);
  if (existing) return res.status(400).json({ error: 'Produto já está no combo' });
  const r = await db.run('INSERT INTO combo_items (combo_id, product_id) VALUES (?,?)', req.params.id, product_id);
  await touchSync('combos');
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/combos/:id/items/:itemId', adminAuth, async (req, res) => {
  await db.run('DELETE FROM combo_items WHERE id=? AND combo_id=?', req.params.itemId, req.params.id);
  await touchSync('combos');
  res.json({ ok: true });
});

app.get('/api/products/top', async (req, res) => {
  const topProducts = await db.all(`
    SELECT p.*, c.name as category_name, c.slug as category_slug,
      COALESCE(t.cnt, 0) as total_sold
    FROM products p
    JOIN categories c ON p.category_id = c.id
    LEFT JOIN (
      SELECT json_extract(value, '$.id') as pid, COUNT(*) as cnt
      FROM orders, json_each(orders.items_json)
      WHERE orders.status NOT IN ('cancelado')
      GROUP BY pid
    ) t ON p.id = t.pid
    WHERE p.active = 1
    ORDER BY total_sold DESC, p.id LIMIT 8`);
  res.json(topProducts);
});

// ─── SYNC ───
app.get('/api/sync', async (req, res) => {
  const rows = await db.all('SELECT * FROM sync_ts');
  const map = {};
  for (const r of rows) map[r.entity] = r.updated_at;
  res.json(map);
});

// ─── NEIGHBORHOOD FEES ───
app.get('/api/neighborhood-fees', async (req, res) => {
  const fees = await db.all('SELECT * FROM neighborhood_fees ORDER BY neighborhood');
  res.json(fees);
});

app.post('/api/neighborhood-fees', adminAuth, async (req, res) => {
  const { neighborhood, fee } = req.body;
  if (!neighborhood || fee === undefined) return res.status(400).json({ error: 'Bairro e taxa obrigatórios' });
  await db.run('INSERT OR REPLACE INTO neighborhood_fees (neighborhood, fee) VALUES (?,?)', neighborhood.trim(), parseFloat(fee) || 0);
  await touchSync('settings');
  res.json({ ok: true });
});

app.delete('/api/neighborhood-fees/:neighborhood', adminAuth, async (req, res) => {
  await db.run('DELETE FROM neighborhood_fees WHERE neighborhood=?', req.params.neighborhood);
  await touchSync('settings');
  res.json({ ok: true });
});

// ─── SETTINGS ───
app.get('/api/settings', async (req, res) => {
  res.json(await getSettings());
});

app.put('/api/settings', adminAuth, async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', k, String(v));
  }
  if (req.body.flash_hours !== undefined || req.body.flash_minutes !== undefined) {
    const s = await getSettings();
    const hours = parseInt(req.body.flash_hours ?? s.flash_hours ?? '2');
    const minutes = parseInt(req.body.flash_minutes ?? s.flash_minutes ?? '30');
    const d = new Date();
    d.setHours(d.getHours() + hours, d.getMinutes() + minutes, 0, 0);
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', 'flash_end_time', d.toISOString());
  }
  await touchSync('settings');
  res.json({ ok: true });
});

// ─── FREIGHT ───
async function calcDistance(address, settings) {
  const key = settings.locationiq_key;
  if (!key) return null;
  const storeAddr = settings.store_address;
  if (!storeAddr) return null;
  if (!address) return null;
  try {
    const https = require('https');
    // Geocode store address (cache em settings.store_lat, store_lng)
    let slat = settings.store_lat, slon = settings.store_lng;
    if (!slat || !slon) {
      const sGeo = await new Promise((resolve, reject) => {
        https.get(`https://us1.locationiq.com/v1/search?key=${key}&q=${encodeURIComponent(storeAddr)}&format=json&limit=1`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(JSON.parse(d))); r.on('error',reject); });
      });
      if (sGeo && sGeo.length) {
        slat = sGeo[0].lat; slon = sGeo[0].lon;
        await db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', 'store_lat', slat);
        await db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', 'store_lng', slon);
      } else return null;
    }
    // Geocode customer address
    const cGeo = await new Promise((resolve, reject) => {
      https.get(`https://us1.locationiq.com/v1/search?key=${key}&q=${encodeURIComponent(address)}&format=json&limit=1`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(JSON.parse(d))); r.on('error',reject); });
    });
    if (!cGeo || !cGeo.length) return null;
    const clat = cGeo[0].lat, clon = cGeo[0].lon;
    // Get driving route
    const route = await new Promise((resolve, reject) => {
      https.get(`https://us1.locationiq.com/v1/directions/driving/${slon},${slat};${clon},${clat}?key=${key}&overview=false&steps=false`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(JSON.parse(d))); r.on('error',reject); });
    });
    if (!route || !route.routes || !route.routes.length) return null;
    const distMeters = route.routes[0].legs?.[0]?.distance || 0;
    return distMeters / 1000; // km
  } catch (e) { return null; }
}

app.post('/api/calc-freight', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Endereço obrigatório' });
  const settings = await getSettings();
  const rate = parseFloat(settings.delivery_rate_per_km) || 0;
  if (!rate) return res.json({ distance_km: 0, fee: 0, note: 'Taxa por km não configurada' });
  const distKm = await calcDistance(address, settings);
  if (distKm === null) return res.json({ distance_km: 0, fee: 0, note: 'Não foi possível calcular distância' });
  const fee = Math.round(distKm * rate * 100) / 100;
  res.json({ distance_km: Math.round(distKm * 10) / 10, fee });
});

// ─── ORDERS ───
app.post('/api/orders', async (req, res) => {
  const { customer, items, payment_method, payment_method_detail, notes, amount_paid, change_due, coupon_code, order_type } = req.body;
  if (!customer || !items || !items.length) return res.status(400).json({ error: 'Dados incompletos' });

  const isPickup = order_type === 'pickup';
  const settings = await getSettings();
  let deliveryFee = 0;
  if (!isPickup) {
    const rate = parseFloat(settings.delivery_rate_per_km) || 0;
    if (rate > 0) {
      const addr = [customer.address, customer.neighborhood].filter(Boolean).join(', ');
      const distKm = await calcDistance(addr, settings);
      if (distKm !== null) deliveryFee = Math.round(distKm * rate * 100) / 100;
    }
    if (!deliveryFee) {
      const nf = customer.neighborhood
        ? await db.get('SELECT fee FROM neighborhood_fees WHERE neighborhood=?', customer.neighborhood.trim())
        : null;
      deliveryFee = nf ? nf.fee : parseFloat(settings.delivery_fee);
      if (isNaN(deliveryFee)) deliveryFee = 5;
    }
  }
  const subtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  let total = subtotal + deliveryFee;
  let appliedCoupon = null;

  if (coupon_code) {
    const now = new Date().toISOString();
    const coupon = await db.get("SELECT * FROM coupons WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit=0 OR times_used < usage_limit)", coupon_code.toUpperCase(), now);
    if (coupon && subtotal >= coupon.min_value) {
      const discount = coupon.discount_value > 0
        ? Math.min(coupon.discount_value, subtotal)
        : subtotal * (coupon.discount_percent / 100);
      total = subtotal + deliveryFee - discount;
      if (total < 0) total = 0;
      appliedCoupon = coupon_code.toUpperCase();
      await db.run('UPDATE coupons SET times_used = times_used + 1 WHERE id=?', coupon.id);
    }
  }

  let customerId = null;
  const existing = await db.get('SELECT id FROM customers WHERE phone = ?', customer.phone);
  if (existing) {
    customerId = existing.id;
    await db.run('UPDATE customers SET name=?,address=?,neighborhood=? WHERE id=?',
      customer.name, customer.address || '', customer.neighborhood || '', customerId);
  } else {
    const r = await db.run('INSERT INTO customers (name,phone,address,neighborhood) VALUES (?,?,?,?)',
      customer.name, customer.phone, customer.address || '', customer.neighborhood || '');
    customerId = r.lastInsertRowid;
  }

  const r = await db.run(`INSERT INTO orders (customer_id,customer_name,customer_phone,customer_address,customer_neighborhood,items_json,total,delivery_fee,payment_method,payment_method_detail,amount_paid,change_due,notes,coupon_code,order_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    customerId, customer.name, customer.phone, customer.address || '', customer.neighborhood || '',
    JSON.stringify(items), total, deliveryFee, payment_method || 'dinheiro',
    payment_method_detail || '', amount_paid || null, change_due || 0, notes || '', appliedCoupon || '', isPickup ? 'pickup' : 'delivery');

  if (io) io.to('admin').emit('new-order', { id: r.lastInsertRowid, customer_name: customer.name, total, payment_method: payment_method || 'dinheiro' });

  res.json({ id: r.lastInsertRowid, total, delivery_fee: deliveryFee });
});

app.post('/api/orders/clear-history', adminAuth, async (req, res) => {
  const r = await db.run("DELETE FROM orders WHERE status IN ('finalizado','cancelado','entregue')");
  res.json({ deleted: r.changes });
});

app.get('/api/flash-status', async (req, res) => {
  const s = await getSettings();
  const endTime = s.flash_end_time;
  if (!endTime) return res.json({ active: false, remaining: 0 });
  const now = Date.now();
  const end = new Date(endTime).getTime();
  const remaining = Math.max(0, end - now);
  res.json({ active: remaining > 0, remaining, end_time: endTime, now: new Date().toISOString() });
});

app.get('/api/orders', adminAuth, async (req, res) => {
  const orders = await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
  for (const o of orders) { o.items = JSON.parse(o.items_json); }
  res.json(orders);
});

app.get('/api/orders/:id', async (req, res) => {
  const o = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });
  o.items = JSON.parse(o.items_json);
  res.json(o);
});

app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  const current = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (status === 'preparando' && current.payment_method === 'pix' && current.payment_status !== 'pago') {
    return res.status(400).json({ error: 'Aguardando confirmação do pagamento Pix' });
  }
  await db.run('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', status, req.params.id);
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (order) order.items = JSON.parse(order.items_json);
  if (io) { io.to('admin').emit('order-status', order); io.to(`order-${order.id}`).emit('status-update', order); }
  // Auto-print quando admin aceita o pedido (status → preparando)
  if (status === 'preparando' && !isNetlify) {
    getSettings().then(s => {
      if (s.auto_print === '1' || s.auto_print === undefined) {
        printerManager?.printOrder(order, s).catch(e => console.log('[Printer] Auto-print error:', e.message));
      }
    }).catch(() => {});
  }
  res.json(order);
});

app.put('/api/orders/:id/confirm', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status !== 'entregue') return res.status(400).json({ error: 'Pedido ainda não foi marcado como entregue' });
  await db.run("UPDATE orders SET status='finalizado', updated_at=CURRENT_TIMESTAMP WHERE id=?", req.params.id);
  const updated = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);

  // Loyalty: increment count for this customer (try/catch p/ nao quebrar confirmacao)
  try {
    const phone = updated.customer_phone;
    if (phone) {
      let loyalty = await db.get('SELECT * FROM loyalty WHERE phone=?', phone);
      if (!loyalty) {
        await db.run('INSERT INTO loyalty (phone, count) VALUES (?, 1)', phone);
        loyalty = { count: 1 };
      } else {
        await db.run('UPDATE loyalty SET count = count + 1 WHERE phone=?', phone);
        loyalty.count += 1;
      }
      const settings = await getSettings();
      const loyaltyGoal = parseInt(settings.loyalty_goal) || 10;
      updated.loyaltyGoal = loyaltyGoal;
      if (loyalty.count >= loyaltyGoal) {
        const rewardProductId = parseInt(settings.loyalty_reward_product_id) || 0;
        let rewardCreated = false;
        if (rewardProductId > 0) {
          const product = await db.get('SELECT * FROM products WHERE id=?', rewardProductId);
          if (product) {
            const couponCode = `FIDEL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            await db.run('INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit) VALUES (?,0,?,?,?,1,1)',
              couponCode, product.price, `🎉 Grátis: ${product.name}`, product.image_url || '');
            await db.run('INSERT INTO loyalty_rewards (phone, coupon_code, reward_product_id) VALUES (?,?,?)', phone, couponCode, rewardProductId);
            updated.loyaltyReward = { code: couponCode, value: product.price, type: 'product', desc: `Grátis: ${product.name}`, product_id: rewardProductId, product_name: product.name, image_url: product.image_url || '' };
            rewardCreated = true;
          }
        }
        if (!rewardCreated) {
          const rewardType = settings.loyalty_reward_type || 'fixed';
          const rewardValue = parseFloat(settings.loyalty_reward_value || settings.loyalty_reward || 20);
          const rewardDesc = settings.loyalty_reward_desc || (rewardType === 'percent' ? `${rewardValue}% de desconto no próximo pedido` : `R$ ${rewardValue.toFixed(2).replace('.',',')} de desconto`);
          const rewardImage = settings.loyalty_reward_image || '';
          const couponCode = `FIDEL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          if (rewardType === 'percent') {
            await db.run('INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit) VALUES (?,?,0,?,?,1,1)',
              couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
          } else {
            await db.run('INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit) VALUES (?,0,?,?,?,1,1)',
              couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
          }
          await db.run('INSERT INTO loyalty_rewards (phone, coupon_code) VALUES (?,?)', phone, couponCode);
          updated.loyaltyReward = { code: couponCode, value: rewardValue, type: rewardType, desc: rewardDesc, image_url: rewardImage };
        }
        // Sempre resetar count quando a meta for atingida
        await db.run('UPDATE loyalty SET count = 0 WHERE phone=?', phone);
        loyalty.count = 0;
      }
      updated.loyaltyCount = loyalty.count;
    }
  } catch (e) {
    console.error('Erro no loyalty:', e);
  }

  if (io) { io.to('admin').emit('order-status', updated); io.to(`order-${updated.id}`).emit('status-update', updated); }
  res.json(updated);
});

app.post('/api/loyalty/force-reward', adminAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório' });
  const settings = await getSettings();
  const rewardType = settings.loyalty_reward_type || 'fixed';
  const rewardValue = parseFloat(settings.loyalty_reward_value || settings.loyalty_reward || 20);
  const rewardDesc = settings.loyalty_reward_desc || (rewardType === 'percent' ? `${rewardValue}% de desconto no próximo pedido` : `R$ ${rewardValue.toFixed(2).replace('.',',')} de desconto`);
  const rewardImage = settings.loyalty_reward_image || '';
  const couponCode = `FIDEL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  if (rewardType === 'percent') {
    await db.run('INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit) VALUES (?,?,0,?,?,1,1)',
      couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
  } else {
    await db.run('INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit) VALUES (?,0,?,?,?,1,1)',
      couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
  }
  await db.run('INSERT INTO loyalty_rewards (phone, coupon_code) VALUES (?,?)', phone, couponCode);
  await db.run('UPDATE loyalty SET count = 0 WHERE phone=?', phone);
  res.json({ code: couponCode, value: rewardValue, type: rewardType });
});

app.post('/api/orders/:id/cancel-customer', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status !== 'novo') return res.status(400).json({ error: 'Só pode cancelar pedidos novos' });
  await db.run("UPDATE orders SET status='cancelado', updated_at=CURRENT_TIMESTAMP WHERE id=?", req.params.id);
  const updated = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);
  if (io) { io.to('admin').emit('order-status', updated); io.to(`order-${updated.id}`).emit('status-update', updated); }
  res.json(updated);
});

// ─── PAGSEGURO (PAGBANK) ───
const PS_API = 'https://api.pagseguro.com';
let psAccessToken = null;
let psTokenExpiry = 0;

async function psFetch(path, opts = {}) {
  const s = await getSettings();
  if (!s.pagseguro_token) throw new Error('PagSeguro não configurado');

  let token = s.pagseguro_token;
  if (s.pagseguro_client_id && s.pagseguro_client_secret) {
    if (!psAccessToken || Date.now() >= psTokenExpiry) {
      console.log('[PagSeguro] Obtendo access token via OAuth...');
      const r = await fetch(`${PS_API}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${s.pagseguro_token}`,
          'X_CLIENT_ID': s.pagseguro_client_id,
          'X_CLIENT_SECRET': s.pagseguro_client_secret,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=sms&email=' + encodeURIComponent(s.pagseguro_client_id)
      });
      const d = await r.json();
      if (!r.ok) {
        console.error('[PagSeguro] Erro OAuth:', r.status, JSON.stringify(d));
        if (d.error_messages?.[0]?.description?.includes('sms')) {
          console.log('[PagSeguro] SMS nao disponivel, tentando direto com token');
        } else {
          throw new Error(d.error_messages?.[0]?.description || d.message || 'Erro OAuth');
        }
      } else {
        psAccessToken = d.access_token;
        psTokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
        console.log('[PagSeguro] Access token obtido, expira em', d.expires_in, 's');
      }
    }
    if (psAccessToken) token = psAccessToken;
  }

  const url = `${PS_API}${path}`;
  const tokenPreview = token.substring(0, 15) + '...';
  console.log('[PagSeguro]', opts.method || 'GET', url, 'token:', tokenPreview);
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, ...opts.headers }
  });
  let d;
  try { d = await r.json(); } catch (e) { const t = await r.text(); d = { raw: t.substring(0,200) }; }
  if (!r.ok) {
    console.error('[PagSeguro] ERRO', r.status, r.statusText, JSON.stringify(d));
    throw new Error(d.error_messages?.[0]?.description || d.message || d.error || `HTTP ${r.status} ${r.statusText}`);
  }
  console.log('[PagSeguro] sucesso', r.status);
  return d;
}

// Debug: testar config PagSeguro
app.get('/api/debug/pagseguro', async (req, res) => {
  try {
    const s = await getSettings();
    const token = s.pagseguro_token;
    if (!token) return res.json({ configured: false, msg: 'Token não configurado' });
    const r = await fetch(`${PS_API}/orders?page=1&size=1`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const d = await r.json();
    res.json({ status: r.status, ok: r.ok, response: d, tokenPreview: token.substring(0,15)+'...' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pix payment via PagSeguro
app.post('/api/orders/:id/pay', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  try {
    if (order.payment_method === 'pix') {
      const items = JSON.parse(order.items_json || '[]');
      const customer = { name: order.customer_name || 'Cliente', email: order.customer_email || 'cliente@email.com' };
      if (order.customer_doc) customer.tax_id = order.customer_doc;
      const body = {
        reference_id: `pedido${order.id}`,
        customer,
        items: items.map((it, i) => ({
          reference_id: String(it.id || i),
          name: it.name || 'Item',
          quantity: it.qty || 1,
          unit_amount: Math.round((it.price || 0) * 100)
        })),
        charges: [{
          reference_id: `cob${order.id}`,
          description: `Pedido #${order.id}`,
          amount: { value: Math.round(order.total * 100), currency: 'BRL' },
          payment_method: { type: 'PIX', pix: { expiration: 3600 } }
        }]
      };
      console.log('[PagSeguro] criando pedido Pix, body:', JSON.stringify(body).substring(0,200));
      const charge = await psFetch('/orders', { method:'POST', body: JSON.stringify(body) });
      const ch = charge.charges?.[0] || charge;
      const pix = ch.payment_method?.pix || {};
      const qrCode = pix.qr_codes?.[0] || {};
      const chargeId = ch.id || charge.id;
      const data = { qr_code: qrCode.text, qr_code_base64: qrCode.image, charge_id: chargeId };
      if (chargeId) await db.run('UPDATE orders SET ps_charge_id=?, payment_data_json=? WHERE id=?', chargeId, JSON.stringify(data), order.id);
      res.json({ method:'pix', qr_code: qrCode.text, qr_code_base64: qrCode.image, charge_id: chargeId });
    } else {
      res.status(400).json({ error: 'Método de pagamento não suportado' });
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/orders/:id/payment-status', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order || !order.ps_charge_id) return res.json({ status:'pending' });
  try {
    const c = await psFetch(`/charges/${order.ps_charge_id}`);
    const statusMap = { 'PAID': 'approved', 'PENDING': 'pending', 'CANCELED': 'cancelled', 'DECLINED': 'rejected' };
    res.json({ status: statusMap[c.status] || 'pending', status_detail: c.status });
  } catch (e) { res.json({ status:'pending' }); }
});

app.post('/api/orders/:id/confirm-payment', async (req, res) => {
  const current = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (current.payment_status === 'pago') return res.json({ ok: true });
  await db.run("UPDATE orders SET payment_status='pago', status='preparando', updated_at=CURRENT_TIMESTAMP WHERE id=?", req.params.id);
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (order) {
    order.items = JSON.parse(order.items_json);
    if (io) {
      io.to(`order-${order.id}`).emit('payment-confirmed', order);
      io.to(`order-${order.id}`).emit('status-update', order);
      io.to('admin').emit('order-status', order);
      io.to('admin').emit('payment-confirmed-admin', { id: order.id });
    }
    // Auto-print Pix apos confirmacao do pagamento
    if (!isNetlify) {
      getSettings().then(s => {
        if (s.auto_print === '1' || s.auto_print === undefined) {
          printerManager?.printOrder(order, s).catch(e => console.log('[Printer] Pix auto-print error:', e.message));
        }
      }).catch(() => {});
    }
  }
  res.json({ ok: true });
});

app.post('/api/orders/:id/refund', adminAuth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (!order.ps_charge_id) return res.status(400).json({ error: 'Nenhuma cobranca PagSeguro para reembolsar' });
  try {
    await psFetch(`/charges/${order.ps_charge_id}/cancel`, { method:'POST' });
    await db.run("UPDATE orders SET payment_status='reembolsado' WHERE id=?", req.params.id);
    const updated = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
    if (updated) { updated.items = JSON.parse(updated.items_json); if (io) io.to(`order-${updated.id}`).emit('payment-refunded', updated); }
    if (io) io.to('admin').emit('order-status', updated);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders/:id/cancel-with-refund', adminAuth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido n�o encontrado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'J� cancelado' });

  let needsRefund = false;
  if (order.ps_charge_id) {
    try {
      const c = await psFetch(`/charges/${order.ps_charge_id}`);
      if (c.status === 'PAID') needsRefund = true;
    } catch (e) {}
  }

  if (needsRefund) {
    try {
      await psFetch(`/charges/${order.ps_charge_id}/cancel`, { method:'POST' });
      await db.run("UPDATE orders SET status='cancelado', payment_status='reembolsado', updated_at=CURRENT_TIMESTAMP WHERE id=?", req.params.id);
    } catch (e) { return res.status(400).json({ error: 'Erro ao reembolsar: ' + e.message }); }
  } else {
    await db.run("UPDATE orders SET status='cancelado', updated_at=CURRENT_TIMESTAMP WHERE id=?", req.params.id);
  }

  const updated = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);
  if (io) { io.to('admin').emit('order-status', updated); io.to(`order-${updated.id}`).emit('status-update', updated); }
  res.json(updated);
});

// PagSeguro notification webhook
app.post('/api/pagseguro/webhook', async (req, res) => {
  try {
    const { charge_id, status } = req.body;
    if (!charge_id) return res.status(400).json({ error: 'charge_id obrigatorio' });
    const order = await db.get('SELECT * FROM orders WHERE ps_charge_id=?', charge_id);
    if (!order) return res.status(404).json({ error: 'Pedido n�o encontrado' });
    if (status === 'PAID' && order.payment_status !== 'pago') {
      await db.run("UPDATE orders SET payment_status='pago', status='preparando', updated_at=CURRENT_TIMESTAMP WHERE id=?", order.id);
      const updated = await db.get('SELECT * FROM orders WHERE id=?', order.id);
      if (updated) {
        updated.items = JSON.parse(updated.items_json);
        if (io) { io.to(`order-${updated.id}`).emit('payment-confirmed', updated); io.to(`order-${updated.id}`).emit('status-update', updated); io.to('admin').emit('order-status', updated); io.to('admin').emit('payment-confirmed-admin', { id: updated.id }); }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CUSTOMERS ───
app.get('/api/customers', adminAuth, async (req, res) => {
  const customers = await db.all(`SELECT c.*, COUNT(o.id) as total_orders, SUM(o.total) as total_spent
    FROM customers c LEFT JOIN orders o ON c.id = o.customer_id
    GROUP BY c.id ORDER BY c.created_at DESC`);
  res.json(customers);
});

// ─── AUTH ───
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) return res.json({ token: ADMIN_PASSWORD });
  res.status(401).json({ error: 'Senha incorreta' });
});

app.get('/orders-count', adminAuth, async (req, res) => {
  const novos = await db.get("SELECT COUNT(*) as c FROM orders WHERE status='novo'");
  const preparando = await db.get("SELECT COUNT(*) as c FROM orders WHERE status='preparando'");
  const enviado = await db.get("SELECT COUNT(*) as c FROM orders WHERE status='entregando'");
  const finalizados = await db.get("SELECT COUNT(*) as c FROM orders WHERE status='finalizado'");
  const total = await db.get("SELECT COUNT(*) as c FROM orders");
  res.json({ novos: novos.c, preparando: preparando.c, enviado: enviado.c, finalizados: finalizados.c, total: total.c });
});

app.get('/api/sales-report', adminAuth, async (req, res) => {
  const period = req.query.period || 'total';
  let dateFilter = '';
  if (period === 'hoje') dateFilter = "AND date(created_at, 'localtime') = date('now','localtime')";
  else if (period === 'semana') dateFilter = "AND datetime(created_at, 'localtime') >= datetime('now','-7 days','localtime')";
  else if (period === 'mes') dateFilter = "AND datetime(created_at, 'localtime') >= datetime('now','-30 days','localtime')";
  const rows = await db.all(`SELECT payment_method, payment_method_detail, COUNT(*) as count, SUM(total) as total
    FROM orders WHERE status NOT IN ('novo','cancelado') ${dateFilter}
    GROUP BY payment_method, payment_method_detail ORDER BY payment_method, payment_method_detail`);
  const totals = { pix:{count:0,total:0}, dinheiro:{count:0,total:0}, cartao:{count:0,total:0,credito:{count:0,total:0},debito:{count:0,total:0}} };
  let geral = { count:0, total:0 };
  for (const r of rows) {
    const t = parseFloat(r.total) || 0;
    if (totals[r.payment_method]) {
      totals[r.payment_method].count += r.count;
      totals[r.payment_method].total += t;
      if (r.payment_method === 'cartao' && r.payment_method_detail && totals.cartao[r.payment_method_detail]) {
        totals.cartao[r.payment_method_detail].count += r.count;
        totals.cartao[r.payment_method_detail].total += t;
      }
    }
    geral.count += r.count;
    geral.total += t;
  }
  res.json({ totals, geral });
});

// User auth helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === verify;
}

app.post('/api/auth/register', async (req, res) => {
  const { name, phone, password, email, cpf, cep, address_number, address, neighborhood } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'Nome, telefone e senha obrigatórios' });
  const existing = await db.get('SELECT id FROM users WHERE phone=?', phone);
  if (existing) return res.status(400).json({ error: 'Telefone já cadastrado' });
  const hash = hashPassword(password);
  const token = crypto.randomBytes(32).toString('hex');
  const r = await db.run('INSERT INTO users (name,phone,email,cpf,cep,address_number,password_hash,address,neighborhood,auth_token) VALUES (?,?,?,?,?,?,?,?,?,?)',
    name, phone, email || '', cpf || '', cep || '', address_number || '', hash, address || '', neighborhood || '', token);
  res.json({ id: r.lastInsertRowid, name, phone, email: email || '', cpf: cpf || '', cep: cep || '', address_number: address_number || '', auth_token: token });
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Telefone e senha obrigatórios' });
  const user = await db.get('SELECT * FROM users WHERE phone=?', phone);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Telefone ou senha incorretos' });
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('UPDATE users SET auth_token=? WHERE id=?', token, user.id);
  res.json({ id: user.id, name: user.name, phone: user.phone, email: user.email || '', cpf: user.cpf || '', cep: user.cep || '', address_number: user.address_number || '', address: user.address, neighborhood: user.neighborhood, auth_token: token });
});

app.get('/api/auth/me', userAuth, (req, res) => { res.json(req.user); });

app.put('/api/auth/profile', userAuth, async (req, res) => {
  const { name, address, neighborhood, cpf, cep, address_number, email } = req.body;
  await db.run('UPDATE users SET name=?,address=?,neighborhood=?,cpf=?,cep=?,address_number=?,email=? WHERE id=?',
    name || req.user.name, address || '', neighborhood || '', cpf || '', cep || '', address_number || '', email || '', req.user.id);
  res.json({ ok: true });
});

// ─── CAIXA ───
async function calcCaixa(register) {
  if (!register) return null;
  const salesTotal = (await db.get(
    "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE created_at >= ? AND status != 'cancelado'", register.opened_at)).s;
  const trocoTotal = (await db.get(
    "SELECT COALESCE(SUM(change_due),0) as s FROM orders WHERE created_at >= ? AND payment_method='dinheiro' AND status != 'cancelado'", register.opened_at)).s;
  const movements = await db.all('SELECT type, COALESCE(SUM(amount),0) as total FROM cash_movements WHERE register_id=? GROUP BY type', register.id);
  const entradas = movements.find(m => m.type === 'entrada')?.total || 0;
  const saidas = movements.find(m => m.type === 'saida')?.total || 0;
  const netSales = salesTotal - trocoTotal;
  const expected = register.initial_balance + salesTotal + entradas - saidas;
  return { ...register, sales_total: salesTotal, troco_total: trocoTotal, net_sales: netSales, mov_entradas: entradas, mov_saidas: saidas, expected_balance: expected };
}

app.get('/api/admin/caixa', adminAuth, async (req, res) => {
  const r = await db.get("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  res.json(await calcCaixa(r));
});

app.post('/api/admin/caixa/abrir', adminAuth, async (req, res) => {
  const { initial_balance, notes } = req.body;
  const aberto = await db.get("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  if (aberto) return res.status(400).json({ error: 'Já existe um caixa aberto. Feche-o primeiro.' });
  const today = new Date().toISOString().split('T')[0];
  const r = await db.run('INSERT INTO cash_register (date, initial_balance, notes) VALUES (?,?,?)', today, initial_balance || 0, notes || '');
  const reg = await db.get('SELECT * FROM cash_register WHERE id=?', r.lastInsertRowid);
  res.json(await calcCaixa(reg));
});

app.post('/api/admin/caixa/fechar', adminAuth, async (req, res) => {
  const { actual_balance, notes } = req.body;
  const r = await db.get("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  if (!r) return res.status(400).json({ error: 'Nenhum caixa aberto' });
  const calc = await calcCaixa(r);
  await db.run('UPDATE cash_register SET closed_at=CURRENT_TIMESTAMP, status=?, expected_balance=?, actual_balance=?, difference=?, notes=? WHERE id=?',
    'fechado', calc.expected_balance, actual_balance || 0, (actual_balance || 0) - calc.expected_balance, notes || '', r.id);
  const reg = await db.get('SELECT * FROM cash_register WHERE id=?', r.id);
  res.json(await calcCaixa(reg));
});

app.post('/api/admin/caixa/movimento', adminAuth, async (req, res) => {
  const { type, amount, description, reference } = req.body;
  const r = await db.get("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1");
  if (!r) return res.status(400).json({ error: 'Caixa não está aberto' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
  await db.run('INSERT INTO cash_movements (register_id, type, amount, description, reference) VALUES (?,?,?,?,?)',
    r.id, type, amount, description || '', reference || '');
  res.json({ ok: true });
});

app.get('/api/admin/caixa/historico', adminAuth, async (req, res) => {
  const registers = await db.all('SELECT * FROM cash_register ORDER BY id DESC LIMIT 60');
  const results = [];
  for (const r of registers) results.push(await calcCaixa(r));
  res.json(results);
});

app.get('/api/admin/caixa/movimentos/:registerId', adminAuth, async (req, res) => {
  const movs = await db.all('SELECT * FROM cash_movements WHERE register_id=? ORDER BY id', req.params.registerId);
  res.json(movs);
});

// ─── STATIC FILES ───
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), { maxAge: 0, etag: false, lastModified: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ─── UPLOAD ───
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
let upload;
if (useCloudinary) {
  upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
} else {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
    }
  });
  upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
}
app.post('/api/upload', adminAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erro no upload' });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    try {
      if (useCloudinary) {
        const b64 = req.file.buffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataUri, { folder: 'acaineiro' });
        res.json({ url: result.secure_url });
      } else {
        res.json({ url: `/uploads/${req.file.filename}` });
      }
    } catch (e) {
      console.error('[Upload]', e.message);
      res.status(500).json({ error: e.message || 'Erro ao enviar imagem' });
    }
  });
});

// ─── PRINT ROUTES ───
app.post('/api/print/:id', adminAuth, async (req, res) => {
  try {
    if (isNetlify) return res.status(400).json({ error: 'IMPRIMIR_NO_NAVEGADOR' });
    const order = await db.get('SELECT * FROM orders WHERE id=?', req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    const settings = await getSettings();
    const status = printerManager?.getStatus();
    if (!status?.configured || status.mode === 'file') return res.status(400).json({ error: 'IMPRIMIR_NO_NAVEGADOR' });
    await printerManager.printOrder(order, settings);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/print/test', adminAuth, async (req, res) => {
  try {
    if (isNetlify) return res.status(400).json({ error: 'IMPRIMIR_NO_NAVEGADOR' });
    const status = printerManager?.getStatus();
    if (!status?.configured || status.mode === 'file') return res.status(400).json({ error: 'IMPRIMIR_NO_NAVEGADOR' });
    await printerManager.printTest(await getSettings());
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/print/status', async (req, res) => {
  if (isNetlify || !printerManager) return res.json({ configured: false, mode: 'none', error: 'Servidor local apenas' });
  res.json(printerManager.getStatus());
});

// Criar aplicação PagBank (gera Client ID + Client Secret via API)
app.post('/api/pagbank/criar-aplicacao', adminAuth, async (req, res) => {
  try {
    const s = await getSettings();
    if (!s.pagseguro_token) return res.status(400).json({ error: 'Token PagSeguro não configurado' });
    const body = {
      name: 'Açaineiro',
      description: 'Sistema de pedidos online',
      site: 'https://sistemaacaineiro.netlify.app',
      redirect_uri: 'https://sistemaacaineiro.netlify.app/admin/'
    };
    console.log('[PagBank] Criando aplicacao...');
    const r = await fetch('https://api.pagseguro.com/oauth2/application', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${s.pagseguro_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) return res.status(400).json({ error: d.error_messages?.[0]?.description || d.message || 'Erro', detalhes: d });
    console.log('[PagBank] Aplicacao criada:', JSON.stringify(d));
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Netlify export
module.exports = app;
