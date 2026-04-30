/**
 * validator.js — Phase 2 Gatekeeper
 * Computes a 0–100 validation score from Free Layer data.
 * Claude (Paid Layer) is only unlocked if score >= THRESHOLD.
 *
 * Score pipeline:
 *   Keyword → Trend/Demand → Base Score → e-Stat Boost (60–75 range) → Final Score → Gate
 */

const THRESHOLD = 70;

/**
 * computeValidationScore
 * Weights:
 *   Google Trend recent score  → 35 pts
 *   Rakuten demand level       → 30 pts
 *   YouTube content volume     → 20 pts
 *   Yahoo! Shopping volume     → 15 pts
 *   e-Stat boost               → up to +15 pts (only when base score 60–75)
 *
 * @param {object} trend
 * @param {object} rakuten
 * @param {object} youtube
 * @param {object} yahoo
 * @param {object|null} estat  — result from fetchEstatBoost(), or null to skip
 * @returns {{ score, breakdown, unlocksPaidLayer, estat }}
 */
function computeValidationScore(trend, rakuten, youtube, yahoo, estat = null) {
  let score = 0;
  const breakdown = {};

  // ── Google Trends (35 pts) ──────────────────────────────────────
  const trendScore = Math.min(35, Math.round((trend?.recentAvg ?? 0) * 0.35));
  score += trendScore;
  breakdown.googleTrend = { raw: trend?.recentAvg ?? 0, points: trendScore, max: 35 };

  // ── Rakuten Demand (30 pts) ─────────────────────────────────────
  const demandMap = { '非常に高い': 30, '高い': 24, '中程度': 15, '低い': 6, 'Unknown': 0 };
  const rakutenPts = demandMap[rakuten?.demandSignal?.level] ?? 0;
  score += rakutenPts;
  breakdown.rakutenDemand = { raw: rakuten?.demandSignal?.level ?? 'Unknown', points: rakutenPts, max: 30 };

  // ── YouTube Volume (20 pts) ─────────────────────────────────────
  const ytResults = youtube?.totalResults ?? 0;
  const ytPts = ytResults > 50000 ? 20 : ytResults > 10000 ? 15 : ytResults > 1000 ? 8 : 2;
  score += ytPts;
  breakdown.youtubeVolume = { raw: ytResults, points: ytPts, max: 20 };

  // ── Yahoo! Shopping Volume (15 pts) ────────────────────────────
  const yhHits = yahoo?.totalHits ?? 0;
  const yhPts = yhHits > 10000 ? 15 : yhHits > 3000 ? 11 : yhHits > 500 ? 6 : 2;
  score += yhPts;
  breakdown.yahooShopping = { raw: yhHits, points: yhPts, max: 15 };

  const baseScore = Math.min(100, score);
  breakdown.baseScore = baseScore;

  // ── e-Stat Boost (only when base score is 60–75) ────────────────
  let estatResult = { marketSize: 0, boost: 0, source: 'skipped', error: null };
  if (estat && baseScore >= 60 && baseScore <= 75) {
    const boost = estat.boost ?? 0;
    estatResult = {
      marketSize: estat.marketSize ?? 0,
      boost,
      category:   estat.category ?? 'general',
      source:     estat.source ?? 'mock',
      error:      estat.error  ?? null,
    };
    score = Math.min(100, baseScore + boost);
    breakdown.estatBoost = { marketSize: estatResult.marketSize, boost, appliedRange: '60–75' };
  } else if (estat === null || baseScore < 60 || baseScore > 75) {
    score = baseScore;
    breakdown.estatBoost = {
      skipped: true,
      reason: estat === null ? 'e-Stat not called' : `base score ${baseScore} outside 60–75 range`,
    };
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
