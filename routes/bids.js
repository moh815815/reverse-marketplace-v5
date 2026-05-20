// routes/bids.js - Bids API
const express = require('express');
const { getDB } = require('../database/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { submitBid, acceptBid, getBidsForRequest } = require('../modules/auction');

const router = express.Router();

// POST /api/bids - تاجر يقدم عرض
router.post('/', verifyToken, requireRole('merchant', 'admin'), async (req, res) => {
  const { request_id, price, description, includes, delivery_days } = req.body;
  if (!request_id || !price || !description) {
    return res.status(400).json({ error: 'يرجى إدخال رقم الطلب والسعر والوصف' });
  }
  if (isNaN(price) || price <= 0) {
    return res.status(400).json({ error: 'السعر يجب أن يكون رقماً موجباً' });
  }

  const result = await submitBid(parseInt(request_id), req.user.id, {
    price: parseFloat(price), description, includes, delivery_days
  });

  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/bids/:id/accept - زبون يقبل عرض
router.post('/:id/accept', verifyToken, requireRole('customer', 'admin'), async (req, res) => {
  const result = await acceptBid(parseInt(req.params.id), req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// GET /api/bids/request/:requestId - كل عروض طلب
router.get('/request/:requestId', (req, res) => {
  const bids = getBidsForRequest(parseInt(req.params.requestId), req.query.sort || 'price');
  res.json(bids);
});

// GET /api/bids/my - عروضي كتاجر
router.get('/my', verifyToken, requireRole('merchant'), (req, res) => {
  const db = getDB();
  const bids = db.prepare(`
    SELECT b.*, pr.title as request_title, pr.status as request_status,
           pr.uuid as request_uuid, pr.budget_max, pr.region
    FROM bids b JOIN purchase_requests pr ON b.request_id = pr.id
    WHERE b.merchant_id = ?
    ORDER BY b.created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(bids);
});

// DELETE /api/bids/:id - حذف عرض (صاحبه فقط إذا لم يُقبل)
router.delete('/:id', verifyToken, (req, res) => {
  const db = getDB();
  const bid = db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'العرض غير موجود' });
  if (bid.merchant_id !== req.user.id) return res.status(403).json({ error: 'ليس لديك صلاحية' });
  if (bid.status !== 'pending') return res.status(400).json({ error: 'لا يمكن حذف عرض مقبول أو مرفوض' });

  db.prepare("UPDATE bids SET status='withdrawn' WHERE id=?").run(req.params.id);
  db.prepare("UPDATE purchase_requests SET bids_count = MAX(0, bids_count-1) WHERE id=?").run(bid.request_id);
  res.json({ success: true });
});

module.exports = router;
