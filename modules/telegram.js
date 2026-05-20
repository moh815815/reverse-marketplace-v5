// modules/telegram.js - Telegram Bot Notifications
const TelegramBot = require('node-telegram-bot-api');
const { getDB } = require('../database/db');

let bot = null;

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    console.warn('⚠️  Telegram bot token not set - notifications disabled');
    return null;
  }
  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
    console.log('✅ Telegram bot initialized');
  }
  return bot;
}

// ─── إرسال رسالة لمستخدم ───────────────────────────────────────
async function sendMessage(chatId, message, options = {}) {
  const b = initBot();
  if (!b || !chatId) return false;
  try {
    await b.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...options
    });
    return true;
  } catch (err) {
    console.error('Telegram send error:', err.message);
    return false;
  }
}

// ─── إشعار التجار بطلب جديد ────────────────────────────────────
async function notifyMerchantsNewRequest(request) {
  const db = getDB();
  const merchants = db.prepare(`
    SELECT u.id, u.telegram_chat_id, u.name, u.shop_name
    FROM users u
    WHERE u.role = 'merchant'
      AND u.is_active = 1
      AND u.region = ?
      AND u.telegram_chat_id IS NOT NULL
  `).all(request.region);

  const message = `
🛒 <b>طلب شراء جديد في منطقتك!</b>

📦 <b>${request.title}</b>
📍 المنطقة: ${request.region}
💰 الميزانية: حتى ${request.budget_max} جنيه
⏰ ينتهي خلال: 24 ساعة

📝 التفاصيل: ${request.description.substring(0, 100)}...

👇 <b>قدّم عرضك الآن:</b>
🔗 <a href="${process.env.BASE_URL}/merchant.html?request=${request.uuid}">اضغط هنا للمزايدة</a>
  `.trim();

  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, channel, status, metadata)
    VALUES (?, 'new_request', ?, ?, 'telegram', ?, ?)
  `);

  let sent = 0;
  for (const merchant of merchants) {
    const ok = await sendMessage(merchant.telegram_chat_id, message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '💼 قدّم عرضك الآن', url: `${process.env.BASE_URL}/merchant.html?request=${request.uuid}` },
          { text: '👁 عرض الطلب', url: `${process.env.BASE_URL}/#request-${request.uuid}` }
        ]]
      }
    });
    if (ok) sent++;
    // Log per merchant
    insertNotif.run(merchant.id, `طلب جديد: ${request.title}`, message, ok ? 'sent' : 'failed', JSON.stringify({ request_uuid: request.uuid }));
  }

  console.log(`📨 Notified ${sent}/${merchants.length} merchants for request ${request.uuid}`);
  return sent;
}

// ─── إشعار الزبون بعرض جديد ────────────────────────────────────
async function notifyCustomerNewBid(customer, bid, request) {
  const message = `
🎯 <b>عرض سعر جديد على طلبك!</b>

📦 الطلب: ${request.title}
🏪 التاجر: ${bid.shop_name}
💵 السعر: <b>${bid.price} جنيه</b>
🚚 التوصيل: ${bid.delivery_days} أيام
⭐ التقييم: ${bid.rating}/5

📊 إجمالي العروض: ${request.bids_count + 1} عرض

👇 قارن العروض واختر الأفضل:
🔗 <a href="${process.env.BASE_URL}/#request-${request.uuid}">عرض كل العروض</a>
  `.trim();

  return sendMessage(customer.telegram_chat_id, message, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ قبول العرض', callback_data: `accept_bid_${bid.uuid}` },
        { text: '📊 مقارنة العروض', url: `${process.env.BASE_URL}/#request-${request.uuid}` }
      ]]
    }
  });
}

// ─── إشعار التاجر بقبول عرضه ────────────────────────────────────
async function notifyMerchantBidAccepted(merchant, bid, request, customer) {
  const message = `
🎉 <b>مبروك! تم قبول عرضك!</b>

📦 الطلب: ${request.title}
💵 سعر العرض: ${bid.price} جنيه
👤 الزبون: ${customer.name}
📱 رقم التواصل: ${customer.phone || 'سيتم إرساله قريباً'}

⚡ <b>تواصل مع الزبون في أقرب وقت!</b>
  `.trim();

  return sendMessage(merchant.telegram_chat_id, message);
}

// ─── إشعار نتائج السكريبر ──────────────────────────────────────
async function notifyScraperResults(customer, request, results) {
  const resultsText = results.slice(0, 3).map((r, i) =>
    `${i + 1}. <b>${r.product_name}</b>\n   💰 ${r.price} ${r.currency} - ${r.source}\n   🔗 <a href="${r.affiliate_url || r.url}">اشتري الآن</a>`
  ).join('\n\n');

  const message = `
🤖 <b>رادار العروض وجد لك بدائل!</b>

لم يقدم أي تاجر عرضاً على طلبك:
📦 <i>${request.title}</i>

🔍 <b>أفضل 3 عروض من الإنترنت:</b>

${resultsText}

💡 <i>انقر على الرابط للشراء مباشرة</i>
  `.trim();

  return sendMessage(customer.telegram_chat_id, message);
}

// ─── إشعار المدير بإحصائيات ─────────────────────────────────────
async function notifyAdmin(message) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId) return;
  return sendMessage(adminChatId, `🔔 <b>Admin Alert</b>\n\n${message}`);
}

module.exports = {
  initBot,
  sendMessage,
  notifyMerchantsNewRequest,
  notifyCustomerNewBid,
  notifyMerchantBidAccepted,
  notifyScraperResults,
  notifyAdmin
};
