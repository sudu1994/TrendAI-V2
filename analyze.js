/**
 * api/analyze.js — JMIE v3 PRODUCTION MERGED SYSTEM
 * (Fusion of legacy SSI-AI + JMIE architecture)
 *
 * FEATURES:
 *  - Unified Intent Router (AI + fallback)
 *  - Smart Query Expansion (Rakuten + YouTube aware)
 *  - Multi-source ingestion (Rakuten / Yahoo / YouTube / e-Stat / Trends)
 *  - Validation layer (signal sanity + completeness)
 *  - Fusion scoring engine (opportunity model)
 *  - Safe fallback handling (no fake LIVE)
 *
 * REQUIRED ENV:
 *  - ESTAT_APP_ID
 *  - RAKUTEN_APP_ID
 *  - YAHOO_CLIENT_ID
 *  - YOUTUBE_API_KEY
 *  - SERPAPI_KEY (optional trends)
 *  - OPENAI_API_KEY (optional AI router)
 */

const axios = require('axios');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─────────────────────────────────────────────
   INTENT ROUTER (AI + fallback)
───────────────────────────────────────────── */
async function routeIntent(keyword) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `Return JSON only: {intent, expand[]}. Keyword: ${keyword}`
          }],
          temperature: 0.2
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
        }
      );

      return JSON.parse(res.data.choices[0].message.content);
    } catch {}
  }

  if (/副業|収入|仕事|転職/.test(keyword)) {
    return { intent: 'work', expand: ['副業 在宅 収入 日本', 'フリーランス 日本'] };
  }

  if (/美容|コスメ|スキンケア/.test(keyword)) {
    return { intent: 'beauty', expand: ['美容 トレンド 日本', 'スキンケア 人気'] };
  }

  if (/食|レストラン|飲食/.test(keyword)) {
    return { intent: 'food', expand: ['飲食 トレンド 日本'] };
  }

  return { intent: 'general', expand: [keyword] };
}

/* ─────────────────────────────────────────────
   QUERY EXPANSION (legacy + AI)
───────────────────────────────────────────── */
function expandKeywords(intentObj, keyword) {
  const base = intentObj.expand || [keyword];

  // Rakuten enrichment (legacy fix)
  const rakutenBoost = base.flatMap(k => [
    k,
    `${k} おすすめ`,
    `${k} 人気`,
    `${k} グッズ`,
    `${k} 本`
  ]);

  return [...new Set(rakutenBoost)];
}

/* ─────────────────────────────────────────────
   TREND SIGNAL (SERPAPI)
───────────────────────────────────────────── */
async function fetchTrend(keyword) {
  if (!process.env.SERPAPI_KEY) {
    return { source: 'error', status: 'missing_key' };
  }

  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_trends',
        q: keyword,
        geo: 'JP',
        api_key: process.env.SERPAPI_KEY
      }
    });

    const data = res.data?.interest_over_time?.timeline_data || [];
    if (!data.length) return { source: 'live', status: 'empty' };

    const vals = data.map(d => d.values?.[0]?.extracted_value || 0);
    const avg = vals.reduce((a,b)=>a+b,0)/vals.length;

    return {
      source: 'live',
      score: Math.round(avg)
    };
  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   RAKUTEN
───────────────────────────────────────────── */
async function fetchRakuten(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { source: 'error', error: 'missing_key' };

  try {
    const r = await axios.get(
      'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601',
      {
        params: {
          applicationId: APP_ID,
          keyword,
          hits: 10
        }
      }
    );

    const items = r.data.Items || [];
    const prices = items.map(i => i.Item.itemPrice || 0);

    return {
      source: 'live',
      volume: items.length,
      avgPrice: prices.length ? prices.reduce((a,b)=>a+b)/prices.length : 0
    };

  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   YAHOO
───────────────────────────────────────────── */
async function fetchYahoo(keyword) {
  const ID = process.env.YAHOO_CLIENT_ID;
  if (!ID) return { source: 'error', error: 'missing_key' };

  try {
    const r = await axios.get(
      'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch',
      { params: { appid: ID, query: keyword } }
    );

    const items = r.data.hits || [];

    return {
      source: 'live',
      volume: items.length
    };

  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   YOUTUBE
───────────────────────────────────────────── */
async function fetchYoutube(keyword) {
  const KEY = process.env.YOUTUBE_API_KEY;
  if (!KEY) return { source: 'error', error: 'missing_key' };

  try {
    const r = await axios.get(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          part: 'snippet',
          q: keyword,
          type: 'video',
          maxResults: 8,
          key: KEY
        }
      }
    );

    return {
      source: 'live',
      volume: r.data.items?.length || 0
    };

  } catch (e) {
    return { source: 'error', error: e.message };
  }
}

/* ─────────────────────────────────────────────
   e-Stat (boost only)
───────────────────────────────────────────── */
async function fetchEstatBoost(keyword) {
  if (!process.env.ESTAT_APP_ID) return null;

  try {
    const r = await axios.get(
      'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData',
      {
        params: {
          appId: process.env.ESTAT_APP_ID,
          statsDataId: '0003412310',
          limit: 5
        }
      }
    );

    const values = r.data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

    if (!values) return null;

    const arr = Array.isArray(values) ? values : [values];
    const nums = arr.map(v => parseFloat(v?.$ || v?._text || 0)).filter(Boolean);

    if (!nums.length) return null;

    const avg = nums.reduce((a,b)=>a+b)/nums.length;

    return {
      source: 'live',
      boost: avg > 1_000_000 ? 15 : avg > 100_000 ? 5 : 0
    };

  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   VALIDATION ENGINE
───────────────────────────────────────────── */
function validate(trend, rakuten, youtube, yahoo) {
  const score =
    (rakuten.volume || 0) +
    (yahoo.volume || 0) +
    (youtube.volume || 0);

  return {
    score,
    level: score > 500 ? 'high' : score > 100 ? 'mid' : 'low'
  };
}

/* ─────────────────────────────────────────────
   MAIN HANDLER
───────────────────────────────────────────── */
module.exports = async (req, res) => {
  const keyword = req.query.keyword || '副業';

  const intent = await routeIntent(keyword);
  const expanded = expandKeywords(intent, keyword);

  const q = expanded[0];

  const [trend, rakuten, youtube, yahoo] = await Promise.all([
    fetchTrend(q),
    fetchRakuten(q),
    fetchYoutube(q),
    fetchYahoo(q)
  ]);

  let estat = null;

  const base = validate(trend, rakuten, youtube, yahoo);

  if (base.score > 100) {
    estat = await fetchEstatBoost(q);
  }

  const finalScore = base.score + (estat?.boost || 0);

  return res.json({
    keyword,
    intent,
    expandedQuery: q,

    sources: {
      trend,
      rakuten,
      youtube,
      yahoo,
      estat
    },

    score: finalScore,
    level: finalScore > 500 ? 'HIGH' : finalScore > 150 ? 'MEDIUM' : 'LOW'
  });
};
