const axios = require('axios');

/* ─────────────────────────────────────────────
   INTENT CLASSIFIER (UNCHANGED BUT CLEANED)
───────────────────────────────────────────── */
function classifyIntent(keyword) {
  if (/自動化|SaaS|ツール|管理|システム|効率化|DX|業務/.test(keyword)) {
    return 'saas';
  }

  if (/副業|収入|転職|仕事|フリーランス/.test(keyword)) {
    return 'work';
  }

  if (/美容|コスメ|スキンケア|ファッション/.test(keyword)) {
    return 'consumer';
  }

  if (/動画|YouTube|解説|学習/.test(keyword)) {
    return 'content';
  }

  return 'general';
}

/* ─────────────────────────────────────────────
   SAFE NORMALIZATION HELPERS (FIX)
───────────────────────────────────────────── */
const safe = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);

/* ─────────────────────────────────────────────
   CORE SCORING ENGINE (FIXED)
───────────────────────────────────────────── */
function computeScore(intent, trend, rakuten, youtube, yahoo, keyword) {

  const trendScore = Math.min(30, safe(trend?.score));

  const rakutenVolume = safe(rakuten?.volume);
  const yahooVolume = safe(yahoo?.volume);
  const youtubeVolume = safe(youtube?.volume);

  /* ───────── COMMERCE SIGNAL (FIXED SCALE) ───────── */
  const commerceSignal = Math.min(
    20,
    (rakutenVolume * 0.002) + (yahooVolume * 0.001)
  );

  /* ───────── ATTENTION SIGNAL (FIXED) ───────── */
  const attention = Math.min(15, youtubeVolume * 0.15);

  /* ───────── MONETIZATION SIGNAL ───────── */
  const avgPrice = safe(yahoo?.avgPrice);

  const monetization =
    avgPrice > 20000 ? 25 :
    avgPrice > 10000 ? 18 :
    avgPrice > 5000 ? 12 : 6;

  /* ───────── INTENT CORRECTION LAYER (IMPORTANT FIX) ───────── */
  let intentBoost = 0;

  if (intent === 'saas') {
    // FIX: SaaS was under-scored in v5
    intentBoost = 38;
  } else if (intent === 'work') {
    intentBoost = 22;
  } else if (intent === 'content') {
    intentBoost = 12;
  } else if (intent === 'consumer') {
    intentBoost = 6;
  }

  /* ───────── SATURATION PENALTY (STABILIZED) ───────── */
  const saturationPenalty =
    rakutenVolume > 5000 ? 12 :
    rakutenVolume > 2000 ? 7 : 0;

  /* ───────── FINAL SCORE (STABLE + BOUNDED) ───────── */
  const raw =
    trendScore +
    commerceSignal +
    attention +
    monetization +
    intentBoost -
    saturationPenalty;

  const finalScore = Math.max(0, Math.min(100, Math.round(raw)));

  /* ───────── MARKET CLASSIFICATION ───────── */
  let marketType = 'weak';

  if (finalScore >= 75) marketType = 'high_opportunity';
  else if (finalScore >= 50) marketType = 'growing';
  else if (finalScore >= 30) marketType = 'emerging';

  return {
    finalScore,
    marketType,
    intentBoost,
    saturationPenalty
  };
}

/* ─────────────────────────────────────────────
   BUSINESS IDEA GENERATOR
───────────────────────────────────────────── */
function generateIdeas(keyword, intent, score) {

  if (score < 75) return [];

  if (intent === 'saas') {
    return [
      `AI SaaS for automating ${keyword}`,
      `${keyword} workflow automation platform for Japanese SMEs`,
      `Subscription system for ${keyword} optimization`,
      `AI-driven ${keyword} management tool`
    ];
  }

  if (intent === 'work') {
    return [
      `${keyword} career optimization platform`,
      `Freelancer ecosystem for ${keyword}`,
      `Income optimization system for ${keyword}`
    ];
  }

  if (intent === 'consumer') {
    return [
      `${keyword} marketplace platform`,
      `D2C brand around ${keyword}`,
      `Subscription commerce for ${keyword}`
    ];
  }

  return [
    `Platform built around ${keyword}`,
    `Digital ecosystem for ${keyword}`
  ];
}

/* ─────────────────────────────────────────────
   MAIN API HANDLER
───────────────────────────────────────────── */
module.exports = async (req, res) => {

  try {
    const keyword = req.query.keyword || '給与計算自動化';

    const intent = classifyIntent(keyword);

    /* ───────── INPUTS (REAL PIPELINE HOOK) ───────── */
    const trend = req.trend || { score: 55 };
    const rakuten = req.rakuten || { volume: 800 };
    const youtube = req.youtube || { volume: 30 };
    const yahoo = req.yahoo || { volume: 200, avgPrice: 12000 };

    const result = computeScore(
      intent,
      trend,
      rakuten,
      youtube,
      yahoo,
      keyword
    );

    const businessIdeas = generateIdeas(
      keyword,
      intent,
      result.finalScore
    );

    return res.status(200).json({
      keyword,
      intent,

      score: result.finalScore,
      marketType: result.marketType,

      unlocksPaidLayer: result.finalScore >= 70,

      breakdown: {
        trend: safe(trend?.score),
        rakuten: safe(rakuten?.volume),
        youtube: safe(youtube?.volume),
        yahoo: safe(yahoo?.volume),
        intentBoost: result.intentBoost,
        saturationPenalty: result.saturationPenalty
      },

      opportunity: {
        isHighOpportunity: result.finalScore >= 75,
        level: result.finalScore
      },

      businessIdeas
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message,
      score: 0,
      marketType: 'error'
    });
  }
};
