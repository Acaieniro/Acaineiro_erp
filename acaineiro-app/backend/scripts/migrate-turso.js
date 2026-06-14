require('dotenv').config();
const { createClient } = require('@libsql/client');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL || 'libsql://acaineiroerp-acaieniro.aws-us-east-1.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODE0NzA3MTcsImlkIjoiMDE5ZWM3NmMtMmMwMS03ZGYyLWFmMzMtZDMyMWY0MzQzYmI1IiwicmlkIjoiZWNiZDE4MzMtZWM5Yi00YzhhLWI1OWEtOGYxNzgxODk5MGE5In0.fw6BBIulECIJhj0bvyr3gJwiqzQNL75zsj0JHdEuuL-e_DqXRhjfg5bULyo_LRrwU1vCm0RAxsMJ0uk0Ore-BQ'
});

async function migrate() {
  console.log('🔄 Migrating database...');

  await turso.execute(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '📋',
    sort_order INTEGER DEFAULT 0
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS products (
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
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT DEFAULT '',
    neighborhood TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS orders (
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
    coupon_code TEXT DEFAULT '',
    payment_method_detail TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS cash_register (
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
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    register_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    reference TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (register_id) REFERENCES cash_register(id)
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    address TEXT DEFAULT '',
    neighborhood TEXT DEFAULT '',
    auth_token TEXT,
    mp_customer_id TEXT,
    asaas_customer_id TEXT,
    cpf TEXT,
    cep TEXT,
    address_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS saved_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_token TEXT NOT NULL,
    last_four TEXT NOT NULL,
    first_six TEXT NOT NULL,
    cardholder_name TEXT NOT NULL,
    expiration_month TEXT NOT NULL,
    expiration_year TEXT NOT NULL,
    brand TEXT DEFAULT '',
    mp_card_id TEXT,
    asaas_card_token TEXT,
    asaas_customer_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    button_text TEXT DEFAULT '',
    button_action TEXT DEFAULT 'menu',
    image_url TEXT DEFAULT '',
    bg_color TEXT DEFAULT '#7C3AED',
    emoji TEXT DEFAULT '',
    icon_url TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS coupons (
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
    name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL,
    old_price REAL,
    icon TEXT DEFAULT '🎯',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS combo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    combo_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS loyalty (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    count INTEGER DEFAULT 0
  )`);

  await turso.execute(`CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    coupon_code TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed default settings
  const settings = await turso.execute("SELECT COUNT(*) as c FROM settings WHERE key='store_name'");
  if (settings.rows[0].c === 0) {
    const defaultSettings = [
      ['store_name', 'Açaineiro'],
      ['store_phone', '5531975785413'],
      ['store_address', 'R. Venezuela, 68 - Contagem, MG'],
      ['delivery_fee', '5'],
      ['store_open', '13:00'],
      ['store_close', '20:30'],
      ['pix_key', ''],
      ['mp_access_token', ''],
      ['mp_public_key', ''],
      ['flash_hours', '2'],
      ['flash_minutes', '30'],
      ['flash_end_time', new Date(Date.now() + 2*3600000 + 30*60000).toISOString()],
      ['loyalty_goal', '10'],
      ['loyalty_reward', '20'],
      ['card_payment_enabled', '0']
    ];
    for (const [k, v] of defaultSettings) {
      await turso.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: [k, v] });
    }
  }

  // Seed default categories
  const cats = await turso.execute("SELECT COUNT(*) as c FROM categories");
  if (cats.rows[0].c === 0) {
    await turso.execute("INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Açaís', 'acai', '🥣', 1)");
    await turso.execute("INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Pratos', 'pratos', '🍽️', 2)");
    await turso.execute("INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Bebidas', 'bebidas', '🥤', 3)");
    await turso.execute("INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Extras', 'extras', '➕', 4)");
  }

  // Seed default banners
  const bnrs = await turso.execute("SELECT COUNT(*) as c FROM banners");
  if (bnrs.rows[0].c === 0) {
    await turso.execute("INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES ('O verdadeiro açaí mineiro', 'Ingredientes selecionados, sabor inesquecível', 'Ver Cardápio →', 'menu', '#7C3AED', 1)");
    await turso.execute("INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES ('Promoções imperdíveis', 'Ofertas especiais por tempo limitado', 'Ver Promos →', 'promos', '#DB2777', 2)");
    await turso.execute("INSERT INTO banners (title, subtitle, button_text, button_action, bg_color, sort_order) VALUES ('Delivery rápido e fácil', 'Pediu, chegou! Entrega em Contagem', 'Pedir Agora →', 'cart', '#059669', 3)");
  }

  console.log('✅ Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
