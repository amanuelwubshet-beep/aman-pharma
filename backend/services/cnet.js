const https = require('https');
const http = require('http');

const CONFIG = {
  apiUrl: process.env.CNET_API_URL || '',
  username: process.env.CNET_USERNAME || '',
  password: process.env.CNET_PASSWORD || '',
  companyId: process.env.CNET_COMPANY_ID || ''
};

let authToken = null;

function isConfigured() {
  return !!(CONFIG.apiUrl && CONFIG.username && CONFIG.password);
}

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(CONFIG.apiUrl + path);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    };

    const req = mod.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData) }); }
        catch (e) { resolve({ status: res.statusCode, data: responseData }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function authenticate() {
  if (!isConfigured()) return false;
  try {
    const res = await apiRequest('/api/login', 'POST', {
      username: CONFIG.username,
      password: CONFIG.password
    });
    if (res.status === 200 && res.data.token) {
      authToken = res.data.token;
      return true;
    }
    if (res.status === 200 && res.data.access_token) {
      authToken = res.data.access_token;
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function fetchProducts() {
  if (!authToken && !(await authenticate())) {
    throw new Error('CNET authentication failed');
  }
  const res = await apiRequest('/api/products');
  if (res.status !== 200) throw new Error('CNET fetch products failed: ' + res.status);
  const items = Array.isArray(res.data) ? res.data : (res.data.products || res.data.data || []);
  return items.map(item => ({
    name: item.name || item.product_name || item.ProductName || '',
    category: item.category || item.Category || (item.group_name || 'general'),
    icon: item.image || item.Image || item.thumbnail || '📦',
    description: item.description || item.Description || item.ShortDescription || '',
    price: parseFloat(item.price || item.Price || item.unit_price || item.UnitPrice || 0),
    stock: parseInt(item.stock || item.Stock || item.quantity || item.Quantity || 0),
    sku: item.sku || item.SKU || item.code || item.Code || '',
    barcode: item.barcode || item.Barcode || item.ean || item.EAN || ''
  }));
}

async function syncToStore(db, markDirty) {
  const products = await fetchProducts();
  let imported = 0;
  for (const p of products) {
    const checkStmt = db.prepare(`SELECT id FROM products WHERE name=?`);
    checkStmt.bind([p.name]);
    const exists = checkStmt.step();
    if (exists) {
      db.run(`UPDATE products SET price=?, stock=?, description=?, icon=? WHERE name=?`,
        [p.price, p.stock, p.description, p.icon, p.name]);
    } else {
      db.run(`INSERT INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`,
        [p.name, p.category, p.icon, p.description, p.price, p.stock]);
    }
    imported++;
  }
  markDirty();
  return { imported, total: products.length };
}

module.exports = { isConfigured, fetchProducts, syncToStore, authenticate };
