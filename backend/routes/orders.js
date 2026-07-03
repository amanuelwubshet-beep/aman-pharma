const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb, markDirty } = require('../db');
const { adminRequired } = require('./auth');

const router = express.Router();

const orderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many orders. Try again later.' },
});

router.get('/', adminRequired, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(`SELECT * FROM orders ORDER BY created_at DESC`, []);
    const cols = ['id','ref','customer_name','customer_phone','items','total','status','payment_method','payment_ref','created_at'];
    const orders = result[0] ? result[0].values.map(r => {
      const obj = {};
      r.forEach((v, i) => obj[cols[i]] = v);
      obj.items = JSON.parse(obj.items);
      return obj;
    }) : [];
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', orderLimiter, async (req, res) => {
  try {
    const { customer_name, customer_phone, items, total, payment_method } = req.body;
    if (total == null || typeof total !== 'number' || total <= 0 || !Number.isFinite(total)) {
      return res.status(400).json({ error: 'Total must be a positive number' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items must be a non-empty array' });
    }
    for (const item of items) {
      if (!item.id || typeof item.id !== 'number' || item.id < 1) {
        return res.status(400).json({ error: 'Each item must have a valid numeric id' });
      }
      if (!item.qty || typeof item.qty !== 'number' || item.qty < 1 || !Number.isInteger(item.qty)) {
        return res.status(400).json({ error: 'Each item must have a valid positive integer qty' });
      }
      if (item.price == null || typeof item.price !== 'number' || item.price < 0) {
        return res.status(400).json({ error: 'Each item must have a valid non-negative price' });
      }
    }
    const db = await getDb();
    const ref = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    db.run(`INSERT INTO orders (ref, customer_name, customer_phone, items, total, payment_method) VALUES (?, ?, ?, ?, ?, ?)`,
      [ref, customer_name || '', customer_phone || '', JSON.stringify(items), total, payment_method || 'telebirr']);

    for (const item of items) {
      db.run(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock >= ?`, [item.qty, item.id, item.qty]);
    }

    markDirty();
    res.json({ message: 'Order created', ref, stock_updated: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const VALID_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

router.put('/:id/status', adminRequired, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + VALID_STATUSES.join(', ') });
    }
    const db = await getDb();
    db.run(`UPDATE orders SET status=? WHERE id=?`, [status, req.params.id]);
    markDirty();
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
