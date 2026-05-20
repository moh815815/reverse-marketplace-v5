// middleware/auth.js - JWT Authentication
const jwt = require('jsonwebtoken');
const { getDB } = require('../database/db');

const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, role: user.role, email: user.email },
    SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), SECRET);
    // Verify user still exists and is active
    const db = getDB();
    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id=?').get(payload.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'الحساب غير موجود أو معطل' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'جلسة منتهية الصلاحية، يرجى تسجيل الدخول مجدداً' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية للوصول لهذه الصفحة' });
    }
    next();
  };
}

module.exports = { generateToken, verifyToken, requireRole };
