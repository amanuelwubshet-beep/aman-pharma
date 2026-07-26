const express = require('express');
const { adminRequired } = require('./auth');
const telegramBot = require('../services/telegramBot');

const router = express.Router();

router.post('/start', adminRequired, async (req, res) => {
  const { token, channelId } = req.body;
  const result = await telegramBot.start(token, channelId);
  if (result.success) return res.json(result);
  res.status(400).json(result);
});

router.post('/stop', adminRequired, async (_req, res) => {
  res.json(telegramBot.stop());
});

router.get('/status', (_req, res) => {
  res.json(telegramBot.getStatus());
});

router.get('/pending', adminRequired, async (_req, res) => {
  try {
    const products = await telegramBot.getPendingProducts('pending');
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', adminRequired, async (_req, res) => {
  try {
    const approved = await telegramBot.getPendingProducts('approved');
    const rejected = await telegramBot.getPendingProducts('rejected');
    res.json({ approved, rejected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/approve/:id', adminRequired, async (req, res) => {
  try {
    const result = await telegramBot.approveProduct(parseInt(req.params.id));
    if (result.success) return res.json(result);
    res.status(400).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reject/:id', adminRequired, async (req, res) => {
  try {
    res.json(await telegramBot.rejectProduct(parseInt(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', adminRequired, async (req, res) => {
  try {
    res.json(await telegramBot.deleteProduct(parseInt(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
