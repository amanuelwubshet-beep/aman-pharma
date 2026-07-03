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
