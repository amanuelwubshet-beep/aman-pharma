const express = require('express');
const rateLimit = require('express-rate-limit');
const emailService = require('../services/email');

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 1000, max: 3,
  message: { error: 'Too many contact submissions. Try again later.' },
});

router.post('/', contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message required' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const result = await emailService.sendContactEmail({ name, email, phone, message });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
