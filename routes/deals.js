// routes/deals.js - Tech Deals & Scraper API
const express = require('express');
const { getDB } = require('../database/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { runScraperForRequest, checkAndTriggerScrapers } = require('../modules/scraper');
const { getAuctionStats } = require('../modules/auction');

const router = express.Router();

// ─── TECH DEALS ──────────────────────────────────────────────────

// GET /api/deals - كل عروض الـ AI والكلاود
router.get('/', (req, res) => {
  const db = getDB();
  const { category, featured } = req.query;
  let where = ['is_active = 1'];
  const params = [];
  if (category) { where.push('category = ?'); params.push(category); }
  if (featured) { where.push('is_featured = 1'); }

  const deals = db.prepare(`
    SELECT * FROM tech_deals WHERE ${where.join(' AND ')}
    ORDER BY is_featured DESC, discount_pct DESC, created_at DESC
  `).all(...params);
  res.json(deals);
});

// POST /api/deals - إضافة صفقة جديدة (أدمن)
router.post('/', verifyToken, requireRole('admin'), (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const db = getDB();
  const { title, description, provider, category, original_price, deal_price,
          discount_pct, currency, affiliate_url, logo_url, is_featured, expires_at } = req.body;

  if (!title || !provider || !category || !affiliate_url) {
    return res.status(400).json({ error: 'الحقول المطلوبة: العنوان، المزود، التصنيف، رابط العمولة' });
  }

  const result = db.prepare(`
    INSERT INTO tech_deals (uuid, title, description, provider, category, original_price,
      deal_price, discount_pct, currency, affiliate_url, logo_url, is_featured, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), title, description, provider, category, original_price, deal_price,
         discount_pct, currency || 'USD', affiliate_url, logo_url, is_featured ? 1 : 0, expires_at || null);

  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

// DELETE /api/deals/:id
router.delete('/:id', verifyToken, requireRole('admin'), (req, res) => {
  getDB().prepare('UPDATE tech_deals SET is_active=0 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── SCRAPER ─────────────────────────────────────────────────────

// POST /api/deals/scraper/run/:requestId - تشغيل يدوي
router.post('/scraper/run/:requestId', verifyToken, requireRole('admin'), async (req, res) => {
  res.json({ success: true, message: 'جاري تشغيل السكريبر...' });
  runScraperForRequest(parseInt(req.params.requestId)).catch(console.error);
});

// GET /api/deals/scraper/results/:requestId - نتائج السكريبر
router.get('/scraper/results/:requestId', (req, res) => {
  const db = getDB();
  const results = db.prepare(`
    SELECT * FROM scraper_results WHERE request_id=? ORDER BY price ASC
  `).all(req.params.requestId);
  res.json(results);
});

// ─── STATS & ADMIN ────────────────────────────────────────────────

// GET /api/deals/stats/overview
router.get('/stats/overview', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const stats = getAuctionStats();
  const extraStats = {
    total_users: db.prepare("SELECT COUNT(*) as c FROM users").get().c,
    merchants: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='merchant'").get().c,
    customers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='customer'").get().c,
    scraper_triggered: db.prepare("SELECT COUNT(*) as c FROM purchase_requests WHERE scraper_triggered=1").get().c,
    total_tech_deals: db.prepare("SELECT COUNT(*) as c FROM tech_deals WHERE is_active=1").get().c,
    notifications_sent: db.prepare("SELECT COUNT(*) as c FROM notifications WHERE status='sent'").get().c,
    requests_by_region: db.prepare(`
      SELECT region, COUNT(*) as count FROM purchase_requests GROUP BY region ORDER BY count DESC LIMIT 10
    `).all(),
    requests_by_category: db.prepare(`
      SELECT category, COUNT(*) as count FROM purchase_requests GROUP BY category ORDER BY count DESC
    `).all()
  };
  res.json({ ...stats, ...extraStats });
});

// GET /api/deals/merchants/list (admin)
router.get('/merchants/list', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const merchants = db.prepare(`
    SELECT u.id, u.uuid, u.name, u.shop_name, u.email, u.phone, u.region,
           u.rating, u.is_active, u.created_at,
           COUNT(b.id) as total_bids, SUM(b.is_winner) as wins
    FROM users u LEFT JOIN bids b ON u.id = b.merchant_id
    WHERE u.role = 'merchant'
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.json(merchants);
});

module.exports = router;
