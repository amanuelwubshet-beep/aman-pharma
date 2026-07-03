const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadPrivateKey() {
  const keyPath = process.env.TB_PRIVATE_KEY_PATH;
  if (keyPath && fs.existsSync(path.resolve(__dirname, keyPath))) {
    return fs.readFileSync(path.resolve(__dirname, keyPath), 'utf8');
  }
  return (process.env.TB_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
}

const CONFIG = {
  fabricAppId: process.env.TB_FABRIC_APP_ID || '',
  appSecret: process.env.TB_APP_SECRET || '',
  merchantId: process.env.TB_MERCHANT_ID || '',
  merchantCode: process.env.TB_MERCHANT_CODE || '',
  privateKeyPEM: loadPrivateKey(),
  publicKey: (process.env.TB_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
  baseUrl: process.env.TB_BASE_URL || 'https://openapi.telebirr.com',
  webBaseUrl: process.env.TB_WEB_BASE_URL || 'https://web.telebirr.com/wap/cashier/index',
  notifyUrl: process.env.TB_NOTIFY_URL || 'http://localhost:3001/api/payments/telebirr/callback',
  returnUrl: process.env.TB_RETURN_URL || 'http://localhost:3001/store.html?payment=done',
  payeePhone: process.env.TB_PAYEE_PHONE || '0911309608'
};

function isConfigured() {
  return !!(CONFIG.fabricAppId && CONFIG.appSecret && CONFIG.merchantId && CONFIG.merchantCode && CONFIG.privateKeyPEM);
}

function createTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

function createNonceStr() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(32);
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function createMerchantOrderId() {
  return String(Math.floor(Date.now() * 1000));
}

function createCanonicalString(obj) {
  const exclude = new Set([
    'sign', 'sign_type', 'header', 'refund_info', 'openType', 'raw_request', 'biz_content'
  ]);
  const fields = [];
  const fieldMap = {};

  for (const [key, value] of Object.entries(obj)) {
    if (exclude.has(key)) continue;
    fields.push(key);
    fieldMap[key] = String(value);
  }

  if (obj.biz_content && typeof obj.biz_content === 'object') {
    for (const [key, value] of Object.entries(obj.biz_content)) {
      if (exclude.has(key)) continue;
      fields.push(key);
      fieldMap[key] = String(value);
    }
  }

  fields.sort();
  return fields.map(k => k + '=' + fieldMap[k]).join('&');
}

function getPrivateKeyObject() {
  return crypto.createPrivateKey(CONFIG.privateKeyPEM);
}

function signWithRsaPss(data) {
  const key = getPrivateKeyObject();
  const signature = crypto.sign('sha256', Buffer.from(data), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32
  });
  return signature.toString('base64');
}

function signRequestObject(obj) {
  return signWithRsaPss(createCanonicalString(obj));
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      rejectUnauthorized: true
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telebirr API timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Step 1: Apply Fabric Token ───────────────────────────
async function applyFabricToken() {
  const url = CONFIG.baseUrl + '/payment/v1/token';
  const res = await httpsPost(url, {
    'X-APP-Key': CONFIG.fabricAppId
  }, {
    appSecret: CONFIG.appSecret
  });
  if (res.status !== 200) {
    throw new Error('Fabric token request failed');
  }
  return res.data.token;
}

// ─── Step 2: Authentication Token (for InApp/SuperApp) ───
async function requestAuthToken(fabricToken) {
  const url = CONFIG.baseUrl + '/payment/v1/auth/authToken';
  const req = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method: 'payment.authtoken',
    version: '1.0',
    biz_content: {
      access_token: '',
      trade_type: 'InApp',
      appid: CONFIG.merchantId,
      resource_type: 'OpenId'
    }
  };
  req.sign = signRequestObject(req);
  req.sign_type = 'SHA256WithRSA';

  const res = await httpsPost(url, {
    'X-APP-Key': CONFIG.fabricAppId,
    'Authorization': fabricToken
  }, req);

  if (res.status !== 200 || (res.data.code !== 0 && res.data.code !== '0' && res.data.code !== '00000')) {
    throw new Error('Auth token request failed');
  }
  return res.data.data ? res.data.data.access_token : null;
}

// ─── Step 3: Request Create Order (preOrder) ──────────────
async function createPreOrder(fabricToken, title, amount) {
  const url = CONFIG.baseUrl + '/payment/v1/merchant/preOrder';
  const req = {
    nonce_str: createNonceStr(),
    method: 'payment.preorder',
    timestamp: createTimestamp(),
    version: '1.0',
    biz_content: {
      notify_url: CONFIG.notifyUrl,
      appid: CONFIG.merchantId,
      merch_code: CONFIG.merchantCode,
      merch_order_id: createMerchantOrderId(),
      trade_type: 'Checkout',
      title: title,
      total_amount: String(Math.round(amount * 100) / 100),
      trans_currency: 'ETB',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier: CONFIG.payeePhone,
      payee_identifier_type: '01',
      payee_type: '5000',
      callback_info: 'From Aman Pharma'
    }
  };
  if (CONFIG.returnUrl) {
    req.biz_content.redirect_url = CONFIG.returnUrl;
  }
  req.sign = signRequestObject(req);
  req.sign_type = 'SHA256WithRSA';

  const res = await httpsPost(url, {
    'X-APP-Key': CONFIG.fabricAppId,
    'Authorization': fabricToken
  }, req);

  if (res.status !== 200 || (res.data.code !== '0' && res.data.code !== '00000' && res.data.code !== 0)) {
    throw new Error('PreOrder request failed');
  }
  if (!res.data.biz_content || !res.data.biz_content.prepay_id) {
    throw new Error('Invalid response from payment gateway');
  }
  return res.data.biz_content.prepay_id;
}

// ─── Step 4: Build Checkout URL (Start Pay Order) ─────────
function buildCheckoutUrl(prepayId) {
  const map = {
    appid: CONFIG.merchantId,
    merch_code: CONFIG.merchantCode,
    nonce_str: createNonceStr(),
    prepay_id: prepayId,
    timestamp: createTimestamp()
  };
  const sign = signRequestObject(map);
  const parts = [
    'appid=' + map.appid,
    'merch_code=' + map.merch_code,
    'nonce_str=' + map.nonce_str,
    'prepay_id=' + map.prepay_id,
    'timestamp=' + map.timestamp,
    'sign=' + encodeURIComponent(sign),
    'sign_type=SHA256WithRSA',
    'version=1.0',
    'trade_type=Checkout'
  ];
  return CONFIG.webBaseUrl + '?' + parts.join('&');
}

// ─── Step 6: Query Order ──────────────────────────────────
async function queryOrder(fabricToken, prepayId, merchOrderId) {
  const url = CONFIG.baseUrl + '/payment/v1/merchant/queryOrder';
  const req = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method: 'payment.queryorder',
    version: '1.0',
    biz_content: {
      appid: CONFIG.merchantId,
      merch_code: CONFIG.merchantCode
    }
  };
  if (prepayId) req.biz_content.prepay_id = prepayId;
  if (merchOrderId) req.biz_content.merch_order_id = merchOrderId;

  req.sign = signRequestObject(req);
  req.sign_type = 'SHA256WithRSA';

  const res = await httpsPost(url, {
    'X-APP-Key': CONFIG.fabricAppId,
    'Authorization': fabricToken
  }, req);

  if (res.status !== 200) {
    throw new Error('Query order request failed');
  }
  return res.data;
}

// ─── Step 8: Refund Order ─────────────────────────────────
async function refundOrder(fabricToken, refundAmount, paymentOrderId, merchOrderId, refundReason) {
  const url = CONFIG.baseUrl + '/payment/v1/merchant/refund';
  const refundRequestNo = createMerchantOrderId();
  const req = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method: 'payment.refund',
    version: '1.0',
    biz_content: {
      appid: CONFIG.merchantId,
      merch_code: CONFIG.merchantCode,
      refund_amount: String(Math.round(refundAmount * 100) / 100),
      refund_request_no: refundRequestNo
    }
  };
  if (paymentOrderId) req.biz_content.payment_order_id = paymentOrderId;
  if (merchOrderId) req.biz_content.merch_order_id = merchOrderId;
  if (refundReason) req.biz_content.refund_reason = refundReason;

  req.sign = signRequestObject(req);
  req.sign_type = 'SHA256WithRSA';

  const res = await httpsPost(url, {
    'X-APP-Key': CONFIG.fabricAppId,
    'Authorization': fabricToken
  }, req);

  if (res.status !== 200) {
    throw new Error('Refund request failed');
  }
  return res.data;
}

// ─── Notify (callback verification) ────────────────────────
function verifyNotification(notificationData) {
  try {
    const sign = notificationData.sign;
    if (!sign) return false;

    const verifyObj = { ...notificationData };
    delete verifyObj.sign;
    delete verifyObj.sign_type;

    const canonical = createCanonicalString(verifyObj);
    const signature = Buffer.from(sign, 'base64');

    const key = crypto.createPublicKey(CONFIG.publicKey);
    return crypto.verify('sha256', Buffer.from(canonical), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32
    }, signature);
  } catch (err) {
    return false;
  }
}

// ─── H5 Get Access Token (step 7 - for H5 web page token) ─
async function getH5AccessToken(fabricToken) {
  return requestAuthToken(fabricToken);
}

// ─── High-level: Full payment flow ─────────────────────────
function generateRef() {
  return 'TB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

async function initiatePayment({ orderRef, amount, phone, customerName }) {
  if (!isConfigured()) {
    return {
      success: true,
      ref: generateRef(),
      toPayUrl: null,
      mode: 'mock',
      message: 'Payment request sent. Check your phone to confirm via Telebirr PIN.'
    };
  }

  try {
    const fabricToken = await applyFabricToken();
    const title = 'Aman Pharma - ' + (customerName || 'Order');
    const prepayId = await createPreOrder(fabricToken, title, amount);
    const toPayUrl = buildCheckoutUrl(prepayId);

    return {
      success: true,
      ref: orderRef || prepayId,
      toPayUrl,
      mode: 'live',
      message: 'Redirecting to Telebirr...'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Telebirr API error'
    };
  }
}

async function checkPaymentStatus(ref, db) {
  if (!isConfigured()) {
    const stmt = db.prepare(`SELECT status, tb_transaction_id, amount FROM payments WHERE ref=?`);
    stmt.bind([ref]);
    if (!stmt.step()) return null;
    return stmt.getAsObject();
  }
  try {
    const stmt = db.prepare(`SELECT * FROM payments WHERE ref=?`);
    stmt.bind([ref]);
    if (!stmt.step()) return null;
    return stmt.getAsObject();
  } catch (err) {
    return null;
  }
}

module.exports = {
  isConfigured,
  initiatePayment,
  checkPaymentStatus,
  verifyNotification,
  generateRef,
  applyFabricToken,
  requestAuthToken,
  createPreOrder,
  buildCheckoutUrl,
  queryOrder,
  refundOrder,
  getH5AccessToken,
  signRequestObject,
  createCanonicalString
};
