require('dotenv').config({ path: __dirname + '/.env' });
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'store.db');

async function initDb() {
  console.log('=== Aman Pharma Database Initialization ===\n');

  if (fs.existsSync(DB_PATH)) {
    console.log('Removing existing database...');
    fs.unlinkSync(DB_PATH);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`PRAGMA foreign_keys=ON`);

  console.log('Creating schema...');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    efda_license TEXT NOT NULL,
    role TEXT DEFAULT 'customer',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    icon TEXT DEFAULT '📦',
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'telebirr',
    payment_ref TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    phone TEXT,
    ref TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    tb_transaction_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_ref TEXT NOT NULL,
    total_amount REAL NOT NULL,
    commission_rate REAL DEFAULT 0.01,
    commission_amount REAL NOT NULL,
    commission_phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('Seeding sample user...');
  db.run(`INSERT INTO users (email, phone, efda_license, status) VALUES (?, ?, ?, 'approved')`, ['admin@amanpharma.com', '+251911309608', 'seed-efda-placeholder.jpg']);
  console.log('  Email: admin@amanpharma.com');

  console.log('\nSeeding products...');
  const seedProducts = [
    ['Amoxicillin 500mg', 'pharma', '💊', 'Broad-spectrum antibiotic, 100 capsules per bottle.', 450, 200],
    ['Paracetamol 500mg', 'pharma', '💊', 'Antipyretic & analgesic, 100 tablets per pack.', 180, 500],
    ['Azithromycin 250mg', 'pharma', '💊', 'Macrolide antibiotic, 6 tablets per strip.', 320, 300],
    ['Insulin Injection (40IU)', 'pharma', '💉', 'Rapid-acting insulin, 10ml vial.', 850, 100],
    ['Surgical Blade Set #10', 'surgical', '🔪', 'Sterile carbon steel blades, box of 100.', 1200, 80],
    ['Scalpel Handle #3', 'surgical', '🔧', 'Reusable stainless steel, standard size.', 650, 60],
    ['Artery Forceps', 'surgical', '🔧', 'Straight Halsted mosquito forceps, 5".', 890, 75],
    ['Surgical Gloves (Box)', 'surgical', '🧤', 'Latex powder-free sterile, 50 pairs.', 750, 150],
    ['Stethoscope', 'equipment', '🩺', 'Dual-head acoustic, adult size.', 2500, 40],
    ['Digital BP Monitor', 'equipment', '📟', 'Automatic upper-arm monitor, LCD display.', 4200, 30],
    ['Pulse Oximeter', 'equipment', '🖐️', 'Fingertip SpO2 & pulse rate monitor.', 1800, 50],
    ['Examination Couch', 'equipment', '🛏️', 'Adjustable vinyl-covered examination table.', 15500, 15],
    ['Cotton Roll 500g', 'consumable', '🧻', 'Absorbent surgical cotton roll.', 250, 400],
    ['Gauze Swabs (Pack)', 'consumable', '🩹', 'Sterile 4x4 gauze, pack of 100.', 180, 600],
    ['Surgical Tape', 'consumable', '📎', 'Hypoallergenic micropore tape, 5cm x 5m.', 120, 500],
    ['IV Cannula (24G)', 'consumable', '💉', 'Sterile IV cannula, box of 50.', 950, 200],
  ];

  for (const p of seedProducts) {
    db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`, p);
  }
  console.log(`  ${seedProducts.length} products seeded`);

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  db.close();

  console.log('\n=== Database initialized successfully ===');
  console.log('File:', DB_PATH);
  console.log('Size:', (buffer.length / 1024).toFixed(1), 'KB');
}

initDb().catch(err => {
  console.error('Init failed:', err);
  process.exit(1);
});
