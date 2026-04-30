// GET /api/rakuten?keyword=副業&mode=search|ranking
// Official Rakuten Web Service — completely free
// Register: https://webservice.rakuten.co.jp/
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const BASE   = 'https://app.rakuten.co.jp/services/api';
const APP_ID = process.env.RAKUTEN_APP_ID;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';
  const mode    = req.query.mode    || 'search';

  // ── Env guard ─────────────────────────────────────────────────────────────
  console.log(`[Rakuten] RAKUTEN_APP_ID present: ${Boolean(APP_ID)}`);
  if (!APP_ID) {
    const msg = 'RAKUTEN_APP_ID is not configured. Register free at https://webservice.rakuten.co.jp/ and add to Vercel env vars.';
    console.error(`[Rakuten] ${msg}`);
    return err(res, 503, msg, {
      source: 'mock',
      error: 'RAKUTEN_APP_ID missing',
      setup: 'https://webservice.rakuten.co.jp/',
    });
  }

  console.log(`[Rakuten] Request start — keyword="${keyword}" mode="${mode}"`);

  try {
    if (mode === 'ranking') {
      const r = await axios.get(`${BASE}/IchibaItem/Ranking/20170628`, {
        params: { applicationId: APP_ID, format: 'json', hits: 10, keyword },
        timeout: 8000,
      });
      console.log(`[Rakuten] Ranking response status: ${r.status}`);

      const items = r.data.Items.map(i => ({
        rank:          i.Item.rank,
        name:          i.Item.itemName,
        price:         i.Item.itemPrice,
        shop:          i.Item.shopName,
        reviewCount:   i.Item.reviewCount,
        reviewAverage: i.Item.reviewAverage,
      }));
      return ok(res, { source: 'live', error: null, apiSource: 'rakuten_ranking', keyword, items });
    }

    // Default: search — returns demand signal
    const r = await axios.get(`${BASE}/IchibaItem/Search/20170706`, {
      params: {
        applicationId: APP_ID,
        format:        'json',
        keyword,
        hits:          10,
        sort:          '-reviewCount',
      },
      timeout: 8000,
    });
    console.log(`[Rakuten] Search response status: ${r.status}`);

    const items = r.data.Items.map(i => ({
      name:          i.Item.itemName,
      price:         i.Item.itemPrice,
      reviewCount:   i.Item.reviewCount,
      reviewAverage: i.Item.reviewAverage,
    }));

    const totalReviews = items.reduce((s, i) => s + (i.reviewCount || 0), 0);
    const avgPrice     = items.length
      ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length)
      : 0;
    const itemCount = r.data.count || 0;

    return ok(res, {
      source: 'live',
      error:  null,
      apiSource: 'rakuten_search',
      keyword,
      demandSignal: {
        totalReviews,
        avgPrice,
        itemCount,
        level: demandLevel(totalReviews, itemCount),
      },
      items,
    });

  } catch (e) {
    const errMsg = e.response
      ? `HTTP ${e.response.status}: ${e.response.data?.error_description || e.message}`
      : e.message;
    console.error(`[Rakuten] Request failed — ${errMsg}`);
    return err(res, 502, `Rakuten API error: ${errMsg}`, {
      source: 'mock',
      error:  errMsg,
    });
  }
};

function demandLevel(reviews, count) {
  if (reviews > 50000 || count > 10000) return '非常に高い';
  if (reviews > 10000 || count > 3000)  return '高い';
  if (reviews > 1000  || count > 500)   return '中程度';
  return '低い';
}
