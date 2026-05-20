// server.js - Reverse Marketplace Main Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const { getDB } = require('./database/db');
const { checkAndTriggerScrapers } = require('./modules/scraper');
const { notifyAdmin } = require('./modules/telegram');
const { sanitizeBody } = require('./middleware/sanitize');

const authRoutes    = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const bidRoutes     = require('./routes/bids');
const dealRoutes    = require('./routes/deals');
const reviewRoutes  = require('./routes/reviews');
const notifRoutes   = require('./routes/notifications');
const profileRoutes = require('./routes/profile');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Headers (بدون helmet لتجنب حزمة إضافية) ───────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ─── Middleware ─────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeBody); // ← XSS protection على كل body
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting عام
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
  standardHeaders: true, legacyHeaders: false
});

// Rate limiting صارم على Auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 محاولات كل 15 دقيقة
  message: { error: 'محاولات كثيرة جداً، يرجى الانتظار 15 دقيقة' }
});

app.use('/api/', limiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Routes ─────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/requests',      requestRoutes);
app.use('/api/bids',          bidRoutes);
app.use('/api/deals',         dealRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/profile',       profileRoutes);

// ─── Public Stats (للجميع بدون auth) ───────────────────────────
app.get('/api/stats', (req, res) => {
  const db = getDB();
  res.json({
    total_requests:  db.prepare("SELECT COUNT(*) as c FROM purchase_requests").get().c,
    active_requests: db.prepare("SELECT COUNT(*) as c FROM purchase_requests WHERE status='active'").get().c,
    total_bids:      db.prepare("SELECT COUNT(*) as c FROM bids").get().c,
    closed_auctions: db.prepare("SELECT COUNT(*) as c FROM purchase_requests WHERE status='closed'").get().c,
    total_merchants: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='merchant' AND is_active=1").get().c,
  });
});

// ─── Health Check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const db = getDB();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    db: db ? 'connected' : 'error',
    version: '1.0.0'
  });
});

// ─── SPA Fallback ───────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// ─── Error Handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'خطأ في الخادم، يرجى المحاولة مرة أخرى' });
});

// ─── Cron Jobs ──────────────────────────────────────────────────
// فحص كل ساعة: هل هناك طلبات بدون عروض تحتاج السكريبر؟
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Cron: Checking expired requests for scraper...');
  await checkAndTriggerScrapers();
});

// فحص يومي - تنظيف الطلبات المنتهية
cron.schedule('0 0 * * *', () => {
  const db = getDB();
  const updated = db.prepare(`
    UPDATE purchase_requests
    SET status = 'expired'
    WHERE status = 'active' AND datetime(expires_at) <= datetime('now')
  `).run();
  console.log(`🧹 Daily cleanup: ${updated.changes} requests marked expired`);
  if (updated.changes > 0) notifyAdmin(`🧹 Cleanup: ${updated.changes} طلب انتهت صلاحيته`);
});

// ─── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🛒 Reverse Marketplace Server              ║
║   🌐 http://localhost:${PORT}                   ║
║   📦 DB: SQLite (WAL Mode)                   ║
║   ⏰ Scraper Cron: Every 1 hour              ║
╚══════════════════════════════════════════════╝
  `);
  getDB(); // Initialize DB on startup
  notifyAdmin(`🚀 Server started on port ${PORT}`).catch(() => {});
});

module.exports = app;
