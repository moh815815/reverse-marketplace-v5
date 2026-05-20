# 🛒 Reverse Marketplace - سوق المزايدة العكسية

نظام مزاد عكسي متكامل مع رادار عروض تلقائي مدمج بـ Telegram.

---

## 🏗️ هيكل المشروع (Modular Architecture)

```
reverse-marketplace/
│
├── server.js                  ← نقطة الدخول الرئيسية (Express)
├── .env.example               ← قالب المتغيرات البيئية
│
├── database/
│   └── db.js                  ← SQLite schema + seed data
│
├── modules/                   ← المنطق الأساسي (مستقل عن Routes)
│   ├── telegram.js            ← إشعارات Telegram Bot
│   ├── scraper.js             ← رادار العروض (Amazon+Noon+AliExpress)
│   └── auction.js             ← منطق المزاد العكسي
│
├── routes/                    ← API Endpoints
│   ├── auth.js                ← تسجيل / دخول / JWT
│   ├── requests.js            ← طلبات الشراء
│   ├── bids.js                ← عروض التجار
│   └── deals.js               ← عروض AI + إحصائيات
│
├── middleware/
│   └── auth.js                ← JWT Middleware + Role Guard
│
└── public/
    └── index.html             ← الواجهة الكاملة (Arabic RTL)
```

---

## ⚙️ تهيئة المشروع

### 1. تثبيت الحزم
```bash
npm install
```

### 2. إعداد متغيرات البيئة
```bash
cp .env.example .env
# عدّل الملف وأضف:
# - TELEGRAM_BOT_TOKEN (أنشئ bot من @BotFather)
# - JWT_SECRET (أي سلسلة عشوائية طويلة)
# - روابط العمولة الخاصة بك
```

### 3. تشغيل الخادم
```bash
npm start
# أو للتطوير:
npm run dev
```

### 4. فتح المتصفح
```
http://localhost:3000
```

---

## 🔗 كيفية ربط السكريبر بنظام الطلبات

```
طلب شراء جديد
      │
      ▼
[notifyMerchantsNewRequest] ─── Telegram Bot ──► التجار في المنطقة
      │
      ▼ (بعد SCRAPER_DELAY_HOURS ساعة - cron)
[checkAndTriggerScrapers] ─── يفحص كل الطلبات النشطة بدون عروض
      │
      ▼
[runScraperForRequest]
   ├── scrapeAmazon(query)     ─► Cheerio + axios
   ├── scrapeNoon(query)       ─► Cheerio + axios
   └── scrapeAliExpress(query) ─► JSON parsing من script tags
      │
      ▼
   نتائج مرتبة بالسعر
      │
      ├── حفظ في جدول scraper_results (SQLite)
      ├── تحديث purchase_request.scraper_results (JSON)
      └── إشعار الزبون عبر Telegram برابط العمولة
```

---

## 📡 API Reference

| Method | Endpoint | الوظيفة |
|--------|----------|---------|
| POST | /api/auth/register | تسجيل مستخدم جديد |
| POST | /api/auth/login | تسجيل الدخول + JWT |
| GET  | /api/auth/me | بيانات المستخدم الحالي |
| GET  | /api/auth/regions | قائمة المناطق |
| POST | /api/requests | إنشاء طلب شراء |
| GET  | /api/requests | قائمة الطلبات (فلترة) |
| GET  | /api/requests/:uuid | تفاصيل طلب واحد |
| POST | /api/requests/:uuid/trigger-scraper | تشغيل السكريبر يدوياً |
| GET  | /api/requests/my/list | طلباتي كزبون |
| POST | /api/bids | تقديم عرض سعر |
| POST | /api/bids/:id/accept | قبول عرض |
| GET  | /api/bids/request/:id | عروض طلب معين |
| GET  | /api/bids/my | عروضي كتاجر |
| DELETE | /api/bids/:id | سحب عرض |
| GET  | /api/deals | عروض AI والكلاود |
| POST | /api/deals | إضافة صفقة (admin) |
| GET  | /api/deals/stats/overview | إحصائيات عامة (admin) |

---

## 🤖 إعداد Telegram Bot

```bash
# 1. راسل @BotFather على Telegram
# 2. أرسل /newbot واتبع التعليمات
# 3. احصل على TOKEN
# 4. لمعرفة chat_id الخاص بك، راسل @userinfobot
# 5. أضف التجار لمجموعة أو راسل كل تاجر على حدة ليحصل على chat_id
```

---

## 💾 متطلبات الخادم (4GB RAM Optimized)

- Node.js 18+
- SQLite (ملف واحد، WAL mode، أقل استهلاكاً من MySQL)
- ذاكرة تشغيل مقدّرة: ~150-300MB
- لا يحتاج Docker أو Redis

---

## 🚀 نشر على VPS مجاني

```bash
# على Oracle Free Tier أو Railway أو Render:
npm install
cp .env.example .env
# عدّل .env
npm start

# أو مع PM2 للاستمرارية:
npm install -g pm2
pm2 start server.js --name marketplace
pm2 save
pm2 startup
```
