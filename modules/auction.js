// modules/auction.js - Reverse Auction Business Logic
const { v4: uuidv4 } = require('uuid'); // ← moved to top
const { getDB } = require('../database/db');
const { notifyCustomerNewBid, notifyMerchantBidAccepted, notifyAdmin } = require('./telegram');

// ─── تقديم عرض سعر جديد ────────────────────────────────────────
async function submitBid(requestId, merchantId, bidData) {
  const db = getDB();

  // التحقق من الطلب
  const request = db.prepare(`
    SELECT pr.*, u.telegram_chat_id as customer_telegram, u.name as customer_name, u.phone as customer_phone
    FROM purchase_requests pr
    JOIN users u ON pr.customer_id = u.id
    WHERE pr.id = ? AND pr.status = 'active'
  `).get(requestId);

  if (!request) {
    return { error: 'الطلب غير موجود أو منتهي الصلاحية' };
  }

  // هل انتهت مدة الطلب؟
  if (new Date(request.expires_at) < new Date()) {
    db.prepare(`UPDATE purchase_requests SET status='expired' WHERE id=?`).run(requestId);
    return { error: 'انتهت مدة هذا الطلب' };
  }

  // هل الميزانية مناسبة؟
  if (bidData.price > request.budget_max) {
    return { error: `السعر يتجاوز ميزانية الزبون (${request.budget_max} جنيه)` };
  }

  // هل التاجر قدّم عرض من قبل؟
  const existingBid = db.prepare(`
    SELECT id, price FROM bids WHERE request_id=? AND merchant_id=? AND status='pending'
  `).get(requestId, merchantId);

  if (existingBid) {
    // تحديث العرض القديم إذا كان السعر أفضل
    const minImprovement = parseInt(process.env.MIN_BID_IMPROVEMENT) || 5;
    if (bidData.price >= existingBid.price) {
      return { error: 'يجب أن يكون العرض الجديد أقل من عرضك السابق' };
    }
    if ((existingBid.price - bidData.price) < minImprovement) {
      return { error: `يجب تخفيض السعر بحد أدنى ${minImprovement} جنيه` };
    }
    db.prepare(`UPDATE bids SET price=?, description=?, delivery_days=?, updated_at=datetime('now') WHERE id=?`)
      .run(bidData.price, bidData.description, bidData.delivery_days || 3, existingBid.id);
    return { success: true, message: 'تم تحديث عرضك بنجاح', updated: true };
  }

  // إنشاء عرض جديد
  const bidUuid = uuidv4();
  const bid = db.prepare(`
    INSERT INTO bids (uuid, request_id, merchant_id, price, description, includes, delivery_days, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bidUuid, requestId, merchantId,
    bidData.price, bidData.description,
    bidData.includes || '', bidData.delivery_days || 3,
    JSON.stringify(bidData.images || [])
  );

  // تحديث عداد العروض في الطلب
  db.prepare(`UPDATE purchase_requests SET bids_count = bids_count + 1, updated_at=datetime('now') WHERE id=?`)
    .run(requestId);

  // جلب بيانات التاجر
  const merchant = db.prepare(`SELECT name, shop_name, rating FROM users WHERE id=?`).get(merchantId);

  // ─── حفظ الإشعار في DB للزبون ───────────────────────────────
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, channel, status, metadata)
    VALUES (?, 'new_bid', ?, ?, 'web', 'sent', ?)
  `).run(
    request.customer_id,
    `عرض جديد على طلبك: ${request.title}`,
    `${merchant.shop_name || merchant.name} قدّم عرضاً بسعر ${bidData.price} جنيه`,
    JSON.stringify({ request_uuid: request.uuid, bid_uuid: bidUuid, price: bidData.price })
  );

  // إشعار Telegram للزبون
  if (request.customer_telegram) {
    await notifyCustomerNewBid(
      { telegram_chat_id: request.customer_telegram, name: request.customer_name },
      { ...bidData, uuid: bidUuid, shop_name: merchant.shop_name || merchant.name, rating: merchant.rating },
      request
    );
  }

  return {
    success: true,
    message: 'تم تقديم عرضك بنجاح!',
    bid_id: bid.lastInsertRowid
  };
}

// ─── قبول عرض (من الزبون) ──────────────────────────────────────
async function acceptBid(bidId, customerId) {
  const db = getDB();

  const bid = db.prepare(`
    SELECT b.*, u.telegram_chat_id as merchant_telegram, u.name as merchant_name,
           u.shop_name, pr.title as request_title, pr.customer_id
    FROM bids b
    JOIN users u ON b.merchant_id = u.id
    JOIN purchase_requests pr ON b.request_id = pr.id
    WHERE b.id = ? AND b.status = 'pending'
  `).get(bidId);

  if (!bid) return { error: 'العرض غير موجود' };
  if (bid.customer_id !== customerId) return { error: 'ليس لديك صلاحية' };

  const customer = db.prepare(`SELECT * FROM users WHERE id=?`).get(customerId);

  // تحديث حالة العروض
  db.transaction(() => {
    // قبول هذا العرض
    db.prepare(`UPDATE bids SET status='accepted', is_winner=1 WHERE id=?`).run(bidId);
    // رفض باقي العروض
    db.prepare(`UPDATE bids SET status='rejected' WHERE request_id=? AND id!=?`).run(bid.request_id, bidId);
    // إغلاق الطلب
    db.prepare(`UPDATE purchase_requests SET status='closed', selected_bid_id=? WHERE id=?`).run(bidId, bid.request_id);
  })();

  // إشعار التاجر
  if (bid.merchant_telegram) {
    await notifyMerchantBidAccepted(
      { telegram_chat_id: bid.merchant_telegram },
      bid,
      { title: bid.request_title },
      customer
    );
  }

  // ─── حفظ إشعار في DB للتاجر ─────────────────────────────────
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, channel, status, metadata)
    VALUES (?, 'bid_accepted', ?, ?, 'web', 'sent', ?)
  `).run(
    bid.merchant_id,
    `تم قبول عرضك على: ${bid.request_title}`,
    `الزبون قبل عرضك بسعر ${bid.price} جنيه — تواصل معه الآن`,
    JSON.stringify({ bid_id: bidId, request_title: bid.request_title, price: bid.price })
  );

  await notifyAdmin(`✅ Bid accepted: "${bid.request_title}" - Price: ${bid.price} EGP`);

  return { success: true, message: 'تم قبول العرض! سيتواصل معك التاجر قريباً' };
}

// ─── جلب عروض طلب معين مرتبة ───────────────────────────────────
function getBidsForRequest(requestId, sortBy = 'price') {
  const db = getDB();
  const sortColumn = sortBy === 'rating' ? 'u.rating DESC, b.price ASC' : 'b.price ASC, u.rating DESC';

  return db.prepare(`
    SELECT
      b.id, b.uuid, b.price, b.description, b.includes,
      b.delivery_days, b.status, b.is_winner, b.created_at,
      b.merchant_id,
      u.name as merchant_name, u.shop_name,
      u.rating as merchant_rating, u.rating_count,
      u.region as merchant_region
    FROM bids b
    JOIN users u ON b.merchant_id = u.id
    WHERE b.request_id = ? AND b.status IN ('pending', 'accepted')
    ORDER BY ${sortColumn}
  `).all(requestId);
}

// ─── إحصائيات المزاد ───────────────────────────────────────────
function getAuctionStats() {
  const db = getDB();
  return {
    total_requests: db.prepare(`SELECT COUNT(*) as c FROM purchase_requests`).get().c,
    active_requests: db.prepare(`SELECT COUNT(*) as c FROM purchase_requests WHERE status='active'`).get().c,
    total_bids: db.prepare(`SELECT COUNT(*) as c FROM bids`).get().c,
    closed_auctions: db.prepare(`SELECT COUNT(*) as c FROM purchase_requests WHERE status='closed'`).get().c,
    avg_bids_per_request: db.prepare(`SELECT AVG(bids_count) as avg FROM purchase_requests WHERE bids_count > 0`).get().avg || 0,
    top_merchants: db.prepare(`
      SELECT u.name, u.shop_name, COUNT(b.id) as total_bids, SUM(b.is_winner) as wins
      FROM users u JOIN bids b ON u.id = b.merchant_id
      WHERE u.role = 'merchant'
      GROUP BY u.id ORDER BY wins DESC LIMIT 5
    `).all()
  };
}

module.exports = { submitBid, acceptBid, getBidsForRequest, getAuctionStats };
