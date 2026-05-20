// database/db.js - SQLite Connection & Schema
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './database/marketplace.db';

let db;

function getDB() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH), {
      verbose: process.env.NODE_ENV === 'development' ? console.log : undefined
    });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('cache_size = 10000');
    db.pragma('synchronous = NORMAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- ========================================
    -- USERS TABLE (Customers + Merchants)
    -- ========================================
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      phone       TEXT,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'customer', -- customer | merchant | admin
      region      TEXT,                              -- فيصل | الجيزة | المعادي ...
      shop_name   TEXT,                              -- للتجار فقط
      rating      REAL DEFAULT 5.0,
      rating_count INTEGER DEFAULT 0,
      telegram_chat_id TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- PURCHASE REQUESTS (طلبات الشراء)
    -- ========================================
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT UNIQUE NOT NULL,
      customer_id     INTEGER NOT NULL REFERENCES users(id),
      title           TEXT NOT NULL,          -- "محتاج لاب توب Dell"
      description     TEXT NOT NULL,          -- المواصفات التفصيلية
      category        TEXT NOT NULL,          -- electronics | appliances | furniture ...
      budget_min      REAL,
      budget_max      REAL NOT NULL,
      region          TEXT NOT NULL,          -- فيصل | الجيزة ...
      status          TEXT DEFAULT 'active',  -- active | closed | expired | scraping
      bids_count      INTEGER DEFAULT 0,
      selected_bid_id INTEGER,
      expires_at      TEXT NOT NULL,          -- انتهاء صلاحية الطلب
      scraper_triggered INTEGER DEFAULT 0,    -- هل اشتغل السكريبر؟
      scraper_results TEXT,                   -- JSON نتائج السكريبر
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- BIDS (عروض الأسعار من التجار)
    -- ========================================
    CREATE TABLE IF NOT EXISTS bids (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT UNIQUE NOT NULL,
      request_id      INTEGER NOT NULL REFERENCES purchase_requests(id),
      merchant_id     INTEGER NOT NULL REFERENCES users(id),
      price           REAL NOT NULL,
      description     TEXT NOT NULL,          -- تفاصيل العرض
      includes        TEXT,                   -- ما يشمله العرض (ضمان، شحن...)
      delivery_days   INTEGER DEFAULT 3,
      images          TEXT,                   -- JSON array of image paths
      status          TEXT DEFAULT 'pending', -- pending | accepted | rejected | withdrawn
      is_winner       INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- NOTIFICATIONS LOG
    -- ========================================
    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id),
      type        TEXT NOT NULL,   -- new_request | new_bid | bid_accepted | scraper_result
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      channel     TEXT NOT NULL,   -- telegram | whatsapp | web
      status      TEXT DEFAULT 'pending', -- pending | sent | failed
      metadata    TEXT,            -- JSON extra data
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- SCRAPER RESULTS (نتائج الرادار)
    -- ========================================
    CREATE TABLE IF NOT EXISTS scraper_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id    INTEGER NOT NULL REFERENCES purchase_requests(id),
      source        TEXT NOT NULL,  -- amazon | noon | aliexpress
      product_name  TEXT NOT NULL,
      price         REAL,
      currency      TEXT DEFAULT 'EGP',
      url           TEXT NOT NULL,
      affiliate_url TEXT,
      image_url     TEXT,
      rating        REAL,
      reviews_count INTEGER,
      availability  TEXT,
      scraped_at    TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- AI & TECH DEALS (عروض الـ AI والكلاود)
    -- ========================================
    CREATE TABLE IF NOT EXISTS tech_deals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid          TEXT UNIQUE NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT,
      provider      TEXT NOT NULL,   -- ChatGPT | Gemini | AWS | Azure ...
      category      TEXT NOT NULL,   -- ai_subscription | cloud | saas | hosting
      original_price REAL,
      deal_price    REAL,
      discount_pct  INTEGER,
      currency      TEXT DEFAULT 'USD',
      affiliate_url TEXT NOT NULL,
      logo_url      TEXT,
      is_featured   INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      expires_at    TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- REVIEWS & RATINGS
    -- ========================================
    CREATE TABLE IF NOT EXISTS reviews (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      reviewer_id INTEGER NOT NULL REFERENCES users(id),
      merchant_id INTEGER NOT NULL REFERENCES users(id),
      bid_id      INTEGER REFERENCES bids(id),
      rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment     TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ========================================
    -- REGIONS LOOKUP
    -- ========================================
    CREATE TABLE IF NOT EXISTS regions (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT UNIQUE NOT NULL,
      city  TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    -- ========================================
    -- INDEXES للأداء
    -- ========================================
    CREATE INDEX IF NOT EXISTS idx_requests_status ON purchase_requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_region ON purchase_requests(region);
    CREATE INDEX IF NOT EXISTS idx_requests_expires ON purchase_requests(expires_at);
    CREATE INDEX IF NOT EXISTS idx_bids_request ON bids(request_id);
    CREATE INDEX IF NOT EXISTS idx_bids_merchant ON bids(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, status);
  `);

  // Seed regions if empty
  const regionCount = db.prepare('SELECT COUNT(*) as c FROM regions').get();
  if (regionCount.c === 0) {
    const insertRegion = db.prepare('INSERT OR IGNORE INTO regions (name, city) VALUES (?, ?)');
    const regions = [
      ['فيصل', 'الجيزة'], ['الجيزة', 'الجيزة'], ['المعادي', 'القاهرة'],
      ['مدينة نصر', 'القاهرة'], ['الزمالك', 'القاهرة'], ['العباسية', 'القاهرة'],
      ['الهرم', 'الجيزة'], ['الدقي', 'الجيزة'], ['المهندسين', 'الجيزة'],
      ['شبرا', 'القاهرة'], ['حلوان', 'القاهرة'], ['المنيا', 'المنيا'],
      ['الإسكندرية', 'الإسكندرية'], ['طنطا', 'الغربية'], ['المنصورة', 'الدقهلية'],
      ['أسيوط', 'أسيوط'], ['سوهاج', 'سوهاج'], ['الفيوم', 'الفيوم']
    ];
    const seedAll = db.transaction(() => regions.forEach(r => insertRegion.run(...r)));
    seedAll();
  }

  // Seed tech deals
  const dealsCount = db.prepare('SELECT COUNT(*) as c FROM tech_deals').get();
  if (dealsCount.c === 0) {
    seedTechDeals();
  }

  console.log('✅ Database initialized successfully');
}

function seedTechDeals() {
  const { v4: uuidv4 } = require('uuid');
  const stmt = db.prepare(`
    INSERT INTO tech_deals (uuid, title, description, provider, category, original_price, deal_price, discount_pct, currency, affiliate_url, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deals = [
    [uuidv4(), 'ChatGPT Plus', 'وصول لـ GPT-4o و DALL-E 3 والميزات المتقدمة', 'ChatGPT', 'ai_subscription', 20, 20, 0, 'USD', 'https://chat.openai.com/plus#ref=yourcode', 1],
    [uuidv4(), 'Google One AI Premium', 'Gemini Advanced + 2TB Storage + Google Workspace', 'Google Gemini', 'ai_subscription', 19.99, 9.99, 50, 'USD', 'https://one.google.com/about/plans#ref=your', 1],
    [uuidv4(), 'AWS Free Tier', '750 ساعة EC2 مجاناً + S3 + Lambda', 'Amazon AWS', 'cloud', 0, 0, 100, 'USD', 'https://aws.amazon.com/free/?ref=your', 0],
    [uuidv4(), 'Cloudflare Workers Free', '100,000 طلب يومياً مجاناً', 'Cloudflare', 'cloud', 5, 0, 100, 'USD', 'https://workers.cloudflare.com/?ref=your', 0],
    [uuidv4(), 'GitHub Copilot', 'مساعد الكود الذكي بـ AI', 'GitHub', 'ai_subscription', 10, 10, 0, 'USD', 'https://github.com/features/copilot#ref=your', 0],
  ];
  const seedAll = db.transaction(() => deals.forEach(d => stmt.run(...d)));
  seedAll();
}

module.exports = { getDB };
