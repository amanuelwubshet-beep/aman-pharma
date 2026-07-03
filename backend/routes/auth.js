const express = require('express');
const crypto = require('crypto');
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

const adminSessions = new Map();
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createAdminSession() {
  const token = generateToken();
  adminSessions.set(token, { created: Date.now() });
  return token;
}

function validateAdminSession(token) {
  if (!token || !adminSessions.has(token)) return false;
  const session = adminSessions.get(token);
  if (Date.now() - session.created > SESSION_EXPIRY_MS) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

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

function adminRequired(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!validateAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized. Admin login required.' });
  }
  next();
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
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.length > 100 || password.length > 200) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminUser || !adminPass) {
      return res.status(500).json({ error: 'Admin credentials not configured' });
    }
    const encodedUser = new TextEncoder().encode(adminUser);
    const encodedPass = new TextEncoder().encode(adminPass);
    const encodedInputUser = new TextEncoder().encode(username);
    const encodedInputPass = new TextEncoder().encode(password);
    const userMatch = encodedUser.length === encodedInputUser.length && crypto.timingSafeEqual(encodedUser, encodedInputUser);
    const passMatch = encodedPass.length === encodedInputPass.length && crypto.timingSafeEqual(encodedPass, encodedInputPass);
    if (userMatch && passMatch) {
      const token = createAdminSession();
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin-verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (validateAdminSession(token)) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

router.post('/admin-logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ success: true });
});

router.get('/users', adminRequired, async (req, res) => {
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

router.post('/users/:id/approve', adminRequired, async (req, res) => {
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

router.post('/users/:id/reject', adminRequired, async (req, res) => {
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

module.exports = { router, adminRequired };
