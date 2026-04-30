/**
 * validator.js — Phase 2 Gatekeeper
 * Computes a 0–100 validation score from Free Layer data.
 * Claude (Paid Layer) is only unlocked if score >= THRESHOLD.
 */

const THRESHOLD = 70; // score required to unlock Paid Layer

/**
 * computeValidationScore
 * Weights:
 *   Google Trend recent score  → 35 pts
 *   Rakuten demand level       → 30 pts
 *   YouTube content volume     → 20 pts
 *   Yahoo! Shopping volume     → 15 pts
 *
 * @returns {{ score: number, breakdown: object, unlocksPaidLayer: boolean }}
 */
function computeValidationScore(trend, rakuten, youtube, yahoo) {
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

  score = Math.min(100, score);

  return {
    score,
    threshold: THRESHOLD,
    unlocksPaidLayer: score >= THRESHOLD,
    breakdown,
    verdict: score >= THRESHOLD
      ? `✅ スコア ${score}/100 — Claude生成が解除されました`
      : `🔒 スコア ${score}/100 — Claude生成にはスコア${THRESHOLD}以上が必要です`,
  };
}

module.exports = { computeValidationScore, THRESHOLD };
