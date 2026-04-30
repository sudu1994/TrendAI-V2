/**
 * validator.js — Phase 2 Gatekeeper (FIXED v2.1)
 *
 * FIXES:
 *   - Empty Rakuten/YouTube → penalised (reduced points)
 *   - Yahoo strong signal → keeps score stable even if others are empty
 *   - e-Stat live data → score boost applied
 *   - status:'empty' and status:'error' treated as low-signal, not zero
 */

const THRESHOLD = 70;

/**
 * computeValidationScore
 *
 * Weights:
 *   Google Trend recent score  → 35 pts
 *   Rakuten demand level       → 30 pts  (penalised if status=empty/error)
 *   YouTube content volume     → 20 pts  (penalised if status=empty/error)
 *   Yahoo! Shopping volume     → 15 pts  (stable even if others empty)
 *   e-Stat boost               → up to +15 pts (only when base score 60–75)
 */
function computeValidationScore(trend, rakuten, youtube, yahoo, estat = null) {
  let score = 0;
  const breakdown = {};

  // ── Google Trends (35 pts) ──────────────────────────────────────
  const trendScore = Math.min(35, Math.round((trend?.recentAvg ?? 0) * 0.35));
  score += trendScore;
  breakdown.googleTrend = { raw: trend?.recentAvg ?? 0, points: trendScore, max: 35 };

  // ── Rakuten Demand (30 pts) — penalise empty/error ──────────────
  let rakutenPts;
  const rakutenStatus = rakuten?.status ?? 'ok';
  if (rakutenStatus === 'empty') {
    // Empty results: not an API error, but low signal — give minimum points
    rakutenPts = 3;
    breakdown.rakutenDemand = {
      raw: 'empty', points: rakutenPts, max: 30,
      note: 'Empty results — penalised. Consider keyword adjustment.',
    };
  } else if (rakutenStatus === 'error') {
    rakutenPts = 0;
    breakdown.rakutenDemand = { raw: 'error', points: 0, max: 30, note: 'API error — 0 pts' };
  } else {
    const demandMap = { '非常に高い': 30, '高い': 24, '中程度': 15, '低い': 6, 'Unknown': 0 };
    rakutenPts = demandMap[rakuten?.demandSignal?.level] ?? 0;
    breakdown.rakutenDemand = { raw: rakuten?.demandSignal?.level ?? 'Unknown', points: rakutenPts, max: 30 };
  }
  score += rakutenPts;

  // ── YouTube Volume (20 pts) — penalise empty/error ──────────────
  let ytPts;
  const youtubeStatus = youtube?.status ?? 'ok';
  if (youtubeStatus === 'empty') {
    ytPts = 2;
    breakdown.youtubeVolume = {
      raw: 'empty', points: ytPts, max: 20,
      note: 'Empty results — penalised. Try broader keyword.',
    };
  } else if (youtubeStatus === 'error') {
    ytPts = 0;
    breakdown.youtubeVolume = { raw: 'error', points: 0, max: 20, note: 'API error — 0 pts' };
  } else {
    const ytResults = youtube?.totalResults ?? 0;
    ytPts = ytResults > 50000 ? 20 : ytResults > 10000 ? 15 : ytResults > 1000 ? 8 : 2;
    breakdown.youtubeVolume = { raw: ytResults, points: ytPts, max: 20 };
  }
  score += ytPts;

  // ── Yahoo! Shopping Volume (15 pts) — keeps score stable ────────
  // Yahoo is working correctly — full weight maintained
  const yhHits = yahoo?.totalHits ?? 0;
  const yhPts  = yhHits > 10000 ? 15 : yhHits > 3000 ? 11 : yhHits > 500 ? 6 : 2;
  score += yhPts;
  breakdown.yahooShopping = { raw: yhHits, points: yhPts, max: 15 };

  const baseScore = Math.min(100, score);
  breakdown.baseScore = baseScore;

  // ── e-Stat Boost (only when base score is 60–75) ─────────────────
  let estatResult = { marketSize: 0, boost: 0, source: 'skipped', error: null };
  if (estat && estat.source === 'live' && baseScore >= 60 && baseScore <= 75) {
    const boost = estat.boost ?? 0;
    estatResult = {
      marketSize: estat.marketSize ?? 0,
      boost,
      category:   estat.category ?? 'general',
      source:     estat.source,
      error:      estat.error ?? null,
    };
    score = Math.min(100, baseScore + boost);
    breakdown.estatBoost = { marketSize: estatResult.marketSize, boost, appliedRange: '60–75' };
  } else {
    score = baseScore;
    let skipReason;
    if (!estat)                           skipReason = 'e-Stat not called';
    else if (estat.source === 'error')    skipReason = `e-Stat returned error: ${estat.error}`;
    else if (baseScore < 60)              skipReason = `base score ${baseScore} below 60`;
    else if (baseScore > 75)              skipReason = `base score ${baseScore} above 75`;
    else                                  skipReason = 'unknown';
    breakdown.estatBoost = { skipped: true, reason: skipReason };
  }

  const finalScore = Math.min(100, score);

  return {
    score: finalScore,
    baseScore,
    threshold: THRESHOLD,
    unlocksPaidLayer: finalScore >= THRESHOLD,
    breakdown,
    estat: estatResult,
    verdict: finalScore >= THRESHOLD
      ? `✅ スコア ${finalScore}/100 — Claude生成が解除されました`
      : `🔒 スコア ${finalScore}/100 — Claude生成にはスコア${THRESHOLD}以上が必要です`,
  };
}

module.exports = { computeValidationScore, THRESHOLD };
