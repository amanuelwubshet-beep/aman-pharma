const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'store.db');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`PRAGMA foreign_keys=ON`);

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

  db.run(`CREATE TABLE IF NOT EXISTS pending_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    source_chat_id TEXT,
    source_message_id INTEGER,
    source_text TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const productCount = db.exec(`SELECT COUNT(*) FROM products`);
  const count = productCount[0] && productCount[0].values[0] ? productCount[0].values[0][0] : 0;
  if (count === 0) {
    const seedProducts = [
      ['Amoxicillin 500mg', 'pharma', '\uD83D\uDC8A', 'Broad-spectrum antibiotic, 100 capsules per bottle.', 450, 200],
      ['Paracetamol 500mg', 'pharma', '\uD83D\uDC8A', 'Antipyretic & analgesic, 100 tablets per pack.', 180, 500],
      ['Azithromycin 250mg', 'pharma', '\uD83D\uDC8A', 'Macrolide antibiotic, 6 tablets per strip.', 320, 300],
      ['Insulin Injection (40IU)', 'pharma', '\uD83D\uDC89', 'Rapid-acting insulin, 10ml vial.', 850, 100],
      ['Surgical Blade Set #10', 'surgical', '\uD83D\uDD2A', 'Sterile carbon steel blades, box of 100.', 1200, 80],
      ['Scalpel Handle #3', 'surgical', '\uD83D\uDD27', 'Reusable stainless steel, standard size.', 650, 60],
      ['Artery Forceps', 'surgical', '\uD83D\uDD27', 'Straight Halsted mosquito forceps, 5".', 890, 75],
      ['Surgical Gloves (Box)', 'surgical', '\uD83E\uDDE4', 'Latex powder-free sterile, 50 pairs.', 750, 150],
      ['Stethoscope', 'equipment', '\uD83E\uDE7A', 'Dual-head acoustic, adult size.', 2500, 40],
      ['Digital BP Monitor', 'equipment', '\uD83D\uDCDF', 'Automatic upper-arm monitor, LCD display.', 4200, 30],
      ['Pulse Oximeter', 'equipment', '\uD83D\uDD90\uFE0F', 'Fingertip SpO2 & pulse rate monitor.', 1800, 50],
      ['Examination Couch', 'equipment', '\uD83D\uDECF\uFE0F', 'Adjustable vinyl-covered examination table.', 15500, 15],
      ['Cotton Roll 500g', 'consumable', '\uD83E\uDDFB', 'Absorbent surgical cotton roll.', 250, 400],
      ['Gauze Swabs (Pack)', 'consumable', '\uD83E\uDE79', 'Sterile 4x4 gauze, pack of 100.', 180, 600],
      ['Surgical Tape', 'consumable', '\uD83D\uDCCE', 'Hypoallergenic micropore tape, 5cm x 5m.', 120, 500],
      ['IV Cannula (24G)', 'consumable', '\uD83D\uDC89', 'Sterile IV cannula, box of 50.', 950, 200],
    ];
    for (const p of seedProducts) {
      db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`, p);
    }
    console.log('Seeded ' + seedProducts.length + ' default products');
  }

  saveImmediate();
  return db;
}

function saveImmediate() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('DB save error:', err.message);
  }
}

function markDirty() {
  saveImmediate();
}

function closeDb() {
  saveImmediate();
  if (db) { db.close(); db = null; }
}

module.exports = { getDb, markDirty, closeDb };
