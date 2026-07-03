const express = require('express');
const https = require('https');
const { getDb, markDirty } = require('../db');
const { adminRequired } = require('./auth');
const router = express.Router();

const ICECAT_API = 'live.icecat.biz';

function icecatRequest(path, params) {
  return new Promise((resolve, reject) => {
    const username = process.env.ICECAT_USERNAME || 'openicecat-live';
    const appKey = process.env.ICECAT_APP_KEY;
    let query = `lang=EN&shopname=${encodeURIComponent(username)}&${params}&content=`;
    if (appKey) query += `&app_key=${encodeURIComponent(appKey)}`;
    const url = `/api?${query}`;
    https.get({ hostname: ICECAT_API, path: url, headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Icecat')); }
      });
    }).on('error', reject);
  });
}

function productNotFound(data) {
  return [3, 4, 16, 17].includes(data.StatusCode);
}

function extractProductInfo(data) {
  if (!data.data) return null;
  const g = data.data.GeneralInfo;
  const img = data.data.Image;
  if (!g) return null;
  return {
    icecat_id: g.IcecatId,
    name: g.Title || g.ProductName,
    brand: g.Brand,
    brand_logo: g.BrandLogo,
    brand_part_code: g.BrandPartCode,
    category: g.Category?.Name?.Value,
    gtins: g.GTIN,
    description: g.Description?.LongDesc ? g.Description.LongDesc.replace(/<[^>]+>/g, '').substring(0, 1000) : '',
    short_summary: g.SummaryDescription?.ShortSummaryDescription || '',
    long_summary: g.SummaryDescription?.LongSummaryDescription || '',
    image: img?.HighPic || img?.Pic500x500 || img?.ThumbPic,
    thumbnail: img?.ThumbPic,
    gallery: (data.data.Gallery || []).map(g => ({ pic: g.Pic, thumb: g.ThumbPic })),
    manual_pdf: g.Description?.ManualPDFURL,
    features_count: data.data.FeaturesGroups?.length || 0,
    bullet_points: g.BulletPoints?.Values || g.GeneratedBulletPoints?.Values || []
  };
}

router.get('/gtin/:ean', async (req, res) => {
  try {
    const data = await icecatRequest('params', `GTIN=${req.params.ean}`);
    if (productNotFound(data)) return res.status(404).json({ error: 'Product not found in Icecat' });
    const product = extractProductInfo(data);
    if (!product) return res.status(404).json({ error: 'Could not parse product data' });
    res.json({ success: true, data: product, raw: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/product/:id', async (req, res) => {
  try {
    const data = await icecatRequest('params', `icecat_id=${req.params.id}`);
    if (productNotFound(data)) return res.status(404).json({ error: 'Product not found in Icecat' });
    const product = extractProductInfo(data);
    if (!product) return res.status(404).json({ error: 'Could not parse product data' });
    res.json({ success: true, data: product, raw: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/lookup', async (req, res) => {
  const { brand, code } = req.query;
  if (!brand || !code) return res.status(400).json({ error: 'Brand and code required' });
  try {
    const data = await icecatRequest('params', `Brand=${encodeURIComponent(brand)}&ProductCode=${encodeURIComponent(code)}`);
    if (productNotFound(data)) return res.status(404).json({ error: 'Product not found in Icecat' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sync-gtin', adminRequired, async (req, res) => {
  const { ean } = req.body;
  if (!ean) return res.status(400).json({ error: 'EAN/GTIN required' });
  try {
    const data = await icecatRequest('params', `GTIN=${ean}`);
    if (productNotFound(data)) return res.status(404).json({ error: 'Product not found in Icecat' });

    const p = extractProductInfo(data);
    if (!p) return res.status(404).json({ error: 'No product data returned from Icecat' });

    const db = await getDb();
    const name = p.name || 'Unknown Product';
    const desc = (p.long_summary || p.short_summary || p.description || '').substring(0, 500);
    const price = req.body.price || 0;
    const icon = p.thumbnail || '📦';
    const category = (p.category || 'general').toLowerCase().replace(/\s+/g, '-');

    db.run(`INSERT OR REPLACE INTO products (name, category, icon, description, price, stock) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, category, icon, desc, price, 50]);
    markDirty();
    res.json({ success: true, message: `Imported "${name}" from Icecat`, product: { name, category, price } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
