const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: __dirname + '/.env' });

const { getDb, markDirty, closeDb } = require('./db');


const PORT = parseInt(process.env.PORT, 10) || 3001;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 3444;
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", "https://openapi.telebirr.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      reportUri: '/api/csp-violation',
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:3001,http://localhost:3000').split(',').map(s => s.trim()),
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
});
app.use('/api', apiLimiter);

const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many sign-in attempts' },
});
app.use('/api/auth/signin', signinLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/icecat', require('./routes/icecat'));
app.use('/api/cnet', require('./routes/cnet'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/contact', require('./routes/contact'));

app.post('/api/csp-violation', (req, res) => {
  console.warn('CSP Violation:', req.body ? JSON.stringify(req.body) : '(empty body)');
  res.status(204).end();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

let forceLogoutTimestamp = null;

app.post('/api/auth/logout-all', async (_req, res) => {
  forceLogoutTimestamp = Date.now();
  console.log('Force logout all users at', new Date(forceLogoutTimestamp).toISOString());
  try {
    const db = await getDb();
    db.run(`DELETE FROM users`);
    markDirty();
    console.log('All users deleted from database');
    res.json({ success: true, timestamp: forceLogoutTimestamp, deleted: true });
  } catch (err) {
    console.error('Failed to delete users:', err);
    res.json({ success: true, timestamp: forceLogoutTimestamp, deleted: false });
  }
});

app.get('/api/auth/logout-check', (_req, res) => {
  res.json({ timestamp: forceLogoutTimestamp });
});

const publicRoot = path.join(__dirname, '..');
const blockedExtensions = ['.env', '.pem', '.db', '.json', '.lock', '.gitignore', '.md'];
const blockedPaths = ['node_modules', 'package.json', 'package-lock.json', 'start.sh', 'deploy-pi.sh', 'composer.json', 'composer.lock', '.git', 'telebirr-private.pem'];
app.use((req, res, next) => {
  const reqPath = decodeURIComponent(req.path).toLowerCase();
  if (blockedExtensions.some(b => reqPath.includes(b)) || blockedPaths.some(b => reqPath.includes(b)) || reqPath.startsWith('/backend/') || reqPath.startsWith('/cluster/') || reqPath.startsWith('/node_modules/') || reqPath.startsWith('/.')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
app.use(express.static(publicRoot));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});



async function start() {
  await getDb();

  if (HTTPS_ENABLED) {
    try {
      const sslOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || './ssl/key.pem'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || './ssl/cert.pem'),
      };
      https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
        console.log(`Aman Pharma backend running on https://0.0.0.0:${HTTPS_PORT}`);
      });
      http.createServer((req, res) => {
        res.writeHead(301, { Location: `https://localhost:${HTTPS_PORT}${req.url}` });
        res.end();
      }).listen(PORT, () => {
        console.log(`HTTP→HTTPS redirect on http://0.0.0.0:${PORT}`);
      });
    } catch (err) {
      console.error('HTTPS setup failed, falling back to HTTP:', err.message);
      const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Aman Pharma backend running on http://0.0.0.0:${PORT}`);
      });
      attachShutdown(server);
    }
  } else {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Aman Pharma backend running on http://0.0.0.0:${PORT}`);
    });
    attachShutdown(server);
  }
}

function attachShutdown(server) {
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => closeDb());
  });
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    server.close(() => closeDb());
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
  });
}

module.exports = app;
