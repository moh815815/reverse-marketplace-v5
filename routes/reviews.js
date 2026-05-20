// routes/reviews.js - Reviews & Ratings System
const express = require('express');
const { getDB } = require('../database/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/reviews - زبون يقيّم تاجر بعد إتمام الصفقة
router.post('/', verifyToken, requireRole('customer', 'admin'), (req, res) => {
  const { merchant_id, bid_id, rating, comment } = req.body;

  if (!merchant_id || !rating) {
    return res.status(400).json({ error: 'يرجى تحديد التاجر والتقييم' });
  }
  if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
  }

  const db = getDB();

  // التحقق أن الزبون اشترى فعلاً من هذا التاجر
  if (bid_id) {
    const bid = db.prepare(`
      SELECT b.id FROM bids b
      JOIN purchase_requests pr ON b.request_id = pr.id
      WHERE b.id = ? AND b.merchant_id = ? AND pr.customer_id = ? AND b.status = 'accepted'
    `).get(bid_id, merchant_id, req.user.id);
    if (!bid) return res.status(403).json({ error: 'لا يمكنك تقييم تاجر لم تُتم صفقة معه' });
  }

  // هل قيّم من قبل على نفس البيد؟
  if (bid_id) {
    const existing = db.prepare('SELECT id FROM reviews WHERE reviewer_id=? AND bid_id=?').get(req.user.id, bid_id);
    if (existing) return res.status(400).json({ error: 'لقد قيّمت هذه الصفقة مسبقاً' });
  }

  // إضافة التقييم
  db.prepare(`
    INSERT INTO reviews (reviewer_id, merchant_id, bid_id, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, merchant_id, bid_id || null, Number(rating), comment?.trim() || null);

  // تحديث متوسط تقييم التاجر
  const avg = db.prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE merchant_id = ?
  `).get(merchant_id);

  db.prepare(`
    UPDATE users SET rating = ROUND(?, 1), rating_count = ? WHERE id = ?
  `).run(avg.avg, avg.cnt, merchant_id);

  res.status(201).json({ success: true, message: 'شكراً! تم إرسال تقييمك بنجاح' });
});

// GET /api/reviews/merchant/:id - تقييمات تاجر معين
router.get('/merchant/:id', (req, res) => {
  const db = getDB();

  const merchant = db.prepare('SELECT id, name, shop_name, rating, rating_count FROM users WHERE id=? AND role="merchant"').get(req.params.id);
  if (!merchant) return res.status(404).json({ error: 'التاجر غير موجود' });

  const reviews = db.prepare(`
    SELECT r.rating, r.comment, r.created_at,
           u.name as reviewer_name
    FROM reviews r
    JOIN users u ON r.reviewer_id = u.id
    WHERE r.merchant_id = ?
    ORDER BY r.created_at DESC
    LIMIT 20
  `).all(req.params.id);

  // توزيع التقييمات
  const distribution = db.prepare(`
    SELECT rating, COUNT(*) as count FROM reviews
    WHERE merchant_id = ? GROUP BY rating ORDER BY rating DESC
  `).all(req.params.id);

  res.json({ merchant, reviews, distribution });
});

// GET /api/reviews/can-review/:bidId - هل يمكن للزبون التقييم؟
router.get('/can-review/:bidId', verifyToken, (req, res) => {
  const db = getDB();
  const bid = db.prepare(`
    SELECT b.id, b.merchant_id, b.status, pr.customer_id,
           u.name as merchant_name, u.shop_name
    FROM bids b
    JOIN purchase_requests pr ON b.request_id = pr.id
    JOIN users u ON b.merchant_id = u.id
    WHERE b.id = ?
  `).get(req.params.bidId);

  if (!bid || bid.customer_id !== req.user.id || bid.status !== 'accepted') {
    return res.json({ canReview: false });
  }

  const alreadyReviewed = db.prepare('SELECT id FROM reviews WHERE reviewer_id=? AND bid_id=?').get(req.user.id, bid.id);
  res.json({ canReview: !alreadyReviewed, merchant: { id: bid.merchant_id, name: bid.merchant_name, shop_name: bid.shop_name } });
});

module.exports = router;
