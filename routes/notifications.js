// routes/notifications.js - User Notifications
const express = require('express');
const { getDB } = require('../database/db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications - إشعاراتي
router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const notifications = db.prepare(`
    SELECT id, type, title, message, channel, status, metadata, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, parseInt(limit), offset);

  const unread = db.prepare(`
    SELECT COUNT(*) as c FROM notifications
    WHERE user_id = ? AND status = 'sent' AND json_extract(metadata, '$.read') IS NULL
  `).get(req.user.id).c;

  res.json({ notifications, unread });
});

// GET /api/notifications/count - عدد غير المقروء (للـ badge)
router.get('/count', verifyToken, (req, res) => {
  const db = getDB();
  // نعد الإشعارات الجديدة خلال آخر 48 ساعة
  const count = db.prepare(`
    SELECT COUNT(*) as c FROM notifications
    WHERE user_id = ?
      AND created_at >= datetime('now', '-48 hours')
      AND status = 'sent'
  `).get(req.user.id).c;
  res.json({ count });
});

// POST /api/notifications/:id/read - تعليم كمقروء
router.post('/:id/read', verifyToken, (req, res) => {
  const db = getDB();
  const notif = db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!notif) return res.status(404).json({ error: 'الإشعار غير موجود' });

  const meta = JSON.parse(notif.metadata || '{}');
  meta.read = true;
  db.prepare('UPDATE notifications SET metadata=? WHERE id=?').run(JSON.stringify(meta), req.params.id);
  res.json({ success: true });
});

// POST /api/notifications/read-all - تعليم الكل كمقروء
router.post('/read-all', verifyToken, (req, res) => {
  const db = getDB();
  // نحدث metadata لكل الإشعارات بتاعة الـ user
  const notifs = db.prepare('SELECT id, metadata FROM notifications WHERE user_id=?').all(req.user.id);
  const update = db.prepare('UPDATE notifications SET metadata=? WHERE id=?');
  db.transaction(() => {
    notifs.forEach(n => {
      const meta = JSON.parse(n.metadata || '{}');
      meta.read = true;
      update.run(JSON.stringify(meta), n.id);
    });
  })();
  res.json({ success: true });
});

module.exports = router;
