// modules/scraper.js - Radar Scraper (Amazon + Noon + AliExpress)
const axios = require('axios');
const cheerio = require('cheerio');
const { getDB } = require('../database/db');
const { notifyScraperResults, notifyAdmin } = require('./telegram');

// User agents دوّارة لتجنب الحجب
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/121.0.0.0 Safari/537.36'
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildAffiliateUrl(url, source) {
  const amazonTag = process.env.AMAZON_AFFILIATE_TAG;
  const noonTag   = process.env.NOON_AFFILIATE_TAG;
  try {
    const u = new URL(url);
    if (source === 'amazon' && amazonTag) {
      u.searchParams.set('tag', amazonTag);
      return u.toString();
    }
    if (source === 'noon' && noonTag) {
      return `${url}?af=${noonTag}`;
    }
    return url;
  } catch {
    return url;
  }
}

// ─── Amazon Egypt Scraper ───────────────────────────────────────
async function scrapeAmazon(query) {
  const results = [];
  try {
    const searchUrl = `https://www.amazon.eg/s?k=${encodeURIComponent(query)}&language=ar`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept-Language': 'ar-EG,ar;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.amazon.eg/'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    $('[data-component-type="s-search-result"]').slice(0, 5).each((i, el) => {
      const name  = $(el).find('h2 .a-text-normal').text().trim();
      const priceWhole = $(el).find('.a-price-whole').first().text().replace(/[^0-9]/g, '');
      const rating = parseFloat($(el).find('.a-icon-alt').text()) || null;
      const reviews = parseInt($(el).find('.a-size-base.s-underline-text').text().replace(/[^0-9]/g, '')) || 0;
      const link = $(el).find('h2 a').attr('href');
      const img  = $(el).find('.s-image').attr('src');

      if (name && priceWhole && link) {
        const url = `https://www.amazon.eg${link.split('?')[0]}`;
        results.push({
          source: 'amazon',
          product_name: name.substring(0, 200),
          price: parseFloat(priceWhole),
          currency: 'EGP',
          url,
          affiliate_url: buildAffiliateUrl(url, 'amazon'),
          image_url: img || null,
          rating,
          reviews_count: reviews
        });
      }
    });
  } catch (err) {
    console.error('Amazon scraper error:', err.message);
  }
  return results.slice(0, 3);
}

// ─── Noon Egypt Scraper ─────────────────────────────────────────
async function scrapeNoon(query) {
  const results = [];
  try {
    // Noon has API endpoint we can query
    const searchUrl = `https://www.noon.com/egypt-ar/search/?q=${encodeURIComponent(query)}&limit=5`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    // Noon uses React SSR - try multiple selectors
    $('[class*="productContainer"], [data-qa="product-name"]').slice(0, 5).each((i, el) => {
      const name  = $(el).find('[class*="name"], h2, [data-qa="product-name"]').first().text().trim();
      const priceText = $(el).find('[class*="price"], [data-qa="price"]').first().text().trim();
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;
      const link  = $(el).find('a').first().attr('href');
      const img   = $(el).find('img').first().attr('src');

      if (name && price && link) {
        const url = link.startsWith('http') ? link : `https://www.noon.com${link}`;
        results.push({
          source: 'noon',
          product_name: name.substring(0, 200),
          price,
          currency: 'EGP',
          url,
          affiliate_url: buildAffiliateUrl(url, 'noon'),
          image_url: img || null,
          rating: null,
          reviews_count: 0
        });
      }
    });
  } catch (err) {
    console.error('Noon scraper error:', err.message);
  }
  return results.slice(0, 3);
}

// ─── AliExpress Scraper ─────────────────────────────────────────
async function scrapeAliExpress(query) {
  const results = [];
  try {
    // AliExpress has a public search API
    const apiUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&SortType=default&page=1`;
    const { data } = await axios.get(apiUrl, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html',
        'Accept-Language': 'ar,en-US'
      },
      timeout: 12000
    });

    const $ = cheerio.load(data);
    // Extract from embedded JSON data (AliExpress puts data in script tags)
    let jsonData = null;
    $('script').each((i, el) => {
      const content = $(el).html() || '';
      if (content.includes('window.runParams')) {
        const match = content.match(/data:\s*(\{[\s\S]*?"mods"[\s\S]*?\})\s*}/);
        if (match) {
          try { jsonData = JSON.parse(match[1]); } catch {}
        }
      }
    });

    if (jsonData?.mods?.itemList?.content) {
      jsonData.mods.itemList.content.slice(0, 3).forEach(item => {
        const price = item.prices?.salePrice?.minPrice || item.prices?.salePrice?.value;
        const url = `https://www.aliexpress.com/item/${item.productId}.html`;
        results.push({
          source: 'aliexpress',
          product_name: (item.title?.displayTitle || item.title || '').substring(0, 200),
          price: parseFloat(price) || null,
          currency: 'USD',
          url,
          affiliate_url: `${url}?aff_id=${process.env.ALIEXPRESS_AFFILIATE_KEY || ''}`,
          image_url: item.image?.imgUrl ? `https:${item.image.imgUrl}` : null,
          rating: item.evaluation?.starRating || null,
          reviews_count: item.trade?.realTradedCount || 0
        });
      });
    }
  } catch (err) {
    console.error('AliExpress scraper error:', err.message);
  }
  return results.slice(0, 3);
}

const MAX_RESULTS = parseInt(process.env.MAX_SCRAPER_RESULTS) || 3;

// ─── رادار العروض الرئيسي ───────────────────────────────────────
async function runScraperForRequest(requestId) {
  const db = getDB();

  const request = db.prepare(`
    SELECT pr.*, u.telegram_chat_id, u.name as customer_name, u.phone
    FROM purchase_requests pr
    JOIN users u ON pr.customer_id = u.id
    WHERE pr.id = ?
  `).get(requestId);

  if (!request) return { error: 'Request not found' };

  console.log(`🔍 Scraper starting for: ${request.title}`);

  // Update status to scraping
  db.prepare(`UPDATE purchase_requests SET status='scraping', scraper_triggered=1 WHERE id=?`).run(requestId);

  const query = `${request.title} ${request.category}`;
  const allResults = [];

  // Run scrapers with delay between each
  try {
    const amazonResults = await scrapeAmazon(query);
    allResults.push(...amazonResults);
    await sleep(2000);

    const noonResults = await scrapeNoon(query);
    allResults.push(...noonResults);
    await sleep(2000);

    const aliResults = await scrapeAliExpress(query);
    allResults.push(...aliResults);
  } catch (err) {
    console.error('Scraper run error:', err.message);
  }

  // Sort by price
  const sorted = allResults
    .filter(r => r.price && r.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_RESULTS);

  // Save to DB
  const insertResult = db.prepare(`
    INSERT INTO scraper_results
      (request_id, source, product_name, price, currency, url, affiliate_url, image_url, rating, reviews_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    sorted.forEach(r => insertResult.run(
      requestId, r.source, r.product_name, r.price, r.currency,
      r.url, r.affiliate_url, r.image_url, r.rating, r.reviews_count
    ));
  });
  saveAll();

  // Update request with results
  db.prepare(`
    UPDATE purchase_requests
    SET scraper_results = ?, status = 'closed', updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(sorted), requestId);

  // Notify customer via Telegram
  if (sorted.length > 0 && request.telegram_chat_id) {
    const customerObj = { telegram_chat_id: request.telegram_chat_id, name: request.customer_name };
    await notifyScraperResults(customerObj, request, sorted);
  }

  await notifyAdmin(`🔍 Scraper completed for "${request.title}" - Found ${sorted.length} results`);

  console.log(`✅ Scraper done for ${request.title}: ${sorted.length} results`);
  return { success: true, results: sorted, count: sorted.length };
}

// ─── فحص الطلبات التي انتهت مهلتها بدون عروض ──────────────────
async function checkAndTriggerScrapers() {
  const db = getDB();
  const timeoutHours = parseInt(process.env.SCRAPER_DELAY_HOURS) || 2;

  const expiredRequests = db.prepare(`
    SELECT id, title FROM purchase_requests
    WHERE status = 'active'
      AND bids_count = 0
      AND scraper_triggered = 0
      AND datetime(created_at, '+${timeoutHours} hours') <= datetime('now')
  `).all();

  console.log(`⏰ Cron: Checking ${expiredRequests.length} requests for scraper trigger`);

  for (const req of expiredRequests) {
    await runScraperForRequest(req.id);
    await sleep(5000); // delay between requests
  }
}

module.exports = {
  runScraperForRequest,
  checkAndTriggerScrapers,
  scrapeAmazon,
  scrapeNoon,
  scrapeAliExpress
};
