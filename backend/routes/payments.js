const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb, markDirty } = require('../db');
const telebirrService = require('../services/telebirr');
const { adminRequired } = require('./auth');
const { isValidEthiopianPhone } = require('../lib/validate');

const router = express.Router();

const processingRefs = new Set();

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  message: { error: 'Too many payment requests. Try again later.' },
});

router.post('/telebirr/initiate', paymentLimiter, async (req, res) => {
  try {
    const { order_ref, amount, phone } = req.body;
    if (!order_ref || amount == null || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!isValidEthiopianPhone(phone)) {
      return res.status(400).json({ error: 'Valid Ethiopian phone number required (e.g. +251 9X XXX XXXX)' });
    }

    const db = await getDb();
    const paymentRef = telebirrService.generateRef();

    db.run(`INSERT INTO payments (method, amount, phone, ref, status) VALUES (?, ?, ?, ?, 'pending')`,
      ['telebirr', amount, phone, paymentRef]);
    markDirty();

    const result = await telebirrService.initiatePayment({
      orderRef: paymentRef,
      amount,
      phone,
      customerName: req.body.customer_name || 'Store Customer'
    });

    if (result.success) {
      if (result.mode === 'mock') {
        db.run(`UPDATE payments SET status='pending' WHERE ref=?`, [paymentRef]);
        markDirty();
      }
      res.json({
        success: true,
        ref: result.ref,
        mode: result.mode || 'mock',
        toPayUrl: result.toPayUrl,
        message: result.message
      });
    } else {
      db.run(`UPDATE payments SET status='failed' WHERE ref=?`, [paymentRef]);
      markDirty();
      res.status(502).json({ success: false, error: 'Payment gateway error' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/telebirr/callback', async (req, res) => {
  try {
    const db = await getDb();
    const body = req.body;

    if (!telebirrService.verifyNotification(body)) {
      console.warn('Invalid Telebirr callback signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const outTradeNo = body.outTradeNo || body.merch_order_id;
    const tradeNo = body.tradeNo || body.transactionNo || body.prepay_id;
    const tradeStatus = body.tradeStatus !== undefined ? body.tradeStatus : body.status;

    if (outTradeNo) {
      if (processingRefs.has(outTradeNo)) return res.json({ message: 'Already processing' });
      processingRefs.add(outTradeNo);
      setTimeout(() => processingRefs.delete(outTradeNo), 10000);
      const status = (tradeStatus === 1 || tradeStatus === 0 || tradeStatus === 'success' || tradeStatus === 'completed')
        ? 'completed' : 'failed';

      const payCheck = db.prepare(`SELECT status FROM payments WHERE ref=?`);
      payCheck.bind([outTradeNo]);
      let existingStatus = null;
      if (payCheck.step()) existingStatus = payCheck.getAsObject().status;
      if (existingStatus === 'completed') {
        return res.json({ message: 'Already processed' });
      }

      db.run(`UPDATE payments SET status=?, tb_transaction_id=? WHERE ref=?`,
        [status, tradeNo || '', outTradeNo]);

      if (status === 'completed') {
        const payStmt = db.prepare(`SELECT amount FROM payments WHERE ref=?`);
        payStmt.bind([outTradeNo]);
        if (payStmt.step()) {
          const pay = payStmt.getAsObject();
          const commissionAmount = Math.round(pay.amount * 0.01 * 100) / 100;
          const commissionPhone = process.env.COMMISSION_PHONE || '251960909494';
          db.run(`INSERT INTO commissions (payment_ref, total_amount, commission_rate, commission_amount, commission_phone, status) VALUES (?, ?, 0.01, ?, ?, 'pending')`,
            [outTradeNo, pay.amount, commissionAmount, commissionPhone]);
        }
      }
      markDirty();

      const orderStmt = db.prepare(`SELECT order_id FROM payments WHERE ref=?`);
      orderStmt.bind([outTradeNo]);
      if (orderStmt.step()) {
        const row = orderStmt.getAsObject();
        if (row.order_id) {
          db.run(`UPDATE orders SET status='paid', payment_ref=? WHERE id=?`,
            [tradeNo, row.order_id]);
          markDirty();
        }
      }
    }

    res.json({ message: 'Callback received' });
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:ref/status', async (req, res) => {
  try {
    const db = await getDb();
    const result = await telebirrService.checkPaymentStatus(req.params.ref, db);
    if (!result) return res.status(404).json({ error: 'Payment not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/telebirr/query-order', adminRequired, async (req, res) => {
  try {
    const { fabricToken, prepayId, merchOrderId } = req.body;
    if (!fabricToken || (!prepayId && !merchOrderId)) {
      return res.status(400).json({ error: 'fabricToken and prepayId or merchOrderId required' });
    }
    const result = await telebirrService.queryOrder(fabricToken, prepayId, merchOrderId);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Payment gateway error' });
  }
});

router.post('/telebirr/refund', adminRequired, async (req, res) => {
  try {
    const { fabricToken, refundAmount, paymentOrderId, merchOrderId, refundReason } = req.body;
    if (!fabricToken || !refundAmount || (!paymentOrderId && !merchOrderId)) {
      return res.status(400).json({ error: 'fabricToken, refundAmount, and paymentOrderId or merchOrderId required' });
    }
    const result = await telebirrService.refundOrder(fabricToken, refundAmount, paymentOrderId, merchOrderId, refundReason);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Payment gateway error' });
  }
});

router.get('/commissions', adminRequired, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(`SELECT * FROM commissions ORDER BY created_at DESC`);
    const commissions = result[0] ? result[0].values.map(r => ({
      id: r[0], payment_ref: r[1], total_amount: r[2],
      commission_rate: r[3], commission_amount: r[4],
      commission_phone: r[5], status: r[6], created_at: r[7]
    })) : [];
    res.json(commissions);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
