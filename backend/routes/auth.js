const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb, markDirty } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = 'efda-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, GIF, WebP, and PDF files are allowed'));
  }
});

const router = express.Router();

function getUserByEmail(db, email) {
  const stmt = db.prepare(`SELECT id, email, phone, efda_license, role, status, created_at FROM users WHERE email = ?`);
  stmt.bind([email]);
  if (!stmt.step()) return null;
  return stmt.getAsObject();
}

function formatUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    efda_license: user.efda_license,
    role: user.role,
    status: user.status,
    created_at: user.created_at
  };
}

router.post('/signin', upload.single('efda_license'), async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email || !phone || !req.file) {
      return res.status(400).json({ error: 'Email, phone number, and EFDA license file are required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const db = await getDb();
    const existing = getUserByEmail(db, email);
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    const filename = req.file.filename;
    db.run(`INSERT INTO users (email, phone, efda_license, status) VALUES (?, ?, ?, 'pending')`, [email, phone, filename]);
    markDirty();
    const user = getUserByEmail(db, email);
    if (!user) throw new Error('Failed to create user');
    res.status(201).json({
      success: true,
      message: 'Your sign-up request has been submitted. An admin will review and approve your account.',
      user: formatUser(user)
    });
  } catch (err) {
    console.error('Sign-in error:', err);
    if (err.message && err.message.includes('Only')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/check', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const db = await getDb();
    const user = getUserByEmail(db, email);
    res.json({ exists: !!user, status: user ? user.status : null });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const db = await getDb();
    const user = getUserByEmail(db, email);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Please sign in first.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending admin approval. Please wait for an administrator to approve your account.', status: 'pending' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Your account has been rejected. Please contact support for more information.', status: 'rejected' });
    }
    res.json({
      success: true,
      user: formatUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'wubshet';
    const adminPass = process.env.ADMIN_PASSWORD || 'amanuel@123';
    if (username === adminUser && password === adminPass) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(`SELECT id, email, phone, efda_license, role, status, created_at FROM users ORDER BY created_at DESC`);
    const users = [];
    while (stmt.step()) {
      users.push(stmt.getAsObject());
    }
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users/:id/approve', async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    db.run(`UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'`, [id]);
    const modified = db.getRowsModified();
    markDirty();
    if (modified === 0) {
      return res.status(404).json({ error: 'User not found or already processed' });
    }
    res.json({ success: true, message: 'User approved' });
  } catch (err) {
    console.error('Approve user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users/:id/reject', async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    db.run(`UPDATE users SET status = 'rejected' WHERE id = ? AND status = 'pending'`, [id]);
    const modified = db.getRowsModified();
    markDirty();
    if (modified === 0) {
      return res.status(404).json({ error: 'User not found or already processed' });
    }
    res.json({ success: true, message: 'User rejected' });
  } catch (err) {
    console.error('Reject user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
