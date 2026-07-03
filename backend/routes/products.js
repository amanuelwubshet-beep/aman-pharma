const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb, markDirty } = require('../db');
const authMiddleware = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const productStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'product-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const productUpload = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, GIF, and WebP images are allowed'));
  }
});

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(`SELECT * FROM products ORDER BY id`);
    const cols = ['id','name','category','icon','description','price','stock','created_at'];
    const products = result[0] ? result[0].values.map(r => {
      const obj = {};
      r.forEach((v, i) => obj[cols[i]] = v);
      return obj;
    }) : [];
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', productUpload.single('image'), async (req, res) => {
  try {
    const { name, category, description } = req.body;
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock) || 0;
    if (!name || typeof name !== 'string' || name.length > 200) {
      return res.status(400).json({ error: 'Name must be a string with max 200 characters' });
    }
    if (description && description.length > 2000) {
      return res.status(400).json({ error: 'Description max 2000 characters' });
    }
    if (isNaN(price) || price < 0 || !isFinite(price)) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }
    const icon = req.file ? '/uploads/' + req.file.filename : '📦';
    const db = await getDb();
    db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, category, icon, description || '', price, stock]);
    markDirty();
    const idResult = db.exec(`SELECT last_insert_rowid()`);
    const id = idResult[0].values[0][0];
    res.json({ message: 'Product created', id, icon });
  } catch (err) {
    console.error('Create product error:', err);
    if (err.message && err.message.includes('Only')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authMiddleware, productUpload.single('image'), async (req, res) => {
  try {
    const { name, category, description } = req.body;
    const price = req.body.price != null ? parseFloat(req.body.price) : null;
    const stock = req.body.stock != null ? parseInt(req.body.stock) : null;
    if (name && (typeof name !== 'string' || name.length > 200)) {
      return res.status(400).json({ error: 'Name must be a string with max 200 characters' });
    }
    if (description && description.length > 2000) {
      return res.status(400).json({ error: 'Description max 2000 characters' });
    }
    if (price != null && (isNaN(price) || price < 0 || !isFinite(price))) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }
    const icon = req.file ? '/uploads/' + req.file.filename : undefined;
    const db = await getDb();
    if (icon) {
      db.run(`UPDATE products SET name=?, category=?, icon=?, description=?, price=?, stock=? WHERE id=?`,
        [name, category, icon, description, price, stock, req.params.id]);
    } else {
      db.run(`UPDATE products SET name=?, category=?, description=?, price=?, stock=? WHERE id=?`,
        [name, category, description, price, stock, req.params.id]);
    }
    markDirty();
    res.json({ message: 'Product updated' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    db.run(`DELETE FROM products WHERE id=?`, [req.params.id]);
    markDirty();
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
