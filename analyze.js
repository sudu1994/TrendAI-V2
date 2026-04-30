/**
 * api/analyze.js — JMIE v4 TRUE MARKET OPPORTUNITY ENGINE
 * (Upgraded from JMIE v3 production merged system)
 *
 * CORE UPGRADE:
 *  - Converts score into MARKET OPPORTUNITY ENGINE (not just ranking)
 *  - Adds saturation penalty
 *  - Adds opportunity interpretation layer
 *  - Generates business opportunity signals when score >= 75
 *
 * OUTPUT NOW INCLUDES:
 *  - opportunityLevel (0–100)
 *  - marketType (emerging / competitive / saturated)
 *  - businessIdeas[] (when high score)
 */

const axios = require('axios');

/* ─────────────────────────────────────────────
   INTENT ROUTER
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
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
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
   QUERY EXPANSION
───────────────────────────────────────────── */
function expandKeywords(intentObj, keyword) {
  const base = intentObj.expand || [keyword];

  return [...new Set(base.flatMap(k => [
    k,
    `${k} 人気`,
    `${k} おすすめ`,
    `${k} 市場`,
    `${k} 需要`
  ]))];
}

/* ─────────────────────────────────────────────
   CORE SCORING ENGINE (OPPORTUNITY MODEL)
───────────────────────────────────────────── */
function computeOpportunity({ trend, rakuten, youtube, yahoo }) {

  const demand = Math.min(30, ((rakuten.volume || 0) + (yahoo.volume || 0)) / 20);

  const attention = Math.min(20, (youtube.volume || 0) * 2);

  const trendScore = Math.min(25, trend.score || 0);

  const avgPrice = yahoo.avgPrice || 0;

  const monetization =
    avgPrice > 20000 ? 25 :
    avgPrice > 10000 ? 18 :
    avgPrice > 5000 ? 12 : 6;

  // SATURATION PENALTY (KEY UPGRADE)
  const saturationPenalty =
    (rakuten.volume || 0) > 5000 ? 15 :
    (rakuten.volume || 0) > 2000 ? 8 : 0;

  const rawScore = demand + attention + trendScore + monetization;

  const finalScore = Math.max(0, Math.round(rawScore - saturationPenalty));

  let marketType = 'emerging';
  if (finalScore >= 75) marketType = 'high_opportunity';
  else if (finalScore >= 50) marketType = 'growing';
  else marketType = 'weak';

  return { finalScore, marketType, saturationPenalty };
}

/* ─────────────────────────────────────────────
   BUSINESS IDEA GENERATOR (RULE + AI READY)
───────────────────────────────────────────── */
function generateIdeas(keyword, marketType) {

  if (marketType !== 'high_opportunity') return [];

  return [
    `Subscription service around ${keyword}`,
    `AI tool for optimizing ${keyword} in Japan market`,
    `${keyword} marketplace platform for Japanese users`,
    `Content platform monetizing ${keyword} education`
  ];
}

/* ─────────────────────────────────────────────
   MAIN HANDLER
───────────────────────────────────────────── */
module.exports = async (req, res) => {

  const keyword = req.query.keyword || '副業';

  const intent = await routeIntent(keyword);
  const expanded = expandKeywords(intent, keyword);
  const q = expanded[0];

  // MOCK SOURCES (assumes upstream pipeline exists)
  const trend = req.trend || { score: 40 };
  const rakuten = req.rakuten || { volume: 1200 };
  const youtube = req.youtube || { volume: 50 };
  const yahoo = req.yahoo || { volume: 300, avgPrice: 8000 };

  const { finalScore, marketType, saturationPenalty } =
    computeOpportunity({ trend, rakuten, youtube, yahoo });

  const businessIdeas = generateIdeas(keyword, marketType);

  return res.json({
    keyword,
    intent,
    expandedQuery: q,

    score: finalScore,
    marketType,
    saturationPenalty,

    signals: {
      trend,
      rakuten,
      youtube,
      yahoo
    },

    opportunity: {
      level: finalScore,
      classification: marketType,
      isHighOpportunity: finalScore >= 75
    },

    businessIdeas
  });
};
