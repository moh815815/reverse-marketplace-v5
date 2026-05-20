// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../database/db');
const { generateToken, verifyToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, phone, password, role, region, shop_name, telegram_chat_id } = req.body;

  if (!name || !email || !password || !region) {
    return res.status(400).json({ error: 'يرجى إكمال جميع الحقول المطلوبة' });
  }
  if (!['customer', 'merchant'].includes(role)) {
    return res.status(400).json({ error: 'نوع الحساب غير صحيح' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  const db = getDB();
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return res.status(400).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });

  const hashed = await bcrypt.hash(password, 10);
  try {
    const result = db.prepare(`
      INSERT INTO users (uuid, name, email, phone, password, role, region, shop_name, telegram_chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), name, email, phone || null, hashed, role, region, shop_name || null, telegram_chat_id || null);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    const token = generateToken(user);
    res.json({ success: true, token, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنشاء الحساب' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });

  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  if (!user.is_active) return res.status(401).json({ error: 'تم إيقاف هذا الحساب' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });

  const token = generateToken(user);
  res.json({ success: true, token, user: sanitizeUser(user) });
});

// GET /api/auth/me
router.get('/me', verifyToken, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json(sanitizeUser(user));
});

// GET /api/auth/regions
router.get('/regions', (req, res) => {
  const db = getDB();
  const regions = db.prepare('SELECT name, city FROM regions WHERE is_active=1 ORDER BY city, name').all();
  res.json(regions);
});

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

module.exports = router;
