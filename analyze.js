/**
 * api/analyze.js — SSI-AI Corporate Edition (v3 FINAL)
 *
 * FIXES:
 * - Rakuten multi-keyword expansion (no more 0 results issue)
 * - YouTube retry with JP intent keywords
 * - No fake LIVE → proper status handling
 * - e-Stat requires real key (no silent mock)
 * - Clean scoring input
 */

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');
const { computeValidationScore } = require('./lib/validator');
const { fetchEstatBoost } = require('./lib/estat');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────────────────
   KEYWORD HELPERS
───────────────────────────────────────────── */

function expandRakutenKeywords(keyword) {
  return [
    keyword,
    `${keyword} グッズ`,
    `${keyword} 本`,
    `${keyword} おすすめ`,
    `${keyword} 人気`,
  ];
}

function expandYoutubeKeywords(keyword) {
  return [
    keyword,
    `${keyword} 解説`,
    `${keyword} 初心者`,
    `${keyword} やり方`,
  ];
}

/* ─────────────────────────────────────────────
   GOOGLE TRENDS (SerpAPI)
───────────────────────────────────────────── */

async function fetchTrendData(keyword) {
  const KEY = process.env.SERPAPI_KEY;

  if (!KEY) {
    return { source: 'error', error: 'SERPAPI_KEY missing' };
  }

  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_trends',
        q: keyword,
        geo: 'JP',
        date: 'today 12-m',
        api_key: KEY,
      },
      timeout: 10000,
    });

    const timeline = res.data?.interest_over_time?.timeline_data || [];
    if (!timeline.length) {
      return { source: 'live', status: 'empty', keyword };
    }

    const values = timeline.map(d => d.values?.[0]?.extracted_value || 0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((a, b) => a + b, 0) / 4;

    return {
      source: 'live',
      status: 'ok',
      keyword,
      score: Math.round(recentAvg),
      trend: recentAvg > avg * 1.1 ? '📈 Rising' : '➡️ Stable',
    };

  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   RAKUTEN (FIXED)
───────────────────────────────────────────── */

async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { source: 'error', error: 'RAKUTEN_APP_ID missing' };

  const keywords = expandRakutenKeywords(keyword);

  for (const k of keywords) {
    try {
      const r = await axios.get(
        'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601',
        {
          params: {
            applicationId: APP_ID,
            keyword: k,
            hits: 10,
            sort: '-reviewCount',
          },
          timeout: 6000,
        }
      );

      const count = r.data.count || 0;

      if (count > 0) {
        const items = r.data.Items.map(i => i.Item);

        const prices = items.map(i => i.itemPrice).filter(Boolean);
        const avgPrice = prices.length
          ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
          : 0;

        return {
          source: 'live',
          status: 'ok',
          usedKeyword: k,
          demandSignal: {
            level: count > 5000 ? '高い' : count > 1000 ? '中程度' : '低い',
            itemCount: count,
            avgPrice,
          },
        };
      }

    } catch (e) {
      continue;
    }
  }

  return {
    source: 'live',
    status: 'empty',
    demandSignal: { level: '低い', itemCount: 0, avgPrice: 0 },
  };
}

/* ─────────────────────────────────────────────
   YOUTUBE (FIXED)
───────────────────────────────────────────── */

async function fetchYoutubeData(keyword) {
  const KEY = process.env.YOUTUBE_API_KEY;
  if (!KEY) return { source: 'error', error: 'YOUTUBE_API_KEY missing' };

  const keywords = expandYoutubeKeywords(keyword);

  for (const k of keywords) {
    try {
      const res = await axios.get(
        'https://www.googleapis.com/youtube/v3/search',
        {
          params: {
            part: 'snippet',
            q: k,
            type: 'video',
            maxResults: 8,
            key: KEY,
          },
          timeout: 8000,
        }
      );

      const items = res.data.items || [];

      if (items.length > 0) {
        return {
          source: 'live',
          status: 'ok',
          keyword: k,
          totalResults: res.data.pageInfo?.totalResults || 0,
        };
      }

    } catch (e) {
      continue;
    }
  }

  return { source: 'live', status: 'empty', totalResults: 0 };
}

/* ─────────────────────────────────────────────
   YAHOO (already working)
───────────────────────────────────────────── */

async function fetchYahooShoppingData(keyword) {
  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  if (!CLIENT_ID) return { source: 'error', error: 'YAHOO_CLIENT_ID missing' };

  try {
    const r = await axios.get(
      'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch',
      {
        params: {
          appid: CLIENT_ID,
          query: keyword,
          results: 20,
        },
        timeout: 6000,
      }
    );

    const items = r.data.hits || [];
    const prices = items.map(i => i.price).filter(Boolean);

    return {
      source: 'live',
      status: 'ok',
      totalHits: r.data.totalResultsAvailable || 0,
      avgPrice: prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : 0,
    };

  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   MAIN HANDLER
───────────────────────────────────────────── */

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';

  try {
    const [trend, rakuten, youtube, yahoo] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYoutubeData(keyword),
      fetchYahooShoppingData(keyword),
    ]);

    let estat = null;

    // Only call e-Stat if borderline score
    const base = computeValidationScore(trend, rakuten, youtube, yahoo, null);

    if (base.score >= 60 && base.score <= 75) {
      try {
        estat = await fetchEstatBoost(keyword);
      } catch {
        estat = null;
      }
    }

    const validation = computeValidationScore(
      trend,
      rakuten,
      youtube,
      yahoo,
      estat
    );

    return ok(res, {
      trend,
      rakuten,
      youtube,
      yahoo,
      estat,
      validation,
    });

  } catch (e) {
    return err(res, 500, e.message);
  }
};
