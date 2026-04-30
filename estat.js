/**
 * lib/estat.js — Japan Market Intelligence Engine (JMIE v1)
 *
 * Upgrades:
 *  - AI-based intent routing (optional OpenAI)
 *  - Multi-source orchestration (e-Stat + Trend hooks)
 *  - Data normalization layer
 *  - Statistical validation engine
 *  - Market signal scoring (demand/growth/saturation)
 *  - Fusion intelligence layer
 *  - Structured API output
 *
 * REQUIRED:
 *  - ESTAT_APP_ID
 * OPTIONAL:
 *  - OPENAI_API_KEY (for intent routing)
 */

const axios = require('axios');

const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

const DATASETS = {
  population: '0003412310',
  householdSpending: '0003190213',
  businessStats: '0003230501',
};

// -----------------------------
// Cache Layer
// -----------------------------
const cache = new Map();
const TTL = 1000 * 60 * 60;

function getCache(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() > v.expiry) {
    cache.delete(k);
    return null;
  }
  return v.value;
}

function setCache(k, value) {
  cache.set(k, { value, expiry: Date.now() + TTL });
}

// -----------------------------
// AI Intent Router
// -----------------------------
async function aiRouteIntent(keyword) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) return heuristicRoute(keyword);

  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Classify Japanese market keyword into JSON:\n${keyword}\nReturn: category, dataset, confidence`
        }],
        temperature: 0.2
      },
      {
        headers: { Authorization: `Bearer ${key}` }
      }
    );

    return JSON.parse(res.data.choices[0].message.content);
  } catch (e) {
    return heuristicRoute(keyword);
  }
}

// fallback router
function heuristicRoute(k) {
  if (/美容|コスメ|スキンケア/.test(k)) {
    return { category: 'beauty', dataset: 'householdSpending', confidence: 0.6 };
  }
  if (/副業|仕事|転職|収入/.test(k)) {
    return { category: 'work', dataset: 'businessStats', confidence: 0.6 };
  }
  if (/飲食|食事|レストラン/.test(k)) {
    return { category: 'food', dataset: 'householdSpending', confidence: 0.6 };
  }
  return { category: 'general', dataset: 'population', confidence: 0.5 };
}

// -----------------------------
// e-Stat fetch
// -----------------------------
async function fetchEstat(datasetId, appId) {
  const res = await axios.get(`${ESTAT_BASE}/getStatsData`, {
    params: {
      appId,
      statsDataId: datasetId,
      limit: 20,
      metaGetFlg: 'N',
      cntGetFlg: 'N'
    },
    timeout: 8000
  });

  return res.data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
}

// -----------------------------
// Data validator
// -----------------------------
function validate(values) {
  if (!values) return { ok: false };

  const arr = Array.isArray(values) ? values : [values];

  const nums = arr
    .map(v => parseFloat(v?.$ ?? v?._text ?? v ?? 0))
    .filter(n => !isNaN(n));

  if (!nums.length) return { ok: false };

  if (nums.every(n => n === 0)) return { ok: false };

  return { ok: true, nums };
}

// -----------------------------
// Market signal engine
// -----------------------------
function computeSignals(nums) {
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;

  const marketSize = Math.round(avg);

  let demand = Math.min(1, avg / 1_000_000);
  let growth = Math.min(1, Math.log10(avg + 1) / 6);
  let saturation = avg > 5_000_000 ? 0.7 : 0.3;

  const opportunity = Math.round(
    100 * (0.4 * demand + 0.35 * growth + 0.25 * (1 - saturation))
  );

  return {
    marketSize,
    demand,
    growth,
    saturation,
    opportunityScore: opportunity
  };
}

// -----------------------------
// Optional external signals (stub)
// -----------------------------
async function fetchTrendSignal(keyword) {
  // placeholder for Google Trends / News API
  return {
    trendScore: 0.5
  };
}

// -----------------------------
// Main Engine
// -----------------------------
async function fetchEstatBoost(keyword) {
  const APP_ID = process.env.ESTAT_APP_ID;
  if (!APP_ID) throw new Error('Missing ESTAT_APP_ID');

  const cacheKey = `jmie:${keyword}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // 1. AI routing
  const intent = await aiRouteIntent(keyword);
  const datasetId = DATASETS[intent.dataset] || DATASETS.population;

  // 2. Fetch e-Stat
  const raw = await fetchEstat(datasetId, APP_ID);
  const validated = validate(raw);

  if (!validated.ok) {
    return {
      source: 'error',
      category: intent.category,
      error: 'invalid_dataset'
    };
  }

  // 3. Signals
  const baseSignals = computeSignals(validated.nums);
  const trend = await fetchTrendSignal(keyword);

  // 4. Fusion layer
  const opportunityScore = Math.round(
    baseSignals.opportunityScore * 0.8 + trend.trendScore * 20
  );

  const result = {
    query: keyword,
    category: intent.category,
    dataset: intent.dataset,
    market: {
      size: baseSignals.marketSize
    },
    signals: {
      demand: baseSignals.demand,
      growth: baseSignals.growth,
      saturation: baseSignals.saturation,
      trend: trend.trendScore
    },
    scores: {
      opportunity: opportunityScore
    },
    confidence: intent.confidence || 0.6,
    source: 'jmie_v1'
  };

  setCache(cacheKey, result);
  return result;
}

module.exports = { fetchEstatBoost };
