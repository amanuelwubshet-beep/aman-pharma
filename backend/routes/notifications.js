const express = require('express');
const smsService = require('../services/sms');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.post('/sms/order-notification', authMiddleware, async (req, res) => {
  try {
    const { ref, customer_name, customer_phone, items, total, payment_method, status } = req.body;
    if (!ref) return res.status(400).json({ error: 'Missing order ref' });

    const order = { ref, customer_name, customer_phone, items, total, payment_method, status };
    const result = await smsService.notifyNewOrder(order);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sms/customer-receipt', authMiddleware, async (req, res) => {
  try {
    const { ref, customer_name, customer_phone, items, total, payment_method, status } = req.body;
    if (!ref) return res.status(400).json({ error: 'Missing order ref' });

    const order = { ref, customer_name, customer_phone, items, total, payment_method, status };
    const result = await smsService.sendCustomerReceipt(order);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
