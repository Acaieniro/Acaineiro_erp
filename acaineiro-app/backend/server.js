const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'acaineiro.db');
const ADMIN_PASSWORD = 'admin123';

app.use(cors());
app.use(express.json());
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
app.use('/app', express.static(WWW_PATH, {
  maxAge: 0,
  setHeaders(res, p) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(WWW_PATH, 'index.html'));
});

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '📋',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      promo_price REAL,
      has_promo INTEGER DEFAULT 0,
      image TEXT DEFAULT '',
      icon TEXT DEFAULT '🥣',
      active INTEGER DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT DEFAULT '',
      neighborhood TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT DEFAULT '',
      customer_neighborhood TEXT DEFAULT '',
      items_json TEXT NOT NULL,
      total REAL NOT NULL,
      delivery_fee REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'dinheiro',
    payment_status TEXT DEFAULT 'pendente',
    status TEXT DEFAULT 'novo',
    amount_paid REAL,
    change_due REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      initial_balance REAL DEFAULT 0,
      expected_balance REAL,
      actual_balance REAL,
      difference REAL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'aberto'
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      register_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      reference TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (register_id) REFERENCES cash_register(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      address TEXT DEFAULT '',
      neighborhood TEXT DEFAULT '',
      auth_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saved_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_token TEXT NOT NULL,
      last_four TEXT NOT NULL,
      first_six TEXT NOT NULL,
      cardholder_name TEXT NOT NULL,
      expiration_month TEXT NOT NULL,
      expiration_year TEXT NOT NULL,
      brand TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      button_text TEXT DEFAULT '',
      button_action TEXT DEFAULT 'menu',
      image_url TEXT DEFAULT '',
      bg_color TEXT DEFAULT '#7C3AED',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_percent INTEGER DEFAULT 0,
      discount_value REAL DEFAULT 0,
      min_value REAL DEFAULT 0,
      description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      usage_limit INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      old_price REAL,
      icon TEXT DEFAULT '🎯',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS combo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      combo_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS loyalty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS loyalty_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      coupon_code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { db.prepare('ALTER TABLE coupons ADD COLUMN discount_value REAL DEFAULT 0').run(); } catch (e) {}
  try { db.prepare("ALTER TABLE banners ADD COLUMN emoji TEXT DEFAULT ''").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE banners ADD COLUMN icon_url TEXT DEFAULT ''").run(); } catch (e) {}

  try { db.prepare('ALTER TABLE users ADD COLUMN mp_customer_id TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE users ADD COLUMN asaas_customer_id TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE users ADD COLUMN cpf TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE users ADD COLUMN cep TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE users ADD COLUMN address_number TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE saved_cards ADD COLUMN mp_card_id TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE saved_cards ADD COLUMN asaas_card_token TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE saved_cards ADD COLUMN asaas_customer_id TEXT').run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN payment_method_detail TEXT DEFAULT ''").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE coupons ADD COLUMN name TEXT DEFAULT ''").run(); } catch (e) {}

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)').run('Açaís', 'acai', '🥣', 1);
    db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)').run('Pratos', 'pratos', '🍽️', 2);
    db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)').run('Bebidas', 'bebidas', '🥤', 3);
    db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)').run('Extras', 'extras', '➕', 4);

    const inserts = [
      [1, 'Açaí Tradicional', 'Açaí puro com banana, granola e mel', 15],
      [1, 'Açaí Premium', 'Açaí com leite em pó, banana, granola, morango e mel', 20],
      [1, 'Açaí Power', 'Açaí com whey, banana, pasta de amendoim, granola e mel', 25],
      [1, 'Açaí Tropical', 'Açaí com abacaxi, coco ralado, granola e leite condensado', 22],
      [1, 'Açaí Fit', 'Açaí zero açúcar com chia, banana, morango e granola integral', 23],
      [2, 'Tamboril', 'Peixe tamboril preparado com tempero especial da casa', 35],
      [2, 'Virado à Mineira', 'Arroz, feijão, couve, torresmo, ovo e bisteca', 28],
      [2, 'Filé Americain', 'Filé mignon ao molho especial com fritas e arroz', 38],
      [2, 'Sima', 'Prato típico mineiro com acompanhamentos', 30],
      [3, 'Suco Natural', 'Laranja, limão, maracujá, acerola ou abacaxi', 8],
      [3, 'Vitamina de Frutas', 'Banana, morango, mamão ou abacate', 12],
      [3, 'Refrigerante Lata', 'Coca-Cola, Guaraná, Fanta ou Sprite', 6],
      [4, 'Nutella Extra', 'Porção extra de Nutella', 5],
      [4, 'Granola Extra', 'Porção extra de granola crocante', 3],
      [4, 'Frutas Extras', 'Banana, morango, abacaxi ou kiwi', 3],
    ];

    const stmt = db.prepare('INSERT INTO products (category_id, name, description, price) VALUES (?, ?, ?, ?)');
    for (const p of inserts) stmt.run(...p);
  }

  const sCount = db.prepare("SELECT COUNT(*) as c FROM settings WHERE key = 'delivery_fee'").get();
  if (sCount.c === 0) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('delivery_fee', '5');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('store_open', '13:00');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('store_close', '20:30');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('store_phone', '5531975785413');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('store_address', 'R. Venezuela, 68 - Contagem, MG');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('store_name', 'Açaineiro');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('pix_key', '');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('mp_access_token', '');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('mp_public_key', '');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('asaas_api_key', '');
  }

  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('flash_hours', '2'); } catch (e) {}
  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('flash_minutes', '30'); } catch (e) {}
  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('loyalty_goal', '10'); } catch (e) {}
  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('loyalty_reward', '20'); } catch (e) {}
  try { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('card_payment_enabled', '0'); } catch (e) {}
  try {
    const existing = db.prepare("SELECT value FROM settings WHERE key='flash_end_time'").get();
    if (!existing) {
      const d = new Date();
      d.setHours(d.getHours() + 2, d.getMinutes() + 30, 0, 0);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('flash_end_time', d.toISOString());
    }
  } catch (e) {}

  const bCount = db.prepare('SELECT COUNT(*) as c FROM banners').get();
  if (bCount.c === 0) {
    db.prepare('INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('O verdadeiro açaí mineiro', 'Ingredientes selecionados, sabor inesquecível', 'Ver Cardápio →', 'menu', '#7C3AED', 1);
    db.prepare('INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('Promoções imperdíveis', 'Ofertas especiais por tempo limitado', 'Ver Promos →', 'promos', '#DB2777', 2);
    db.prepare('INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('Delivery rápido e fácil', 'Pediu, chegou! Entrega em Contagem', 'Pedir Agora →', 'cart', '#059669', 3);
  }
}

initDB();

// Add columns if missing on existing DB
try { db.exec("ALTER TABLE orders ADD COLUMN amount_paid REAL"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN change_due REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN mp_payment_id TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_data_json TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''"); } catch (e) {}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

io.on('connection', (socket) => {
  socket.on('join-admin', () => { socket.join('admin'); });
  socket.on('join-order', (orderId) => {
    socket.join(`order-${orderId}`);
    socket.emit('connected', { orderId });
  });
});

const adminAuth = (req, res, next) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Não autorizado' });
  next();
};

app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.json(cats);
});

app.get('/api/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p JOIN categories c ON p.category_id = c.id
    WHERE p.active = 1 ORDER BY c.sort_order, p.id
  `).all();
  res.json(products);
});

app.get('/api/products/all', adminAuth, (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p JOIN categories c ON p.category_id = c.id
    ORDER BY c.sort_order, p.id
  `).all();
  res.json(products);
});

app.post('/api/products', adminAuth, (req, res) => {
  const { category_id, name, description, price, promo_price, icon, image } = req.body;
  const r = db.prepare('INSERT INTO products (category_id, name, description, price, promo_price, icon, image) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(category_id, name, description || '', price || 0, promo_price || null, icon || '🥣', image || '');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/products/:id', adminAuth, (req, res) => {
  const { name, description, price, promo_price, has_promo, icon, image, category_id, active } = req.body;
  db.prepare('UPDATE products SET name=?, description=?, price=?, promo_price=?, has_promo=?, icon=?, image=?, category_id=?, active=? WHERE id=?')
    .run(name, description, price, promo_price, has_promo ? 1 : 0, icon, image || '', category_id, active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/products/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM combo_items WHERE product_id=?').run(id);
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.json({ ok: true });
});

app.post('/api/products/:id/promo', adminAuth, (req, res) => {
  const { promo_price } = req.body;
  const has = promo_price > 0 ? 1 : 0;
  db.prepare('UPDATE products SET promo_price=?, has_promo=? WHERE id=?').run(promo_price || null, has, req.params.id);
  res.json({ ok: true });
});

app.get('/api/banners', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY sort_order').all();
  res.json(banners);
});

app.get('/api/banners/all', adminAuth, (req, res) => {
  const banners = db.prepare('SELECT * FROM banners ORDER BY sort_order').all();
  res.json(banners);
});

app.post('/api/banners', adminAuth, (req, res) => {
  const { title, subtitle, button_text, button_action, image_url, bg_color, emoji, icon_url } = req.body;
  const r = db.prepare('INSERT INTO banners (title, subtitle, button_text, button_action, image_url, bg_color, emoji, icon_url, sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(title || 'Banner', subtitle || '', button_text || '', button_action || 'menu', image_url || '', bg_color || '#7C3AED', emoji || '', icon_url || '', 0);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/banners/:id', adminAuth, (req, res) => {
  const { title, subtitle, button_text, button_action, image_url, bg_color, active, sort_order, emoji, icon_url } = req.body;
  db.prepare('UPDATE banners SET title=?, subtitle=?, button_text=?, button_action=?, image_url=?, bg_color=?, emoji=?, icon_url=?, active=?, sort_order=? WHERE id=?')
    .run(title, subtitle || '', button_text || '', button_action || 'menu', image_url || '', bg_color || '#7C3AED', emoji || '', icon_url || '', active ? 1 : 0, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/banners/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM banners WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── COUPONS ───
app.get('/api/coupons', (req, res) => {
  const now = new Date().toISOString();
    const coupons = db.prepare("SELECT * FROM coupons WHERE active=1 AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit=0 OR times_used < usage_limit) ORDER BY id ASC").all(now);
  res.json(coupons);
});

app.get('/api/coupons/all', adminAuth, (req, res) => {
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.json(coupons);
});

app.post('/api/coupons', adminAuth, (req, res) => {
  const { code, name, discount_percent, discount_value, min_value, description, image_url, usage_limit, expires_at } = req.body;
  if (!code || (!discount_percent && !discount_value)) return res.status(400).json({ error: 'Código e valor/porcentagem obrigatórios' });
  const existing = db.prepare('SELECT id FROM coupons WHERE code=?').get(code.toUpperCase());
  if (existing) return res.status(400).json({ error: 'Código já existe' });
  const r = db.prepare('INSERT INTO coupons (code, name, discount_percent, discount_value, min_value, description, image_url, usage_limit, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(code.toUpperCase(), name || '', discount_percent || 0, discount_value || 0, min_value || 0, description || '', image_url || '', usage_limit || 0, expires_at || null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/coupons/:id', adminAuth, (req, res) => {
  const { code, name, discount_percent, discount_value, min_value, description, image_url, active, usage_limit, expires_at } = req.body;
  db.prepare('UPDATE coupons SET code=?, name=?, discount_percent=?, discount_value=?, min_value=?, description=?, image_url=?, active=?, usage_limit=?, expires_at=? WHERE id=?')
    .run((code || '').toUpperCase(), name || '', discount_percent || 0, discount_value || 0, min_value || 0, description || '', image_url || '', active ? 1 : 0, usage_limit || 0, expires_at || null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/coupons/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  const c = db.prepare('SELECT code FROM coupons WHERE id=?').get(id);
  if (c) {
    db.prepare('DELETE FROM loyalty_rewards WHERE coupon_code=?').run(c.code);
  }
  db.prepare('DELETE FROM coupons WHERE id=?').run(id);
  res.json({ ok: true });
});

app.post('/api/coupons/validate', (req, res) => {
  const { code, subtotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Código obrigatório' });
  const now = new Date().toISOString();
  const coupon = db.prepare("SELECT * FROM coupons WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit=0 OR times_used < usage_limit)").get(code.toUpperCase(), now);
  if (!coupon) return res.status(400).json({ error: 'Cupom inválido ou expirado' });
  if (subtotal < coupon.min_value) return res.status(400).json({ error: `Valor mínimo de R$ ${coupon.min_value.toFixed(2).replace('.',',')} para usar este cupom` });
  const discount = coupon.discount_value > 0
    ? Math.min(coupon.discount_value, subtotal)
    : subtotal * (coupon.discount_percent / 100);
  res.json({ valid: true, code: coupon.code, discount_percent: coupon.discount_value > 0 ? 0 : coupon.discount_percent, discount, min_value: coupon.min_value, id: coupon.id });
});

app.post('/api/coupons/:id/use', (req, res) => {
  db.prepare('UPDATE coupons SET times_used = times_used + 1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── LOYALTY ───
app.get('/api/loyalty/rewards/all', adminAuth, (req, res) => {
  const rewards = db.prepare(`
    SELECT lr.phone, lr.coupon_code, lr.created_at
    FROM loyalty_rewards lr
    ORDER BY lr.created_at DESC LIMIT 100
  `).all();
  res.json(rewards);
});

app.get('/api/loyalty/:phone', (req, res) => {
  const phone = req.params.phone;
  if (!phone) return res.json({ count: 0, rewards: [] });
  const loyalty = db.prepare('SELECT * FROM loyalty WHERE phone=?').get(phone);
  const count = loyalty ? loyalty.count : 0;
  const rewards = db.prepare(`
    SELECT lr.coupon_code, lr.created_at, c.discount_percent, c.discount_value, c.description, c.image_url
    FROM loyalty_rewards lr
    LEFT JOIN coupons c ON lr.coupon_code = c.code
    WHERE lr.phone=?
    ORDER BY lr.created_at DESC
  `).all(phone);
  res.json({ count, rewards });
});

// ─── COMBOS ───
app.get('/api/combos', (req, res) => {
  const s = getSettings();
  const endTime = s.flash_end_time;
  const active = endTime ? Date.now() < new Date(endTime).getTime() : false;
  if (!active) return res.json([]);
  const combos = db.prepare('SELECT * FROM combos WHERE active=1 ORDER BY sort_order').all();
  for (const c of combos) {
    c.items = db.prepare(`
      SELECT ci.id as combo_item_id, ci.product_id, p.name, p.description, p.price, p.icon, p.image
      FROM combo_items ci JOIN products p ON ci.product_id = p.id
      WHERE ci.combo_id = ?
    `).all(c.id);
  }
  res.json(combos);
});

app.get('/api/combos/all', adminAuth, (req, res) => {
  const combos = db.prepare('SELECT * FROM combos ORDER BY sort_order').all();
  for (const c of combos) {
    c.items = db.prepare(`
      SELECT ci.id as combo_item_id, ci.product_id, p.name, p.description, p.price, p.icon, p.image
      FROM combo_items ci JOIN products p ON ci.product_id = p.id
      WHERE ci.combo_id = ?
    `).all(c.id);
  }
  res.json(combos);
});

app.post('/api/combos', adminAuth, (req, res) => {
  const { name, description, price, old_price, icon, sort_order } = req.body;
  const r = db.prepare('INSERT INTO combos (name, description, price, old_price, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, description || '', price || 0, old_price || null, icon || '🎯', sort_order || 0);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/combos/:id', adminAuth, (req, res) => {
  const { name, description, price, old_price, icon, active, sort_order } = req.body;
  db.prepare('UPDATE combos SET name=?, description=?, price=?, old_price=?, icon=?, active=?, sort_order=? WHERE id=?')
    .run(name, description || '', price, old_price || null, icon || '🎯', active ? 1 : 0, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/combos/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM combo_items WHERE combo_id=?').run(id);
  db.prepare('DELETE FROM combos WHERE id=?').run(id);
  res.json({ ok: true });
});

app.post('/api/combos/:id/items', adminAuth, (req, res) => {
  const { product_id } = req.body;
  const existing = db.prepare('SELECT id FROM combo_items WHERE combo_id=? AND product_id=?').get(req.params.id, product_id);
  if (existing) return res.status(400).json({ error: 'Produto já está no combo' });
  const r = db.prepare('INSERT INTO combo_items (combo_id, product_id) VALUES (?, ?)').run(req.params.id, product_id);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/combos/:id/items/:itemId', adminAuth, (req, res) => {
  db.prepare('DELETE FROM combo_items WHERE id=? AND combo_id=?').run(req.params.itemId, req.params.id);
  res.json({ ok: true });
});

app.get('/api/products/top', (req, res) => {
  const topProducts = db.prepare(`
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
    ORDER BY total_sold DESC, p.id
    LIMIT 8
  `).all();
  res.json(topProducts);
});

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', adminAuth, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(req.body)) stmt.run(k, String(v));
  if (req.body.flash_hours !== undefined || req.body.flash_minutes !== undefined) {
    const s = getSettings();
    const hours = parseInt(req.body.flash_hours ?? s.flash_hours ?? '2');
    const minutes = parseInt(req.body.flash_minutes ?? s.flash_minutes ?? '30');
    const d = new Date();
    d.setHours(d.getHours() + hours, d.getMinutes() + minutes, 0, 0);
    stmt.run('flash_end_time', d.toISOString());
  }
  res.json({ ok: true });
});

app.post('/api/orders', (req, res) => {
  const { customer, items, payment_method, payment_method_detail, notes, amount_paid, change_due, coupon_code } = req.body;
  if (!customer || !items || !items.length) return res.status(400).json({ error: 'Dados incompletos' });

  const settings = getSettings();
  let deliveryFee = parseFloat(settings.delivery_fee);
  if (isNaN(deliveryFee)) deliveryFee = 5;
  const subtotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  let total = subtotal + deliveryFee;
  let appliedCoupon = null;

  if (coupon_code) {
    const now = new Date().toISOString();
    const coupon = db.prepare("SELECT * FROM coupons WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > ?) AND (usage_limit=0 OR times_used < usage_limit)").get(coupon_code.toUpperCase(), now);
    if (coupon && subtotal >= coupon.min_value) {
      const discount = coupon.discount_value > 0
        ? Math.min(coupon.discount_value, subtotal)
        : subtotal * (coupon.discount_percent / 100);
      total = subtotal + deliveryFee - discount;
      if (total < 0) total = 0;
      appliedCoupon = coupon_code.toUpperCase();
      db.prepare('UPDATE coupons SET times_used = times_used + 1 WHERE id=?').run(coupon.id);
    }
  }

  let customerId = null;
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(customer.phone);
  if (existing) {
    customerId = existing.id;
    db.prepare('UPDATE customers SET name=?, address=?, neighborhood=? WHERE id=?')
      .run(customer.name, customer.address || '', customer.neighborhood || '', customerId);
  } else {
    const r = db.prepare('INSERT INTO customers (name, phone, address, neighborhood) VALUES (?, ?, ?, ?)')
      .run(customer.name, customer.phone, customer.address || '', customer.neighborhood || '');
    customerId = r.lastInsertRowid;
  }

  const r = db.prepare(`
    INSERT INTO orders (customer_id, customer_name, customer_phone, customer_address, customer_neighborhood, items_json, total, delivery_fee, payment_method, payment_method_detail, amount_paid, change_due, notes, coupon_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customerId, customer.name, customer.phone, customer.address || '', customer.neighborhood || '',
    JSON.stringify(items), total, deliveryFee, payment_method || 'dinheiro',
    payment_method_detail || '', amount_paid || null, change_due || 0, notes || '', appliedCoupon || '');

  io.to('admin').emit('new-order', { id: r.lastInsertRowid, customer_name: customer.name, total });

  res.json({ id: r.lastInsertRowid, total, delivery_fee: deliveryFee });
});

app.post('/api/orders/clear-history', adminAuth, (req, res) => {
  const r = db.prepare("DELETE FROM orders WHERE status IN ('finalizado','cancelado','entregue')").run();
  res.json({ deleted: r.changes });
});

app.get('/api/flash-status', (req, res) => {
  const s = getSettings();
  const endTime = s.flash_end_time;
  if (!endTime) return res.json({ active: false, remaining: 0 });
  const now = Date.now();
  const end = new Date(endTime).getTime();
  const remaining = Math.max(0, end - now);
  res.json({ active: remaining > 0, remaining, end_time: endTime, now: new Date().toISOString() });
});

app.get('/api/orders', adminAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT * FROM orders ORDER BY created_at DESC LIMIT 100
  `).all();
  for (const o of orders) { o.items = JSON.parse(o.items_json); }
  res.json(orders);
});

app.get('/api/orders/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });
  o.items = JSON.parse(o.items_json);
  res.json(o);
});

app.put('/api/orders/:id/status', adminAuth, (req, res) => {
  const { status } = req.body;
  const current = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (status === 'preparando' && current.payment_method === 'pix' && current.payment_status !== 'pago') {
    return res.status(400).json({ error: 'Aguardando confirmação do pagamento Pix' });
  }
  db.prepare('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (order) order.items = JSON.parse(order.items_json);
  io.to('admin').emit('order-status', order);
  io.to(`order-${order.id}`).emit('status-update', order);
  res.json(order);
});

app.put('/api/orders/:id/confirm', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status !== 'entregue') return res.status(400).json({ error: 'Pedido ainda não foi marcado como entregue' });
  db.prepare("UPDATE orders SET status='finalizado', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);

  // Loyalty: increment count for this customer
  const phone = updated.customer_phone;
  if (phone) {
    let loyalty = db.prepare('SELECT * FROM loyalty WHERE phone=?').get(phone);
    if (!loyalty) {
      db.prepare('INSERT INTO loyalty (phone, count) VALUES (?, 1)').run(phone);
      loyalty = { count: 1 };
    } else {
      db.prepare('UPDATE loyalty SET count = count + 1 WHERE phone=?').run(phone);
      loyalty.count += 1;
    }
    const settings = getSettings();
    const loyaltyGoal = parseInt(settings.loyalty_goal) || 10;
    if (loyalty.count >= loyaltyGoal) {
      const rewardType = settings.loyalty_reward_type || 'fixed';
      const rewardValue = parseFloat(settings.loyalty_reward_value || settings.loyalty_reward || 20);
      const rewardDesc = settings.loyalty_reward_desc || (rewardType === 'percent' ? `${rewardValue}% de desconto no próximo pedido` : `R$ ${rewardValue.toFixed(2).replace('.',',')} de desconto`);
      const rewardImage = settings.loyalty_reward_image || '';
      const couponCode = `FIDEL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      if (rewardType === 'percent') {
        db.prepare(`INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit)
          VALUES (?, ?, 0, ?, ?, 1, 1)`).run(couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
      } else {
        db.prepare(`INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit)
          VALUES (?, 0, ?, ?, ?, 1, 1)`).run(couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
      }
      db.prepare('INSERT INTO loyalty_rewards (phone, coupon_code) VALUES (?, ?)').run(phone, couponCode);
      db.prepare('UPDATE loyalty SET count = 0 WHERE phone=?').run(phone);
      updated.loyaltyReward = { code: couponCode, value: rewardValue, type: rewardType, desc: rewardDesc, image_url: rewardImage };
      updated.loyaltyGoal = loyaltyGoal;
    }
    updated.loyaltyCount = loyalty.count >= loyaltyGoal ? 0 : loyalty.count;
  }

  io.to('admin').emit('order-status', updated);
  io.to(`order-${updated.id}`).emit('status-update', updated);
  res.json(updated);
});

app.post('/api/loyalty/force-reward', adminAuth, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório' });
  const settings = getSettings();
  const rewardType = settings.loyalty_reward_type || 'fixed';
  const rewardValue = parseFloat(settings.loyalty_reward_value || settings.loyalty_reward || 20);
  const rewardDesc = settings.loyalty_reward_desc || (rewardType === 'percent' ? `${rewardValue}% de desconto no próximo pedido` : `R$ ${rewardValue.toFixed(2).replace('.',',')} de desconto`);
  const rewardImage = settings.loyalty_reward_image || '';
  const couponCode = `FIDEL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  if (rewardType === 'percent') {
    db.prepare(`INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit)
      VALUES (?, ?, 0, ?, ?, 1, 1)`).run(couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
  } else {
    db.prepare(`INSERT INTO coupons (code, discount_percent, discount_value, description, image_url, active, usage_limit)
      VALUES (?, 0, ?, ?, ?, 1, 1)`).run(couponCode, rewardValue, `🎉 ${rewardDesc}`, rewardImage);
  }
  db.prepare('INSERT INTO loyalty_rewards (phone, coupon_code) VALUES (?, ?)').run(phone, couponCode);
  db.prepare('UPDATE loyalty SET count = 0 WHERE phone=?').run(phone);
  res.json({ code: couponCode, value: rewardValue, type: rewardType });
});

app.post('/api/orders/:id/cancel-customer', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status !== 'novo') return res.status(400).json({ error: 'Só pode cancelar pedidos novos' });
  db.prepare("UPDATE orders SET status='cancelado', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);
  io.to('admin').emit('order-status', updated);
  io.to(`order-${updated.id}`).emit('status-update', updated);
  res.json(updated);
});

// Mercado Pago helpers
const MP_API = 'https://api.mercadopago.com/v1';
function mpIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
}
async function mpFetch(path, opts = {}) {
  const s = getSettings();
  if (!s.mp_access_token) throw new Error('MP não configurado');
  const r = await fetch(`${MP_API}${path}`, {
    ...opts,
    headers: {
      'Content-Type':'application/json',
      'Authorization':`Bearer ${s.mp_access_token}`,
      'X-Idempotency-Key': mpIdempotencyKey(),
      ...opts.headers
    }
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Erro MP');
  return d;
}

async function getOrCreateCustomer(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new Error('Usuário não encontrado');
  if (user.mp_customer_id) return user.mp_customer_id;
  const s = getSettings();
  const ts = Date.now();
  const r = await fetch('https://api.mercadopago.com/v1/customers', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${s.mp_access_token}`},
    body: JSON.stringify({ email: `user_${userId}_${ts}@acaineiro.local` })
  });
  const d = await r.json();
  if (!r.ok) {
    if (d.cause?.[0]?.description === 'the customer already exist') {
      const r2 = await fetch('https://api.mercadopago.com/v1/customers', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${s.mp_access_token}`},
        body: JSON.stringify({ email: `user_${userId}_${ts}_${Math.random().toString(36).slice(2,6)}@acaineiro.local` })
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.message || 'Erro ao criar customer');
      db.prepare('UPDATE users SET mp_customer_id=? WHERE id=?').run(d2.id, userId);
      return d2.id;
    }
    throw new Error(d.message || 'Erro ao criar customer');
  }
  db.prepare('UPDATE users SET mp_customer_id=? WHERE id=?').run(d.id, userId);
  return d.id;
}

async function associateMpCard(customerId, cardToken) {
  const s = getSettings();
  const r = await fetch(`https://api.mercadopago.com/v1/customers/${customerId}/cards`, {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${s.mp_access_token}`},
    body: JSON.stringify({ token: cardToken })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Erro ao associar cartão');
  return d;
}

async function deleteMpCard(customerId, cardId) {
  const s = getSettings();
  await fetch(`https://api.mercadopago.com/v1/customers/${customerId}/cards/${cardId}`, {
    method:'DELETE', headers:{'Authorization':`Bearer ${s.mp_access_token}`}
  });
}

// Pix payment
app.post('/api/orders/:id/pay', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  try {
    if (order.payment_method === 'pix') {
      const payment = await mpFetch('/payments', { method:'POST', body: JSON.stringify({
        transaction_amount: order.total,
        description: `Pedido #${order.id} - ${order.customer_name}`,
        payment_method_id: 'pix',
        payer: { email: `pedido${order.id}@acaineiro.com` }
      })});
      const data = payment.point_of_interaction.transaction_data;
      db.prepare('UPDATE orders SET mp_payment_id=?, payment_data_json=? WHERE id=?')
        .run(String(payment.id), JSON.stringify(data), order.id);
      res.json({ method:'pix', qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, ticket_url: data.ticket_url, mp_payment_id: payment.id });
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/orders/:id/payment-status', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order || !order.mp_payment_id) return res.json({ status:'pending' });
  try {
    const p = await mpFetch(`/payments/${order.mp_payment_id}`);
    res.json({ status: p.status, status_detail: p.status_detail });
  } catch (e) { res.json({ status:'pending' }); }
});

app.post('/api/orders/:id/confirm-payment', (req, res) => {
  const current = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (current.payment_status === 'pago') return res.json({ ok: true });
  db.prepare("UPDATE orders SET payment_status='pago', status='preparando', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (order) {
    order.items = JSON.parse(order.items_json);
    io.to(`order-${order.id}`).emit('payment-confirmed', order);
    io.to(`order-${order.id}`).emit('status-update', order);
    io.to('admin').emit('order-status', order);
    io.to('admin').emit('payment-confirmed-admin', { id: order.id });
  }
  res.json({ ok: true });
});

app.post('/api/orders/:id/refund', adminAuth, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (!order.mp_payment_id) return res.status(400).json({ error: 'Nenhum pagamento MP para reembolsar' });
  try {
    const refund = await mpFetch(`/payments/${order.mp_payment_id}/refunds`, { method:'POST' });
    db.prepare("UPDATE orders SET payment_status='reembolsado' WHERE id=?").run(req.params.id);
    const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (updated) { updated.items = JSON.parse(updated.items_json); io.to(`order-${updated.id}`).emit('payment-refunded', updated); }
    io.to('admin').emit('order-status', updated);
    res.json({ ok: true, refund_id: refund.id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders/:id/cancel-with-refund', adminAuth, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'Já cancelado' });

  let needsRefund = false;
  if (order.mp_payment_id) {
    try {
      const mp = await mpFetch(`/payments/${order.mp_payment_id}`);
      if (mp.status === 'approved') needsRefund = true;
    } catch (e) {}
  }

  if (needsRefund) {
    try {
      await mpFetch(`/payments/${order.mp_payment_id}/refunds`, { method:'POST' });
      db.prepare("UPDATE orders SET status='cancelado', payment_status='reembolsado', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
    } catch (e) {
      return res.status(400).json({ error: 'Erro ao reembolsar: ' + e.message });
    }
  } else {
    db.prepare("UPDATE orders SET status='cancelado', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (updated) updated.items = JSON.parse(updated.items_json);
  io.to('admin').emit('order-status', updated);
  io.to(`order-${updated.id}`).emit('status-update', updated);
  res.json(updated);
});

app.get('/api/customers', adminAuth, (req, res) => {
  const customers = db.prepare(`
    SELECT c.*, COUNT(o.id) as total_orders, SUM(o.total) as total_spent
    FROM customers c LEFT JOIN orders o ON c.id = o.customer_id
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all();
  res.json(customers);
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) return res.json({ token: ADMIN_PASSWORD });
  res.status(401).json({ error: 'Senha incorreta' });
});

app.get('/orders-count', adminAuth, (req, res) => {
  const counts = {
    novos: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='novo'").get().c,
    preparando: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='preparando'").get().c,
    enviado: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='entregando'").get().c,
    finalizados: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='finalizado'").get().c,
    total: db.prepare("SELECT COUNT(*) as c FROM orders").get().c,
  };
  res.json(counts);
});

app.get('/api/sales-report', adminAuth, (req, res) => {
  const period = req.query.period || 'total';
  let dateFilter = '';
  if (period === 'hoje') {
    dateFilter = "AND date(created_at, 'localtime') = date('now','localtime')";
  } else if (period === 'semana') {
    dateFilter = "AND datetime(created_at, 'localtime') >= datetime('now','-7 days','localtime')";
  } else if (period === 'mes') {
    dateFilter = "AND datetime(created_at, 'localtime') >= datetime('now','-30 days','localtime')";
  }
  const rows = db.prepare(`
    SELECT payment_method, payment_method_detail, COUNT(*) as count, SUM(total) as total
    FROM orders WHERE status NOT IN ('novo','cancelado') ${dateFilter}
    GROUP BY payment_method, payment_method_detail ORDER BY payment_method, payment_method_detail
  `).all();
  const totals = { pix: { count: 0, total: 0 }, dinheiro: { count: 0, total: 0 }, cartao: { count: 0, total: 0, credito: { count: 0, total: 0 }, debito: { count: 0, total: 0 } } };
  let geral = { count: 0, total: 0 };
  for (const r of rows) {
    const t = parseFloat(r.total) || 0;
    if (totals[r.payment_method]) {
      totals[r.payment_method].count += r.count;
      totals[r.payment_method].total += t;
      if (r.payment_method === 'cartao' && r.payment_method_detail) {
        if (totals.cartao[r.payment_method_detail]) {
          totals.cartao[r.payment_method_detail].count += r.count;
          totals.cartao[r.payment_method_detail].total += t;
        }
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
function userAuth(req, res, next) {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const user = db.prepare('SELECT id, name, phone, cpf, cep, address_number, address, neighborhood FROM users WHERE auth_token=?').get(token);
  if (!user) return res.status(401).json({ error: 'Token inválido' });
  req.user = user;
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { name, phone, password, cpf, cep, address_number, address, neighborhood } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'Nome, telefone e senha obrigatórios' });
  const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (existing) return res.status(400).json({ error: 'Telefone já cadastrado' });
  const hash = hashPassword(password);
  const token = crypto.randomBytes(32).toString('hex');
  const r = db.prepare('INSERT INTO users (name, phone, cpf, cep, address_number, password_hash, address, neighborhood, auth_token) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(name, phone, cpf || '', cep || '', address_number || '', hash, address || '', neighborhood || '', token);
  res.json({ id: r.lastInsertRowid, name, phone, cpf: cpf || '', cep: cep || '', address_number: address_number || '', auth_token: token });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Telefone e senha obrigatórios' });
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Telefone ou senha incorretos' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET auth_token=? WHERE id=?').run(token, user.id);
  res.json({ id: user.id, name: user.name, phone: user.phone, cpf: user.cpf || '', cep: user.cep || '', address_number: user.address_number || '', address: user.address, neighborhood: user.neighborhood, auth_token: token });
});

app.get('/api/auth/me', userAuth, (req, res) => {
  res.json(req.user);
});

app.put('/api/auth/profile', userAuth, (req, res) => {
  const { name, address, neighborhood, cpf, cep, address_number } = req.body;
  db.prepare('UPDATE users SET name=?, address=?, neighborhood=?, cpf=?, cep=?, address_number=? WHERE id=?').run(name || req.user.name, address || '', neighborhood || '', cpf || '', cep || '', address_number || '', req.user.id);
  res.json({ ok: true });
});

function calcCaixa(register) {
  if (!register) return null;
  const salesTotal = db.prepare(
    "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE created_at >= ? AND status != 'cancelado'"
  ).get(register.opened_at).s;
  const trocoTotal = db.prepare(
    "SELECT COALESCE(SUM(change_due),0) as s FROM orders WHERE created_at >= ? AND payment_method='dinheiro' AND status != 'cancelado'"
  ).get(register.opened_at).s;
  const movements = db.prepare(
    'SELECT type, COALESCE(SUM(amount),0) as total FROM cash_movements WHERE register_id=? GROUP BY type'
  ).all(register.id);
  const entradas = movements.find(m => m.type === 'entrada')?.total || 0;
  const saidas = movements.find(m => m.type === 'saida')?.total || 0;
  const netSales = salesTotal - trocoTotal;
  const expected = register.initial_balance + salesTotal + entradas - saidas;
  return { ...register, sales_total: salesTotal, troco_total: trocoTotal, net_sales: netSales, mov_entradas: entradas, mov_saidas: saidas, expected_balance: expected };
}

app.get('/api/admin/caixa', adminAuth, (req, res) => {
  const r = db.prepare("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();
  res.json(calcCaixa(r));
});

app.post('/api/admin/caixa/abrir', adminAuth, (req, res) => {
  const { initial_balance, notes } = req.body;
  const aberto = db.prepare("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();
  if (aberto) return res.status(400).json({ error: 'Já existe um caixa aberto. Feche-o primeiro.' });
  const today = new Date().toISOString().split('T')[0];
  const r = db.prepare('INSERT INTO cash_register (date, initial_balance, notes) VALUES (?, ?, ?)')
    .run(today, initial_balance || 0, notes || '');
  const reg = db.prepare('SELECT * FROM cash_register WHERE id=?').get(r.lastInsertRowid);
  res.json(calcCaixa(reg));
});

app.post('/api/admin/caixa/fechar', adminAuth, (req, res) => {
  const { actual_balance, notes } = req.body;
  const r = db.prepare("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();
  if (!r) return res.status(400).json({ error: 'Nenhum caixa aberto' });
  const calc = calcCaixa(r);
  db.prepare(
    'UPDATE cash_register SET closed_at=CURRENT_TIMESTAMP, status=?, expected_balance=?, actual_balance=?, difference=?, notes=? WHERE id=?'
  ).run('fechado', calc.expected_balance, actual_balance || 0,
    (actual_balance || 0) - calc.expected_balance, notes || '', r.id);
  const reg = db.prepare('SELECT * FROM cash_register WHERE id=?').get(r.id);
  res.json(calcCaixa(reg));
});

app.post('/api/admin/caixa/movimento', adminAuth, (req, res) => {
  const { type, amount, description, reference } = req.body;
  const r = db.prepare("SELECT * FROM cash_register WHERE status='aberto' ORDER BY id DESC LIMIT 1").get();
  if (!r) return res.status(400).json({ error: 'Caixa não está aberto' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
  db.prepare('INSERT INTO cash_movements (register_id, type, amount, description, reference) VALUES (?, ?, ?, ?, ?)')
    .run(r.id, type, amount, description || '', reference || '');
  res.json({ ok: true });
});

app.get('/api/admin/caixa/historico', adminAuth, (req, res) => {
  const registers = db.prepare('SELECT * FROM cash_register ORDER BY id DESC LIMIT 60').all();
  res.json(registers.map(r => calcCaixa(r)));
});

app.get('/api/admin/caixa/movimentos/:registerId', adminAuth, (req, res) => {
  const movs = db.prepare('SELECT * FROM cash_movements WHERE register_id=? ORDER BY id').all(req.params.registerId);
  res.json(movs);
});

app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), { maxAge: 0, etag: false, lastModified: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
let upload;
if (useCloudinary) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: { folder: 'acaineiro', allowed_formats: ['jpg','jpeg','png','gif','webp'], public_id: () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}` }
  });
  upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
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
app.post('/api/upload', adminAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  const url = useCloudinary ? req.file.path : `/uploads/${req.file.filename}`;
  res.json({ url });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     🟣 AÇAINEIRO - SISTEMA COMPLETO   ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║                                      ║');
  console.log(`║  📱 App: http://localhost:${PORT}/app    ║`);
  console.log(`║  🖥️  Painel: http://localhost:${PORT}/admin ║`);
  console.log(`║  🔑 Senha: ${ADMIN_PASSWORD}                ║`);
  console.log('║                                      ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  Para testar no CELULAR:             ║');
  console.log('║  1. Descubra seu IP: ipconfig        ║');
  console.log('║  2. No celular: http://SEUIP:3000    ║');
  console.log('║                                      ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  Pressione Ctrl+C para parar         ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
