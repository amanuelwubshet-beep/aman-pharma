const https = require('https');
const { isValidEthiopianPhone } = require('../lib/validate');

const CONFIG = {
  provider: process.env.SMS_PROVIDER || 'mock',
  africasTalking: {
    username: process.env.AT_USERNAME || '',
    apiKey: process.env.AT_API_KEY || '',
    from: process.env.AT_FROM || 'AMANPHARMA'
  },
  notifyPhone: process.env.SMS_NOTIFY_PHONE || '+251911309608'
};

function isConfigured() {
  return CONFIG.provider === 'africastalking'
    && CONFIG.africasTalking.username
    && CONFIG.africasTalking.apiKey;
}

function sendViaAfricasTalking(to, message) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({
      username: CONFIG.africasTalking.username,
      to: to.replace(/[^0-9]/g, ''),
      message: message,
      from: CONFIG.africasTalking.from
    }).toString();

    const options = {
      hostname: 'api.africastalking.com',
      path: '/version1/messaging',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'apiKey': CONFIG.africasTalking.apiKey,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, raw: JSON.parse(body) });
        } catch {
          resolve({ success: true, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendSms(to, message) {
  try {
    if (CONFIG.provider === 'africastalking' && isConfigured()) {
      return { success: true, provider: 'africastalking', raw: (await sendViaAfricasTalking(to, message)).raw };
    }
    return { success: true, provider: 'mock' };
  } catch (err) {
    return { success: false, provider: CONFIG.provider, error: err.message };
  }
}

function parseItems(items) {
  if (!Array.isArray(items)) {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  return (items || []).filter(i => i && typeof i.name === 'string');
}

async function notifyNewOrder(order) {
  const items = parseItems(order.items)
    .map(i => i.name + ' x' + i.qty + ' = ETB ' + (i.price * i.qty))
    .join('\n');

  const message = 'NEW ORDER - Ref: ' + order.ref + '\n'
    + 'Customer: ' + order.customer_name + '\n'
    + 'Phone: ' + order.customer_phone + '\n'
    + '---\n' + items + '\n---\n'
    + 'Total: ETB ' + order.total + '\n'
    + 'Payment: ' + order.payment_method + ' (' + (order.status || 'pending') + ')';

  return sendSms(CONFIG.notifyPhone, message);
}

async function sendCustomerReceipt(order) {
  const phone = order.customer_phone || '';
  if (!phone || !isValidEthiopianPhone(phone)) {
    return { success: false, error: 'Valid Ethiopian customer phone required' };
  }
  const items = parseItems(order.items)
    .map(i => i.name + ' x' + i.qty + ' = ETB ' + (i.price * i.qty))
    .join('\n');

  const message = 'Aman Pharma - Payment Confirmed!\n'
    + 'Ref: ' + order.ref + '\n'
    + '---\n' + items + '\n---\n'
    + 'Total: ETB ' + order.total + '\n'
    + 'Amount Paid: ETB ' + order.total + '\n\n'
    + 'Thank you for your purchase!\n'
    + 'Aman Pharma - Hawassa, Ethiopia';

  return sendSms(phone, message);
}

module.exports = { sendSms, notifyNewOrder, sendCustomerReceipt, isConfigured };
