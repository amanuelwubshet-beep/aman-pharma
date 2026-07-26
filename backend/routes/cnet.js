const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { getDb, markDirty } = require('../db');
const cnetService = require('../services/cnet');

const CSV_TEMP_DIR = path.join(os.tmpdir(), 'aman-pharma-csv');
if (!fs.existsSync(CSV_TEMP_DIR)) fs.mkdirSync(CSV_TEMP_DIR, { recursive: true });

function cleanupFile(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

const upload = multer({
  dest: CSV_TEMP_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') return cb(new Error('Only .csv files are allowed'));
    if (file.mimetype && file.mimetype !== 'text/csv' && file.mimetype !== 'application/vnd.ms-excel' && file.mimetype !== 'application/octet-stream') {
      return cb(new Error('Invalid file type. Please upload a CSV file'));
    }
    cb(null, true);
  }
});
const router = express.Router();

const cnetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many import/sync requests' },
});

router.post('/sync', cnetLimiter, async (req, res) => {
  try {
    if (!cnetService.isConfigured()) {
      return res.status(400).json({ error: 'CNET not configured. Set CNET_API_URL, CNET_USERNAME, CNET_PASSWORD in .env' });
    }
    const db = await getDb();
    const result = await cnetService.syncToStore(db, markDirty);
    res.json({ success: true, message: `Imported ${result.imported}/${result.total} products from CNET`, ...result });
  } catch (err) {
    res.status(502).json({ error: 'CNET sync failed' });
  }
});

router.get('/status', async (req, res) => {
  res.json({ configured: cnetService.isConfigured() });
});

router.post('/import-csv', cnetLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      cleanupFile(req.file && req.file.path);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 5 MB'
        : err.message || 'File upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Please select a CSV file' });
    next();
  });
}, async (req, res) => {
  let tempPath = req.file && req.file.path;
  try {
    let csvText = fs.readFileSync(tempPath, 'utf-8');
    cleanupFile(tempPath);
    tempPath = null;

    csvText = csvText.replace(/^\uFEFF/, '');

    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });

    if (!records.length) {
      return res.status(400).json({ error: 'CSV file contains no data rows' });
    }

    const db = await getDb();
    let imported = 0;
    let skipped = 0;
    const skipReasons = [];

    const CATEGORY_MAP = {
      'pharmaceutical': 'pharma', 'pharmaceuticals': 'pharma', 'medicine': 'pharma', 'medicines': 'pharma',
      'drug': 'pharma', 'drugs': 'pharma', 'tablet': 'pharma', 'tablets': 'pharma', 'capsule': 'pharma',
      'capsules': 'pharma', 'injection': 'pharma', 'injections': 'pharma', 'syrup': 'pharma', 'syrups': 'pharma',
      'ointment': 'pharma', 'ointments': 'pharma', 'pharma': 'pharma',
      'surgical': 'surgical', 'surgery': 'surgical', 'instrument': 'surgical', 'instruments': 'surgical',
      'glove': 'surgical', 'gloves': 'surgical', 'mask': 'surgical', 'masks': 'surgical', 'suture': 'surgical',
      'sutures': 'surgical', 'scalpel': 'surgical', 'forceps': 'surgical',
      'equipment': 'equipment', 'device': 'equipment', 'devices': 'equipment', 'machine': 'equipment',
      'machines': 'equipment', 'monitor': 'equipment', 'monitors': 'equipment', 'ecg': 'equipment',
      'diagnostic': 'equipment', 'apparatus': 'equipment',
      'consumable': 'consumable', 'consumables': 'consumable', 'disposable': 'consumable',
      'disposables': 'consumable', 'syringe': 'consumable', 'syringes': 'consumable', 'bandage': 'consumable',
      'bandages': 'consumable', 'cotton': 'consumable', 'dressing': 'consumable', 'dressings': 'consumable',
    };

    function getCol(row, ...keys) {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== '') return String(row[key]).trim();
      }
      const lowerKeys = keys.map(k => k.toLowerCase());
      for (const [col, val] of Object.entries(row)) {
        if (val !== '' && val !== undefined && lowerKeys.includes(col.toLowerCase())) return String(val).trim();
      }
      return '';
    }

    for (const row of records) {
      const name = getCol(row, 'name', 'Name', 'product_name', 'ProductName', 'Product Name', 'Item Name');
      let category = (getCol(row, 'category', 'Category', 'type', 'Type') || 'general').toLowerCase();
      const icon = getCol(row, 'icon', 'Icon', 'image', 'Image', 'Image URL') || '\uD83D\uDCE6';
      const description = getCol(row, 'description', 'Description', 'desc', 'Short Description', 'Long Description');
      const price = parseFloat(getCol(row, 'price', 'Price', 'unit_price', 'UnitPrice', 'Unit Price') || '0');
      const stock = parseInt(getCol(row, 'stock', 'Stock', 'quantity', 'Quantity', 'Current Stock') || '0', 10);

      category = CATEGORY_MAP[category] || category;

      if (!name) { skipped++; skipReasons.push('missing name'); continue; }
      if (isNaN(price) || price < 0 || !isFinite(price)) { skipped++; skipReasons.push(`invalid price for "${name}"`); continue; }
      if (isNaN(stock) || stock < 0) { skipped++; skipReasons.push(`invalid stock for "${name}"`); continue; }

      const checkStmt = db.prepare(`SELECT id FROM products WHERE name=?`);
      checkStmt.bind([name]);
      const exists = checkStmt.step();
      checkStmt.free();
      if (exists) {
        db.run(`UPDATE products SET price=?, stock=?, category=?, description=?, icon=? WHERE name=?`,
          [price, stock, category, description, icon, name]);
      } else {
        db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`,
          [name, category, icon, description, price, stock]);
      }
      imported++;
    }
    markDirty();
    const msg = `Imported ${imported} product${imported !== 1 ? 's' : ''} from CSV` + (skipped ? ` (${skipped} row${skipped !== 1 ? 's' : ''} skipped)` : '');
    res.json({ success: true, message: msg, imported, skipped, skipReasons: skipped ? skipReasons.slice(0, 10) : undefined });
  } catch (err) {
    cleanupFile(tempPath);
    console.error('CSV import error:', err);
    const msg = err.message && err.message.includes('columns')
      ? 'CSV format error: rows have inconsistent columns. Ensure all rows have the same number of fields'
      : err.message || 'Import failed';
    res.status(400).json({ error: msg });
  }
});

module.exports = router;
