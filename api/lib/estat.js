/**
 * lib/estat.js — e-Stat (Japan Government Statistics) Integration
 *
 * Free layer data source. Called conditionally when base score is 60–75.
 * Dataset IDs are fixed — no dynamic discovery needed.
 *
 * Docs: https://api.e-stat.go.jp/
 */

const axios = require('axios');

const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';
const APP_ID = process.env.ESTAT_APP_ID;

// Fixed dataset IDs per spec
const DATASETS = {
  population:       '0003412310',
  householdSpending: '0003190213',
  businessStats:    '0003230501',
};

// Keyword → category mapping
function classifyKeyword(keyword) {
  if (/美容|コスメ|スキンケア|化粧/.test(keyword)) return 'beauty';
  if (/副業|仕事|転職|働き方|収入/.test(keyword))   return 'work';
  if (/飲食|料理|食事|レストラン|食べ/.test(keyword)) return 'food';
  return 'general';
}

// Category → which dataset gives the most relevant market-size signal
function selectDatasetId(category) {
  switch (category) {
    case 'beauty': return DATASETS.householdSpending;
    case 'work':   return DATASETS.businessStats;
    case 'food':   return DATASETS.householdSpending;
    default:       return DATASETS.population;
  }
}

/**
 * fetchEstatBoost
 *
 * @param {string} keyword
 * @returns {{ marketSize: number, boost: number, category: string, source: 'live'|'mock', error: string|null }}
 */
async function fetchEstatBoost(keyword) {
  // ── Env check ───────────────────────────────────────────────────
  if (!APP_ID) {
    const msg = '[e-Stat] ESTAT_APP_ID is not set in environment variables. Register free at https://api.e-stat.go.jp/';
    console.error(msg);
    return {
      marketSize: 0,
      boost: 0,
      category: classifyKeyword(keyword),
      source: 'mock',
      error: 'ESTAT_APP_ID missing',
    };
  }

  const category  = classifyKeyword(keyword);
  const statsDataId = selectDatasetId(category);

  console.log(`[e-Stat] Starting request — keyword="${keyword}" category="${category}" statsDataId="${statsDataId}"`);

  try {
    const response = await axios.get(`${ESTAT_BASE}/getStatsData`, {
      params: {
        appId:       APP_ID,
        statsDataId: statsDataId,
        limit:       10,
        metaGetFlg:  'N',
        cntGetFlg:   'N',
      },
      timeout: 8000,
    });

    const status = response.status;
    console.log(`[e-Stat] Response status: ${status}`);

    // Navigate the e-Stat JSON structure
    const values = response.data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
    if (!values || !Array.isArray(values)) {
      throw new Error('e-Stat response missing VALUE array');
    }

    // Sum all numeric values as a proxy market-size signal
    const marketSize = values.reduce((sum, v) => {
      const n = parseFloat(v?.$ ?? v?._text ?? 0);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);

    console.log(`[e-Stat] marketSize computed: ${marketSize}`);

    // Scoring boost per spec
    let boost = 0;
    if (marketSize > 5_000_000) boost = 15;  // +10 base + +5 additional
    else if (marketSize > 1_000_000) boost = 10;

    return {
      marketSize: Math.round(marketSize),
      boost,
      category,
      source: 'live',
      error: null,
    };

  } catch (e) {
    const errMsg = e.response
      ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
      : e.message;
    console.error(`[e-Stat] Request failed — ${errMsg}`);

    return {
      marketSize: 0,
      boost: 0,
      category,
      source: 'mock',
      error: errMsg,
    };
  }
}

module.exports = { fetchEstatBoost };
