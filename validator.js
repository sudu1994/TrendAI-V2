function computeValidationScore(trend, rakuten, youtube, yahoo, estat = null, keyword = '') {

  let score = 0;
  const breakdown = {};

  // ─────────────────────────────
  // INTENT DETECTION (NEW FIX)
  // ─────────────────────────────
  const isSaaS =
    /自動化|AI|ツール|SaaS|業務|DX|効率化|システム/.test(keyword);

  const isConsumer =
    /美容|食品|ファッション|商品/.test(keyword);

  const intentMultiplier =
    isSaaS ? 1.25 :
    isConsumer ? 1.0 :
    1.1;

  // ─────────────────────────────
  // GOOGLE TREND (FIXED scaling)
  // ─────────────────────────────
  const trendScoreRaw = trend?.recentAvg ?? trend?.score ?? 0;

  const trendPts = Math.min(35, Math.round(trendScoreRaw * 0.35));
  score += trendPts;

  breakdown.trend = trendPts;

  // ─────────────────────────────
  // RAKUTEN (no more zero penalty bug)
  // ─────────────────────────────
  const rakutenCount = rakuten?.demandSignal?.itemCount ?? 0;
  const rakutenStatus = rakuten?.status;

  let rakutenPts = 0;

  if (rakutenStatus === 'error') {
    rakutenPts = 2;
  } else if (rakutenStatus === 'empty') {
    rakutenPts = isSaaS ? 8 : 3; // IMPORTANT FIX
  } else {
    rakutenPts =
      rakutenCount > 5000 ? 30 :
      rakutenCount > 1000 ? 22 :
      rakutenCount > 300 ? 14 :
      rakutenCount > 50 ? 6 : 2;
  }

  score += rakutenPts;
  breakdown.rakuten = rakutenPts;

  // ─────────────────────────────
  // YOUTUBE (attention signal)
  // ─────────────────────────────
  const yt = youtube?.totalResults ?? 0;

  const ytPts =
    yt > 100000 ? 20 :
    yt > 20000 ? 15 :
    yt > 2000 ? 9 :
    yt > 0 ? 3 : 1;

  score += ytPts;
  breakdown.youtube = ytPts;

  // ─────────────────────────────
  // YAHOO (commerce stability)
  // ─────────────────────────────
  const yh = yahoo?.totalHits ?? 0;

  const yahooPts =
    yh > 10000 ? 15 :
    yh > 3000 ? 11 :
    yh > 500 ? 6 : 2;

  score += yahooPts;
  breakdown.yahoo = yahooPts;

  // ─────────────────────────────
  // e-Stat (only bonus, NEVER gatekeeper)
  // ─────────────────────────────
  let estatPts = 0;

  if (estat?.source === 'live') {
    if (estat.marketSize > 5_000_000) estatPts = 8;
    else if (estat.marketSize > 1_000_000) estatPts = 5;
    else if (estat.marketSize > 100_000) estatPts = 3;
  }

  score += estatPts;
  breakdown.estat = estatPts;

  // ─────────────────────────────
  // INTENT MULTIPLIER (FIX FOR SaaS UNDERCOUNTING)
  // ─────────────────────────────
  score = score * intentMultiplier;

  // ─────────────────────────────
  // NORMALIZE
  // ─────────────────────────────
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score: finalScore,
    baseScore: Math.round(score),
    breakdown,
    intent: isSaaS ? 'saas' : isConsumer ? 'consumer' : 'general',
    unlocksPaidLayer: finalScore >= 70,
    verdict:
      finalScore >= 70 ? 'HIGH OPPORTUNITY' :
      finalScore >= 50 ? 'GROWING' :
      'WEAK'
  };
}

module.exports = { computeValidationScore };
