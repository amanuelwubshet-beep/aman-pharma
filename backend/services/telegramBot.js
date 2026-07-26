const TelegramBot = require('node-telegram-bot-api');

const { getDb, markDirty } = require('../db');

let bot = null;
let botStarted = false;
let channelId = null;
let parseMode = 'auto';

const CATEGORY_KEYWORDS = {
  pharma: ['tablet', 'capsule', 'syrup', 'injection', 'ointment', 'medicine', 'pharma', 'drug', 'pharmaceutical'],
  surgical: ['surgical', 'scalpel', 'forceps', 'suture', 'glove', 'mask', 'surgical'],
  equipment: ['machine', 'device', 'equipment', 'monitor', 'ecg', 'bp', 'stethoscope', 'diagnostic'],
  consumable: ['syringe', 'bandage', 'cotton', 'disposable', 'consumable', 'dressing'],
};

function parseProductFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let name = '';
  let price = null;
  let category = 'general';
  let description = '';
  let stock = 50;

  if (lines.length <= 3) {
    name = lines[0] || '';
    let priceLineIndex = -1;
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const priceMatch = line.match(/(\d[\d,.]*)\s*(birr|etb|br|ብር)/i);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(/,/g, ''));
        priceLineIndex = idx;
        break;
      }
    }
    if (!price) {
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const numMatch = line.match(/(\d[\d,.]+)/);
        if (numMatch) {
          const val = parseFloat(numMatch[1].replace(/,/g, ''));
          if (val > 0 && val < 1000000) {
            price = val;
            priceLineIndex = idx;
            break;
          }
        }
      }
    }
    description = lines.filter((l, i) => i !== 0 && i !== priceLineIndex).join(', ');
  } else {
    let i = 0;
    const labelPatterns = [
      { label: /^(name|product|item|title)\s*[:.]?\s*(.+)/i, field: 'name' },
      { label: /^(price|cost|amount)\s*[:.]?\s*(\d[\d,.]*)/i, field: 'price' },
      { label: /^(category|cat|type)\s*[:.]?\s*(.+)/i, field: 'category' },
      { label: /^(stock|qty|quantity)\s*[:.]?\s*(\d+)/i, field: 'stock' },
      { label: /^(description|desc|details|info)\s*[:.]?\s*(.+)/i, field: 'description' },
    ];

    for (const line of lines) {
      let matched = false;
      for (const pattern of labelPatterns) {
        const m = line.match(pattern.label);
        if (m) {
          matched = true;
          if (pattern.field === 'name') { name = m[2].trim(); i++; }
          else if (pattern.field === 'price') { price = parseFloat(m[2].replace(/,/g, '')); }
          else if (pattern.field === 'category') { category = m[2].trim().toLowerCase(); }
          else if (pattern.field === 'stock') { stock = parseInt(m[2]) || 50; }
          else if (pattern.field === 'description') { description = m[2].trim(); }
          break;
        }
      }
      if (!matched && !name) {
        name = line;
        i++;
      }
    }
  }

  if (!name || price === null || isNaN(price)) return null;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === cat) break;
    for (const kw of keywords) {
      if (name.toLowerCase().includes(kw) || description.toLowerCase().includes(kw)) {
        category = cat;
        break;
      }
    }
  }

  const validCategories = ['pharma', 'surgical', 'equipment', 'consumable', 'general'];
  if (!validCategories.includes(category)) category = 'general';

  return { name: name.slice(0, 200), price, category, stock, description: description.slice(0, 2000) };
}

function parseAmountFromText(text) {
  const m = text.match(/(\d[\d,.]*)\s*(birr|etb|br|ብር)/i);
  if (m) return parseFloat(m[1].replace(/,/g, ''));
  const n = text.match(/(\d[\d,.]+)/);
  if (n) {
    const v = parseFloat(n[1].replace(/,/g, ''));
    if (v > 0 && v < 1000000) return v;
  }
  return null;
}

async function handleMessage(msg) {
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  if (channelId && String(chatId) !== String(channelId)) return;

  const product = parseProductFromText(text);
  if (!product) return;

  product.source_chat_id = String(chatId);
  product.source_message_id = msg.message_id;
  product.source_text = text;

  try {
    const db = await getDb();
    db.run(`INSERT INTO pending_products (name, category, price, stock, description, source_chat_id, source_message_id, source_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.name, product.category, product.price, product.stock, product.description, product.source_chat_id, product.source_message_id, product.source_text]);
    markDirty();
    console.log(`Telegram bot: Parsed product "${product.name}" from channel message`);
  } catch (err) {
    console.error('Telegram bot: Failed to save pending product:', err.message);
  }
}

async function start(token, channel) {
  if (botStarted) return { success: true, message: 'Bot already running' };
  if (!token) return { success: false, error: 'Bot token required' };

  try {
    bot = new TelegramBot(token, { polling: true });
    channelId = channel || null;

    bot.on('message', handleMessage);
    bot.on('channel_post', handleMessage);

    const me = await bot.getMe();
    botStarted = true;
    console.log(`Telegram bot @"${me.username}" started, monitoring channel: ${channelId || 'all groups/channels'}`);
    return { success: true, message: `Bot @"${me.username}" started`, username: me.username };
  } catch (err) {
    bot = null;
    botStarted = false;
    return { success: false, error: err.message };
  }
}

function stop() {
  if (!botStarted || !bot) return { success: true, message: 'Bot not running' };
  try {
    bot.stopPolling();
    bot = null;
    botStarted = false;
    channelId = null;
    console.log('Telegram bot stopped');
    return { success: true, message: 'Bot stopped' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getStatus() {
  return {
    running: botStarted,
    channelId: channelId,
    parseMode,
  };
}

async function getPendingProducts(status = 'pending') {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM pending_products WHERE status = ? ORDER BY created_at DESC`, [status]);
  const cols = ['id', 'name', 'category', 'price', 'stock', 'description', 'source_chat_id', 'source_message_id', 'source_text', 'status', 'created_at'];
  return result[0] ? result[0].values.map(r => {
    const obj = {};
    r.forEach((v, i) => obj[cols[i]] = v);
    return obj;
  }) : [];
}

async function approveProduct(id) {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM pending_products WHERE id = ? AND status = 'pending'`, [id]);
  if (!result[0] || !result[0].values.length) return { success: false, error: 'Pending product not found' };

  const cols = ['id', 'name', 'category', 'price', 'stock', 'description', 'source_chat_id', 'source_message_id', 'source_text', 'status', 'created_at'];
  const row = result[0].values[0];
  const product = {};
  row.forEach((v, i) => product[cols[i]] = v);

  db.run(`UPDATE pending_products SET status = 'approved' WHERE id = ?`, [id]);
  db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`,
    [product.name, product.category, '📦', product.description || '', product.price, product.stock || 0]);
  markDirty();
  return { success: true, message: `Product "${product.name}" added to store` };
}

async function rejectProduct(id) {
  const db = await getDb();
  db.run(`UPDATE pending_products SET status = 'rejected' WHERE id = ? AND status = 'pending'`, [id]);
  markDirty();
  return { success: true, message: 'Product rejected' };
}

async function deleteProduct(id) {
  const db = await getDb();
  db.run(`DELETE FROM pending_products WHERE id = ?`, [id]);
  markDirty();
  return { success: true, message: 'Deleted' };
}

module.exports = {
  start,
  stop,
  getStatus,
  getPendingProducts,
  approveProduct,
  rejectProduct,
  deleteProduct,
  parseProductFromText,
};
