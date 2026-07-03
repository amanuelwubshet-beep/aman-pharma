#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'store.db');
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');
const MAX_BACKUPS = 30;

function backup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error('Database not found at', DB_PATH);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `store-${timestamp}.db`);

  fs.copyFileSync(DB_PATH, backupPath);
  console.log('Backup created:', backupPath);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('store-') && f.endsWith('.db'))
    .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  while (files.length > MAX_BACKUPS) {
    const oldest = files.pop();
    fs.unlinkSync(oldest.path);
    console.log('Removed old backup:', oldest.name);
  }

  console.log(`Backup complete. ${Math.min(files.length, MAX_BACKUPS)} backups retained.`);
}

backup();
