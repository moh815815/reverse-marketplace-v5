// middleware/sanitize.js - XSS & Input Sanitization
// بدون مكتبات خارجية — pure JS

/**
 * يزيل HTML tags الخطرة من النص
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Middleware: ينظف req.body تلقائياً على كل الروابط
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = deepSanitize(req.body);
  }
  next();
}

function deepSanitize(obj) {
  if (typeof obj === 'string') {
    return obj.trim().replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
              .replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '');
  }
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) clean[k] = deepSanitize(v);
    return clean;
  }
  return obj;
}

/**
 * تحقق من أطوال الحقول المسموح بها
 */
function validateLengths(limits) {
  return (req, res, next) => {
    for (const [field, max] of Object.entries(limits)) {
      const val = req.body?.[field];
      if (val && typeof val === 'string' && val.length > max) {
        return res.status(400).json({ error: `حقل "${field}" يتجاوز الحد الأقصى (${max} حرف)` });
      }
    }
    next();
  };
}

module.exports = { escapeHtml, sanitizeBody, validateLengths };
