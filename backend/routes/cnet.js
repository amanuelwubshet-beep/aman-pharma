const express = require('express');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { getDb, markDirty } = require('../db');
const cnetService = require('../services/cnet');

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') return cb(new Error('Only CSV files allowed'));
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

router.post('/import-csv', cnetLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fs = require('fs');
    const csvText = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });

    if (!records.length) return res.status(400).json({ error: 'CSV file is empty' });

    const db = await getDb();
    let imported = 0;

    for (const row of records) {
      const name = row.name || row.Name || row.product_name || row.ProductName || row['Product Name'] || '';
      const category = row.category || row.Category || row.type || row.Type || 'general';
      const icon = row.icon || row.Icon || row.image || row.Image || '📦';
      const description = row.description || row.Description || row.desc || row['Short Description'] || '';
      const price = parseFloat(row.price || row.Price || row.unit_price || row.UnitPrice || 0);
      const stock = parseInt(row.stock || row.Stock || row.quantity || row.Quantity || 0);
      const sku = row.sku || row.SKU || row.code || row.Code || '';

      if (!name) continue;

      const checkStmt = db.prepare(`SELECT id FROM products WHERE name=?`);
      checkStmt.bind([name]);
      const exists = checkStmt.step();
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
    res.json({ success: true, message: `Imported ${imported} products from CSV` });
  } catch (err) {
    res.status(400).json({ error: 'Import failed' });
  }
});

module.exports = router;
