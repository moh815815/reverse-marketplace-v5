// routes/requests.js - Purchase Requests API
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../database/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { notifyMerchantsNewRequest } = require('../modules/telegram');
const { runScraperForRequest } = require('../modules/scraper');

const router = express.Router();

// POST /api/requests - زبون ينشئ طلب شراء جديد
router.post('/', verifyToken, requireRole('customer', 'admin'), async (req, res) => {
  const { title, description, category, budget_min, budget_max, region, hours = 24 } = req.body;

  if (!title || !description || !category || !budget_max || !region) {
    return res.status(400).json({ error: 'يرجى إكمال جميع الحقول المطلوبة' });
  }

  const db = getDB();
  const validRegion = db.prepare('SELECT name FROM regions WHERE name=?').get(region);
  if (!validRegion) return res.status(400).json({ error: 'المنطقة غير موجودة' });

  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const result = db.prepare(`
    INSERT INTO purchase_requests (uuid, customer_id, title, description, category, budget_min, budget_max, region, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), req.user.id, title, description, category, budget_min || null, budget_max, region, expiresAt);

  const request = db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(result.lastInsertRowid);

  // إشعار التجار في نفس المنطقة عبر Telegram
  notifyMerchantsNewRequest(request).catch(console.error);

  res.status(201).json({ success: true, request });
});

// GET /api/requests - قائمة الطلبات (مع فلترة)
router.get('/', (req, res) => {
  const db = getDB();
  const VALID_STATUSES = ['active', 'closed', 'expired', 'scraping'];
  const { region, category, page = 1, limit = 20, search } = req.query;
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'active';
  const offset = (page - 1) * limit;

  let where = ['pr.status = ?'];
  let params = [status];

  if (region)   { where.push('pr.region = ?');   params.push(region); }
  if (category) { where.push('pr.category = ?'); params.push(category); }
  if (search)   { where.push('(pr.title LIKE ? OR pr.description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const whereClause = where.join(' AND ');
  const countParams = [...params]; // نسخة للـ COUNT قبل إضافة limit/offset
  params.push(parseInt(limit), offset);

  const requests = db.prepare(`
    SELECT pr.*, u.name as customer_name,
           (SELECT MIN(price) FROM bids WHERE request_id=pr.id AND status='pending') as lowest_bid
    FROM purchase_requests pr
    JOIN users u ON pr.customer_id = u.id
    WHERE ${whereClause}
    ORDER BY pr.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM purchase_requests pr WHERE ${whereClause}
  `).get(...countParams).c;

  res.json({ requests, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

// GET /api/requests/my/list - طلباتي كزبون (يجب أن يكون قبل /:uuid)
router.get('/my/list', verifyToken, (req, res) => {
  const db = getDB();
  const requests = db.prepare(`
    SELECT pr.*,
      (SELECT MIN(price) FROM bids WHERE request_id=pr.id AND status='pending') as lowest_bid,
      (SELECT COUNT(*) FROM bids WHERE request_id=pr.id) as bids_count_live
    FROM purchase_requests pr
    WHERE pr.customer_id = ?
    ORDER BY pr.created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(requests);
});

// GET /api/requests/:uuid - تفاصيل طلب واحد
router.get('/:uuid', (req, res) => {
  const db = getDB();
  const request = db.prepare(`
    SELECT pr.*, u.name as customer_name, u.region as customer_region
    FROM purchase_requests pr
    JOIN users u ON pr.customer_id = u.id
    WHERE pr.uuid = ?
  `).get(req.params.uuid);

  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

  // جلب العروض
  const bids = db.prepare(`
    SELECT b.id, b.uuid, b.price, b.description, b.includes, b.delivery_days,
           b.status, b.is_winner, b.created_at,
           b.merchant_id,
           u.name as merchant_name, u.shop_name, u.rating as merchant_rating,
           u.rating_count, u.region as merchant_region
    FROM bids b JOIN users u ON b.merchant_id = u.id
    WHERE b.request_id = ? AND b.status IN ('pending','accepted')
    ORDER BY b.price ASC
  `).all(request.id);

  // جلب نتائج السكريبر إن وجدت
  const scraperResults = db.prepare(`
    SELECT * FROM scraper_results WHERE request_id = ? ORDER BY price ASC LIMIT 5
  `).all(request.id);

  res.json({ ...request, bids, scraperResults });
});

// DELETE /api/requests/:uuid - حذف طلب (صاحبه أو أدمن)
router.delete('/:uuid', verifyToken, (req, res) => {
  const db = getDB();
  const request = db.prepare('SELECT * FROM purchase_requests WHERE uuid=?').get(req.params.uuid);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (request.customer_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ليس لديك صلاحية' });
  }
  db.prepare("UPDATE purchase_requests SET status='deleted' WHERE uuid=?").run(req.params.uuid);
  res.json({ success: true });
});

// POST /api/requests/:uuid/trigger-scraper - تشغيل السكريبر يدوياً
router.post('/:uuid/trigger-scraper', verifyToken, async (req, res) => {
  const db = getDB();
  const request = db.prepare('SELECT * FROM purchase_requests WHERE uuid=?').get(req.params.uuid);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (request.customer_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ليس لديك صلاحية' });
  }

  res.json({ success: true, message: 'جاري تشغيل رادار العروض...' });
  runScraperForRequest(request.id).catch(console.error);
});

module.exports = router;
