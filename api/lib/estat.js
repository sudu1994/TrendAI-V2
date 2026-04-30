/**
 * lib/estat.js — e-Stat (Japan Government Statistics) Integration (FIXED v2.1)
 *
 * FIXES:
 *   - Hard env check: throws if ESTAT_APP_ID missing (no silent mock fallback)
 *   - Proper VALUE extraction from e-Stat JSON structure
 *   - Average value used as marketSize signal (more meaningful than sum)
 *   - Structured error response on failure, never returns source:'mock'
 */

const axios = require('axios');

const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

// Fixed dataset IDs per spec
const DATASETS = {
  population:        '0003412310',
  householdSpending: '0003190213',
  businessStats:     '0003230501',
};

function classifyKeyword(keyword) {
  if (/美容|コスメ|スキンケア|化粧/.test(keyword))  return 'beauty';
  if (/副業|仕事|転職|働き方|収入|在宅/.test(keyword)) return 'work';
  if (/飲食|料理|食事|レストラン|食べ/.test(keyword))  return 'food';
  return 'general';
}

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
 * THROWS if ESTAT_APP_ID is missing — caller must handle.
 * Never silently returns mock data.
 *
 * @param {string} keyword
 * @returns {{ marketSize: number, boost: number, category: string, source: 'live'|'error', error: string|null }}
 */
async function fetchEstatBoost(keyword) {
  // ── Hard env check — throw, do NOT silently return mock ──────────────────
  const APP_ID = process.env.ESTAT_APP_ID;
  if (!APP_ID) {
    throw new Error(
      '[e-Stat] ESTAT_APP_ID is not set. Register free at https://api.e-stat.go.jp/ and add to Vercel env vars.'
    );
  }

  const category    = classifyKeyword(keyword);
  const statsDataId = selectDatasetId(category);

  console.log(`[e-Stat] Request start — keyword="${keyword}" category="${category}" statsDataId="${statsDataId}"`);

  try {
    const response = await axios.get(`${ESTAT_BASE}/getStatsData`, {
      params: {
        appId:       APP_ID,
        statsDataId: statsDataId,
        limit:       20,        // fetch more to get a meaningful average
        metaGetFlg:  'N',
        cntGetFlg:   'N',
      },
      timeout: 8000,
    });

    console.log(`[e-Stat] Response status: ${response.status}`);

    // Navigate the e-Stat JSON structure
    // Value nodes can be an array of objects with a `$` or `_text` key
    const values = response.data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;

    if (!values) {
      throw new Error('e-Stat response missing VALUE field — check statsDataId or API structure');
    }

    // e-Stat VALUE can be a single object or an array depending on result count
    const valueArray = Array.isArray(values) ? values : [values];

    if (valueArray.length === 0) {
      throw new Error('e-Stat returned empty VALUE array');
    }

    // Extract numeric values — e-Stat encodes them as text in $ or _text properties
    const numericValues = valueArray
      .map((v) => parseFloat(v?.$ ?? v?._text ?? v ?? 0))
      .filter((n) => !isNaN(n) && n > 0);

    if (numericValues.length === 0) {
      throw new Error('e-Stat returned no parseable numeric values');
    }

    // Use average as market-size signal (more stable than sum for cross-dataset comparisons)
    const marketSize = Math.round(
      numericValues.reduce((sum, n) => sum + n, 0) / numericValues.length
    );

    console.log(`[e-Stat] marketSize (avg of ${numericValues.length} values): ${marketSize}`);

    // Scoring boost per spec
    let boost = 0;
    if (marketSize > 5_000_000)   boost = 15;
    else if (marketSize > 1_000_000) boost = 10;
    else if (marketSize > 100_000)   boost = 5;

    return {
      marketSize,
      boost,
      category,
      source: 'live',
      error:  null,
    };

  } catch (e) {
    const errMsg = e.response
      ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`
      : e.message;
    console.error(`[e-Stat] Request failed — ${errMsg}`);

    // Return structured failure — source is 'error', NOT 'mock'
    return {
      marketSize: 0,
      boost:      0,
      category,
      source:     'error',
      error:      errMsg,
    };
  }
}

module.exports = { fetchEstatBoost };
