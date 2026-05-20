// routes/profile.js - Profile management & contact exchange
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../database/db');
const { verifyToken } = require('../middleware/auth');
const { validateLengths } = require('../middleware/sanitize');

const router = express.Router();

// GET /api/profile - بيانات الملف الشخصي
router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const user = db.prepare(`
    SELECT id, uuid, name, email, phone, role, region, shop_name,
           rating, rating_count, telegram_chat_id, is_active, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json(user);
});

// PUT /api/profile - تعديل البيانات الشخصية
router.put('/', verifyToken,
  validateLengths({ name: 100, shop_name: 100, phone: 20, telegram_chat_id: 50 }),
  async (req, res) => {
    const { name, phone, region, shop_name, telegram_chat_id } = req.body;
    const db = getDB();

    if (!name?.trim()) return res.status(400).json({ error: 'الاسم مطلوب' });

    // التحقق من المنطقة
    if (region) {
      const validRegion = db.prepare('SELECT name FROM regions WHERE name=?').get(region);
      if (!validRegion) return res.status(400).json({ error: 'المنطقة غير صحيحة' });
    }

    db.prepare(`
      UPDATE users SET
        name = ?, phone = ?, region = COALESCE(?, region),
        shop_name = ?, telegram_chat_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name.trim(), phone || null, region || null, shop_name || null, telegram_chat_id || null, req.user.id);

    const updated = db.prepare(`
      SELECT id, uuid, name, email, phone, role, region, shop_name, rating, telegram_chat_id
      FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, user: updated });
  }
);

// PUT /api/profile/password - تغيير كلمة المرور
router.put('/password', verifyToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية والجديدة' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
  }

  const db = getDB();
  const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  const valid = await bcrypt.compare(current_password, user.password);
  if (!valid) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });

  const hashed = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hashed, req.user.id);
  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
});

// GET /api/profile/merchant/:id - بروفايل تاجر عام
router.get('/merchant/:id', (req, res) => {
  const db = getDB();
  const merchant = db.prepare(`
    SELECT id, name, shop_name, region, rating, rating_count, created_at,
           (SELECT COUNT(*) FROM bids WHERE merchant_id=u.id AND status='accepted') as total_wins,
           (SELECT COUNT(*) FROM bids WHERE merchant_id=u.id) as total_bids
    FROM users u WHERE id=? AND role='merchant' AND is_active=1
  `).get(req.params.id);

  if (!merchant) return res.status(404).json({ error: 'التاجر غير موجود' });

  const reviews = db.prepare(`
    SELECT r.rating, r.comment, r.created_at, u.name as reviewer_name
    FROM reviews r JOIN users u ON r.reviewer_id=u.id
    WHERE r.merchant_id=? ORDER BY r.created_at DESC LIMIT 10
  `).all(req.params.id);

  const dist = db.prepare(`
    SELECT rating, COUNT(*) as count FROM reviews WHERE merchant_id=?
    GROUP BY rating ORDER BY rating DESC
  `).all(req.params.id);

  res.json({ ...merchant, reviews, distribution: dist });
});

// GET /api/profile/contact/:bidId - جلب بيانات التواصل بعد قبول العرض
router.get('/contact/:bidId', verifyToken, (req, res) => {
  const db = getDB();

  const bid = db.prepare(`
    SELECT b.status, b.merchant_id, pr.customer_id,
           -- بيانات التاجر (للزبون)
           um.name as merchant_name, um.shop_name, um.phone as merchant_phone,
           um.telegram_chat_id as merchant_telegram,
           -- بيانات الزبون (للتاجر)
           uc.name as customer_name, uc.phone as customer_phone,
           uc.telegram_chat_id as customer_telegram
    FROM bids b
    JOIN purchase_requests pr ON b.request_id = pr.id
    JOIN users um ON b.merchant_id = um.id
    JOIN users uc ON pr.customer_id = uc.id
    WHERE b.id = ? AND b.status = 'accepted'
  `).get(req.params.bidId);

  if (!bid) return res.status(404).json({ error: 'العرض غير موجود أو لم يُقبل بعد' });

  // الزبون يرى بيانات التاجر، التاجر يرى بيانات الزبون
  const isCustomer = req.user.id === bid.customer_id;
  const isMerchant = req.user.id === bid.merchant_id;

  if (!isCustomer && !isMerchant) {
    return res.status(403).json({ error: 'ليس لديك صلاحية لعرض بيانات التواصل' });
  }

  if (isCustomer) {
    res.json({
      role: 'customer',
      contact: {
        name:     bid.merchant_name,
        shop:     bid.shop_name,
        phone:    bid.merchant_phone,
        telegram: bid.merchant_telegram,
        whatsapp_link: bid.merchant_phone
          ? `https://wa.me/2${bid.merchant_phone.replace(/^0/, '')}?text=${encodeURIComponent('مرحباً، تواصلت معك بخصوص عرضك على سوق المزايدة')}`
          : null
      }
    });
  } else {
    res.json({
      role: 'merchant',
      contact: {
        name:     bid.customer_name,
        phone:    bid.customer_phone,
        telegram: bid.customer_telegram,
        whatsapp_link: bid.customer_phone
          ? `https://wa.me/2${bid.customer_phone.replace(/^0/, '')}?text=${encodeURIComponent('مرحباً، تواصلت معك بخصوص طلبك على سوق المزايدة')}`
          : null
      }
    });
  }
});

module.exports = router;
