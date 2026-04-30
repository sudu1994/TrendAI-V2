/**
 * Business Analyst — Japanese Market Opportunity Evaluator
 * v2.1 — Production-ready scoring engine
 *
 * Evaluates keyword opportunity using trend, demand, market size, and monetization signals
 * Returns 0–100 score with reasoning
 */

function scoreBusinessOpportunity(data) {
  const {
    keyword,
    trend,
    rakuten,
    youtube,
    yahoo,
    estat,
    validation,
  } = data;

  // ─────────────────────────────────────────────────────────────────────────────
  // EXTRACT BASE SIGNALS
  // ─────────────────────────────────────────────────────────────────────────────

  const trendScore = trend?.recentAvg ?? trend?.score ?? 0;
  const trendDirection = trend?.trend ?? '➡️ Stable';

  const yahooListings = yahoo?.totalHits ?? 0;
  const yahooAvgPrice = yahoo?.avgPrice ?? 0;

  const rakutenStatus = rakuten?.status ?? 'unknown';
  const rakutenCount = rakuten?.demandSignal?.itemCount ?? 0;
  const rakutenAvgPrice = rakuten?.demandSignal?.avgPrice ?? 0;

  const youtubeStatus = youtube?.status ?? 'unknown';
  const youtubeTotal = youtube?.totalResults ?? 0;
  const youtubeAvgViews = youtube?.avgViews ?? 0;

  const estatMarketSize = estat?.marketSize ?? 0;
  const estatBoost = estat?.boost ?? 0;

  const baselineScore = validation?.baseScore ?? 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // SIGNAL STRENGTH ASSESSMENT
  // ─────────────────────────────────────────────────────────────────────────────

  // Trend demand signal (0–30 points)
  let trendPoints = 0;
  if (trendScore >= 70) trendPoints = 30;
  else if (trendScore >= 50) trendPoints = 22;
  else if (trendScore >= 30) trendPoints = 15;
  else if (trendScore >= 10) trendPoints = 8;
  else trendPoints = 2;

  // Trend direction bonus (+/-3)
  if (trendDirection.includes('📈')) trendPoints = Math.min(30, trendPoints + 3);
  else if (trendDirection.includes('📉')) trendPoints = Math.max(0, trendPoints - 3);

  // Yahoo demand signal (0–25 points) — primary market activity indicator
  let yahooPoints = 0;
  if (yahooListings > 50000) yahooPoints = 25;
  else if (yahooListings > 10000) yahooPoints = 20;
  else if (yahooListings > 3000) yahooPoints = 15;
  else if (yahooListings > 500) yahooPoints = 10;
  else if (yahooListings > 100) yahooPoints = 5;
  else yahooPoints = 0;

  // Rakuten signal (0–20 points) — product category fit
  let rakutenPoints = 0;
  if (rakutenStatus === 'ok' && rakutenCount > 0) {
    if (rakutenCount > 5000) rakutenPoints = 20;
    else if (rakutenCount > 1000) rakutenPoints = 15;
    else if (rakutenCount > 300) rakutenPoints = 10;
    else if (rakutenCount > 50) rakutenPoints = 5;
    else rakutenPoints = 2;
  } else if (rakutenStatus === 'empty') {
    rakutenPoints = 0; // Empty but not penalised — not all ideas fit product category
  } else if (rakutenStatus === 'error') {
    rakutenPoints = 0;
  }

  // YouTube signal (0–15 points) — content/attention level
  let youtubePoints = 0;
  if (youtubeStatus === 'ok' && youtubeTotal > 0) {
    if (youtubeTotal > 100000) youtubePoints = 15;
    else if (youtubeTotal > 50000) youtubePoints = 12;
    else if (youtubeTotal > 10000) youtubePoints = 10;
    else if (youtubeTotal > 1000) youtubePoints = 7;
    else if (youtubeTotal > 100) youtubePoints = 4;
    else youtubePoints = 1;
  } else if (youtubeStatus === 'empty') {
    youtubePoints = 0; // Low attention but not all niches have YouTube presence
  } else if (youtubeStatus === 'error') {
    youtubePoints = 0;
  }

  // e-Stat signal (0–10 points) — government-verified market size
  let estatPoints = 0;
  if (estat && estat.source === 'live') {
    if (estatMarketSize > 5_000_000) estatPoints = 10;
    else if (estatMarketSize > 1_000_000) estatPoints = 7;
    else if (estatMarketSize > 100_000) estatPoints = 4;
    else if (estatMarketSize > 0) estatPoints = 2;
    else estatPoints = 0;
  } else {
    estatPoints = 0; // Missing data is not penalised
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MONETIZATION CLARITY ASSESSMENT
  // ─────────────────────────────────────────────────────────────────────────────

  let monetizationPoints = 0;
  let monetizationModel = '';
  let monetizationRisk = 'low';

  // Abstract vs concrete keyword detection
  const isAbstractKeyword = /^(AI|副業|投資|NFT|DAO|メタバース|ブロックチェーン|仮想通貨)$/i.test(keyword);

  if (yahooListings > 500 && rakutenStatus === 'ok' && rakutenCount > 0) {
    // Clear product market with multiple channels
    monetizationPoints = 15;
    monetizationModel = 'e-commerce';
    monetizationRisk = 'low';
  } else if (yahooListings > 3000 || (rakutenStatus === 'ok' && rakutenCount > 1000)) {
    // Strong single-channel market
    monetizationPoints = 12;
    monetizationModel = 'marketplace / affiliate';
    monetizationRisk = 'low';
  } else if (youtubeTotal > 50000) {
    // Content-driven market
    monetizationPoints = 10;
    monetizationModel = 'content / YouTube / newsletter';
    monetizationRisk = 'medium';
  } else if (trendScore > 60 && yahooListings > 500) {
    // Rising trend with some market activity
    monetizationPoints = 8;
    monetizationModel = 'first-mover SaaS or service';
    monetizationRisk = 'medium';
  } else if (trendScore > 50 && !isAbstractKeyword) {
    // Trending concrete idea with unclear market
    monetizationPoints = 5;
    monetizationModel = 'niche e-commerce or subscription';
    monetizationRisk = 'medium-high';
  } else if (isAbstractKeyword && trendScore > 70) {
    // Hot abstract idea — could be SaaS/tool/service
    monetizationPoints = 7;
    monetizationModel = 'SaaS / tool / consulting / course';
    monetizationRisk = 'high';
  } else if (isAbstractKeyword && trendScore > 40) {
    // Warm abstract idea
    monetizationPoints = 3;
    monetizationModel = 'SaaS / course (unproven)';
    monetizationRisk = 'high';
  } else {
    // Weak monetization clarity
    monetizationPoints = 0;
    monetizationModel = 'unclear';
    monetizationRisk = 'very-high';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MARKET CONCENTRATION RISK
  // ─────────────────────────────────────────────────────────────────────────────

  let concentrationRisk = 0;
  const hasMultipleSources = [yahooListings > 0, rakutenCount > 0, youtubeTotal > 0].filter(Boolean).length;

  if (hasMultipleSources >= 2) {
    // Demand spread across channels — lower risk
    concentrationRisk = 0;
  } else if (hasMultipleSources === 1) {
    // Demand concentrated in single channel
    if (yahooListings > 10000) concentrationRisk = -2; // Yahoo alone is usually OK
    else concentrationRisk = -5;
  } else {
    concentrationRisk = -8; // Only trend data, no market confirmation
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ASSEMBLE FINAL SCORE
  // ─────────────────────────────────────────────────────────────────────────────

  const componentScore =
    trendPoints +
    yahooPoints +
    rakutenPoints +
    youtubePoints +
    estatPoints +
    monetizationPoints +
    concentrationRisk;

  // Start with baseline, adjust by components
  let finalScore = baselineScore;

  // If component score is higher than baseline, blend them
  if (componentScore > baselineScore) {
    const blend = (baselineScore * 0.4) + (componentScore * 0.6);
    finalScore = Math.round(blend);
  } else {
    finalScore = Math.max(baselineScore, Math.round(componentScore));
  }

  // Ensure 0–100 range
  finalScore = Math.max(0, Math.min(100, finalScore));

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIDENCE LEVEL
  // ─────────────────────────────────────────────────────────────────────────────

  let confidence = 'Medium';
  const dataPoints = [
    trendScore > 0,
    yahooListings > 0,
    rakutenCount > 0 || rakutenStatus === 'empty',
    youtubeTotal > 0 || youtubeStatus === 'empty',
    estatMarketSize > 0,
  ].filter(Boolean).length;

  if (dataPoints >= 4) confidence = 'High';
  else if (dataPoints <= 2) confidence = 'Low';
  else confidence = 'Medium';

  // Reduce confidence if key signal is missing
  if (yahooListings === 0 && rakutenCount === 0 && youtubeTotal === 0) {
    confidence = 'Low';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VERDICT & REASONING
  // ─────────────────────────────────────────────────────────────────────────────

  let verdict = 'Weak';
  let reason = '';

  if (finalScore >= 70) {
    verdict = 'Strong';
    if (yahooListings > 10000 && trendScore > 50) {
      reason = `${keyword}: Strong market demand (${yahooListings.toLocaleString()} Yahoo listings) + rising interest (${trendScore}/100 trend score). Clear opportunity for e-commerce or service.`;
    } else if (youtubeTotal > 50000 && trendScore > 60) {
      reason = `${keyword}: Massive content ecosystem (${youtubeTotal.toLocaleString()} YouTube videos) + strong trend momentum. Ideal for content-driven or SaaS play.`;
    } else if (estatMarketSize > 1_000_000 && trendScore > 50) {
      reason = `${keyword}: Government-verified large market (¥${Math.round(estatMarketSize/1_000_000)}M) with sustained interest. Solid fundamentals for B2C or B2B.`;
    } else {
      reason = `${keyword}: Multiple demand signals (trend, listings, market size) align. Strong business potential with clear monetization path.`;
    }
  } else if (finalScore >= 50) {
    verdict = 'Moderate';
    if (trendScore > 60 && yahooListings < 500 && rakutenCount === 0) {
      reason = `${keyword}: Rising trend (${trendScore}/100) but weak market confirmation. Early-stage opportunity — requires customer validation before scaling.`;
    } else if (youtubeTotal > 10000 && yahooListings < 1000) {
      reason = `${keyword}: Niche interest visible in content (${youtubeTotal.toLocaleString()} videos) but limited commercial activity. Consider content-first strategy or SaaS.`;
    } else if (estatMarketSize > 100_000 && trendScore > 30) {
      reason = `${keyword}: Measurable market opportunity exists but trend interest is moderate. Could work as niche vertical or B2B service.`;
    } else {
      reason = `${keyword}: Mixed signals suggest moderate opportunity. Needs more market research and validation before major investment.`;
    }
  } else {
    verdict = 'Weak';
    if (trendScore < 20 && yahooListings < 300) {
      reason = `${keyword}: Low trend interest (${trendScore}/100) and minimal market activity. Consider pivoting keyword or exploring adjacent markets.`;
    } else if (isAbstractKeyword && trendScore > 30 && yahooListings === 0 && rakutenCount === 0) {
      reason = `${keyword}: Abstract concept with trend interest but no proven market demand. High risk unless monetization model is clear (SaaS/course).`;
    } else {
      reason = `${keyword}: Insufficient demand signals across channels. Recommend market research or pivoting to stronger keyword.`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEY FACTORS
  // ─────────────────────────────────────────────────────────────────────────────

  const keyFactors = [];

  if (trendScore >= 60) {
    keyFactors.push(`Strong trend momentum (${trendScore}/100) — sustained interest`);
  } else if (trendScore >= 40) {
    keyFactors.push(`Moderate trend interest (${trendScore}/100) — stable demand`);
  } else {
    keyFactors.push(`Weak trend signal (${trendScore}/100) — limited visibility`);
  }

  if (yahooListings > 10000) {
    keyFactors.push(`Confirmed market demand: ${yahooListings.toLocaleString()} Yahoo listings`);
  } else if (yahooListings > 1000) {
    keyFactors.push(`Moderate market activity: ${yahooListings.toLocaleString()} Yahoo listings`);
  } else if (yahooListings > 0) {
    keyFactors.push(`Limited Yahoo market: ${yahooListings.toLocaleString()} listings only`);
  } else {
    keyFactors.push('No Yahoo Shopping activity — not a product/goods category');
  }

  if (rakutenCount > 1000) {
    keyFactors.push(`Rakuten ecosystem healthy: ${rakutenCount.toLocaleString()} products available`);
  } else if (rakutenStatus === 'empty' || rakutenCount === 0) {
    keyFactors.push('Rakuten: No product matches — service/abstract/niche category');
  }

  if (youtubeTotal > 50000) {
    keyFactors.push(`High content interest: ${youtubeTotal.toLocaleString()} YouTube videos`);
  } else if (youtubeTotal > 10000) {
    keyFactors.push(`Moderate YouTube ecosystem: ${youtubeTotal.toLocaleString()} videos`);
  } else if (youtubeStatus === 'empty' || youtubeTotal === 0) {
    keyFactors.push('YouTube: Minimal creator interest — niche or unproven topic');
  }

  if (estatMarketSize > 0) {
    keyFactors.push(`Government data: ¥${Math.round(estatMarketSize/1_000_000)}M+ market size`);
  }

  if (monetizationRisk === 'low') {
    keyFactors.push(`Clear monetization path: ${monetizationModel}`);
  } else if (monetizationRisk === 'medium') {
    keyFactors.push(`Monetization strategy needed: ${monetizationModel} (moderate risk)`);
  } else {
    keyFactors.push(`Monetization uncertain: ${monetizationModel} (high risk)`);
  }

  // Keep to max 5 factors
  const topFactors = keyFactors.slice(0, 5);

  // ─────────────────────────────────────────────────────────────────────────────
  // IMPROVEMENT SUGGESTION
  // ─────────────────────────────────────────────────────────────────────────────

  let improvementSuggestion = '';

  if (finalScore >= 70) {
    if (yahooAvgPrice > 0 && rakutenAvgPrice > 0) {
      const priceGap = Math.abs(yahooAvgPrice - rakutenAvgPrice) / Math.max(yahooAvgPrice, rakutenAvgPrice);
      if (priceGap > 0.2) {
        improvementSuggestion = `Price variance detected (Yahoo: ¥${yahooAvgPrice}, Rakuten: ¥${rakutenAvgPrice}). Opportunity for value-based differentiation or premium positioning.`;
      } else {
        improvementSuggestion = 'Strong opportunity. Focus on supply chain efficiency or customer service differentiation to compete.';
      }
    } else if (youtubeTotal > 100000) {
      improvementSuggestion = `Massive content interest (${youtubeTotal.toLocaleString()} videos). Build influencer partnerships or content creator program to capture audience.`;
    } else {
      improvementSuggestion = 'Opportunity validated. Launch MVP with focus on early adopter customer feedback to refine positioning.';
    }
  } else if (finalScore >= 50) {
    if (trendScore > yahooListings / 500) {
      improvementSuggestion = `Trend interest exceeds market activity. Conduct customer interviews to identify unmet need or product-market fit gap. Consider SaaS or service model.`;
    } else if (youtubeTotal > 0 && yahooListings === 0) {
      improvementSuggestion = `Content interest exists but no product market. Build course, coaching, or SaaS solution first; validate demand before e-commerce.`;
    } else if (isAbstractKeyword) {
      improvementSuggestion = `${keyword} is abstract. Narrow scope to specific vertical (e.g., "副業" → "AI案件型副業") or define clear SaaS/tool deliverable.`;
    } else {
      improvementSuggestion = 'Perform market validation: customer surveys, landing page tests, or pre-sales to confirm demand before launching.';
    }
  } else {
    if (trendScore > 20 && yahooListings === 0) {
      improvementSuggestion = `Some trend interest (${trendScore}/100) but no commercial market. Pivot to related, more concrete keyword or explore B2B service model.`;
    } else if (yahooListings > 100 && trendScore < 30) {
      improvementSuggestion = `Niche market exists but lacking momentum. Build targeted marketing campaign or find adjacent, higher-trend keyword to cross-promote.`;
    } else {
      improvementSuggestion = `Idea not yet market-ready. Choose different keyword, validate problem/solution fit with customers, or wait for trend to warm up.`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RETURN RESULT
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    score: finalScore,
    verdict,
    reason,
    confidence,
    keyFactors: topFactors,
    recommendedModel: monetizationModel,
    improvementSuggestion,
    breakdown: {
      trendPoints,
      yahooPoints,
      rakutenPoints,
      youtubePoints,
      estatPoints,
      monetizationPoints,
      concentrationRisk,
      componentScore,
      baselineScore,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreBusinessOpportunity };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE USAGE
// ─────────────────────────────────────────────────────────────────────────────

/*
const exampleData = {
  keyword: "AIツール",
  trend: { score: 75, recentAvg: 72, trend: "📈 Rising" },
  rakuten: { status: "ok", demandSignal: { itemCount: 450, avgPrice: 2800 } },
  youtube: { status: "ok", totalResults: 85000, avgViews: 42000 },
  yahoo: { totalHits: 8500, avgPrice: 3100 },
  estat: { source: "live", marketSize: 2500000, boost: 10 },
  validation: { baseScore: 62 }
};

const result = scoreBusinessOpportunity(exampleData);
console.log(JSON.stringify(result, null, 2));
*/
