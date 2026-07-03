const nodemailer = require('nodemailer');

const CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  to: process.env.CONTACT_TO || 'wubshetbezu@gmail.com',
  from: process.env.SMTP_FROM || 'noreply@amanpharma.com'
};

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (CONFIG.user && CONFIG.pass) {
    transporter = nodemailer.createTransport({
      host: CONFIG.host,
      port: CONFIG.port,
      secure: CONFIG.secure,
      auth: { user: CONFIG.user, pass: CONFIG.pass }
    });
  }
  return transporter;
}

function esc(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

async function sendContactEmail({ name, email, phone, message }) {
  const transport = getTransporter();

  if (!transport) {
    return { success: true, mode: 'mock' };
  }

  const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    <p><strong>Phone:</strong> ${esc(phone || 'Not provided')}</p>
    <p><strong>Message:</strong></p>
    <blockquote style="background:#f5f5f5;padding:16px;border-left:4px solid #00d4aa">${esc(message)}</blockquote>
    <hr>
    <p style="color:#888">Sent from Aman Pharma Contact Form</p>
  `;

  try {
    await transport.sendMail({
      from: `"Aman Pharma Contact" <${CONFIG.from}>`,
      to: CONFIG.to,
      subject: `Contact Form: ${name} - ${email}`,
      html
    });
    return { success: true, mode: 'live' };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendContactEmail };
