// POST /api/validate
// Body: { idea: "remote medicine", lang: "en" | "ja" }
const { handleOptions, ok, err } = require('./lib/helpers');

const rakutenHandler  = require('./rakuten');
const trendsHandler   = require('./google-trends');
const youtubeHandler  = require('./youtube');
const tiktokHandler   = require('./tiktok');
const twitterHandler  = require('./twitter');

function callHandler(handler, query = {}) {
  return new Promise((resolve) => {
    const req = { method: 'GET', query, headers: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ ok: this.statusCode < 400, data }); },
      end() { resolve({ ok: false, data: null }); },
    };
    try {
      const result = handler(req, res);
      if (result && typeof result.then === 'function') {
        result.catch(() => resolve({ ok: false, data: null }));
      }
    } catch {
      resolve({ ok: false, data: null });
    }
  });
}

// ── Claude API for dynamic AI advice ─────────────────────────
async function getClaudeAdvice(idea, scores, lang, trendData) {
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
  if (!CLAUDE_KEY) return null;

  const isJa = lang === 'ja';
  const systemPrompt = isJa
    ? `あなたはTrendBaseAIのビジネスアドバイザーです。日本市場向けの副業・起業アドバイスを提供します。必ずJSON形式のみで返答してください。`
    : `You are a business advisor for TrendBaseAI. You provide side-hustle and startup advice for the Japan market. Always respond in JSON only.`;

  const userPrompt = isJa
    ? `アイデア「${idea}」についてデータ分析結果に基づいてアドバイスしてください。

データ:
- 需要スコア: ${scores.demand.score}/100
- 競合スコア: ${scores.competition.score}/100
- 収益化スコア: ${scores.monetization.score}/100
- 機会スコア: ${scores.overall}/100
- Googleトレンド動向: ${trendData?.recentTrend || '不明'}

以下のJSONを返してください（他のテキストは不要）:
{
  "summary": "2〜3文でこのアイデアの市場機会を説明",
  "nicheAdvice": "競合が少ない特定ニッチの提案（1〜2文）",
  "pricingAdvice": "日本市場での推奨価格帯と理由",
  "firstStep": "今すぐできる最初の具体的なアクション（1文）",
  "warning": "注意すべきリスクまたは課題（1文）",
  "kaizen": {
    "v1": "現状のアイデアをそのまま表現",
    "v2": "ニッチを特定した改善版（例：特定ターゲット向け）",
    "v3": "収益化を最適化した最終版（例：月額モデル）"
  },
  "roadmap": [
    {"day": 1, "task": "具体的なタスク"},
    {"day": 2, "task": "具体的なタスク"},
    {"day": 3, "task": "具体的なタスク"},
    {"day": 4, "task": "具体的なタスク"},
    {"day": 5, "task": "具体的なタスク"},
    {"day": 6, "task": "具体的なタスク"},
    {"day": 7, "task": "具体的なタスク"}
  ],
  "monetizationPaths": [
    {"platform": "プラットフォーム名", "type": "販売種別", "priceRange": "価格帯", "link": "URL"},
    {"platform": "プラットフォーム名", "type": "販売種別", "priceRange": "価格帯", "link": "URL"}
  ]
}`
    : `Give advice for the business idea "${idea}" based on the Japan market data below.

Data:
- Demand score: ${scores.demand.score}/100
- Competition score: ${scores.competition.score}/100
- Monetization score: ${scores.monetization.score}/100
- Opportunity score: ${scores.overall}/100
- Google Trends: ${trendData?.recentTrend || 'unknown'}

Return ONLY this JSON (no other text):
{
  "summary": "2-3 sentences describing the market opportunity",
  "nicheAdvice": "Suggest a low-competition niche angle (1-2 sentences)",
  "pricingAdvice": "Recommended pricing for Japan market with reasoning",
  "firstStep": "One concrete action they can take today",
  "warning": "One key risk or challenge to watch out for",
  "kaizen": {
    "v1": "Current idea as-is",
    "v2": "Niche-refined version (e.g. for a specific target)",
    "v3": "Monetization-optimized final version (e.g. subscription model)"
  },
  "roadmap": [
    {"day": 1, "task": "specific task"},
    {"day": 2, "task": "specific task"},
    {"day": 3, "task": "specific task"},
    {"day": 4, "task": "specific task"},
    {"day": 5, "task": "specific task"},
    {"day": 6, "task": "specific task"},
    {"day": 7, "task": "specific task"}
  ],
  "monetizationPaths": [
    {"platform": "platform name", "type": "sales type", "priceRange": "price range", "link": "URL"},
    {"platform": "platform name", "type": "sales type", "priceRange": "price range", "link": "URL"}
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Claude API error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return err(res, 405, 'POST only');

  const { idea, lang = 'ja' } = req.body || {};
  if (!idea || idea.trim().length < 2) return err(res, 400, 'idea is required');

  const keyword = idea.trim();
  const isJa = lang === 'ja';

  // Fire all data sources in parallel
  const [rakuten, trends, youtube, tiktok, twitter] = await Promise.all([
    callHandler(rakutenHandler,  { keyword }),
    callHandler(trendsHandler,   { keyword }),
    callHandler(youtubeHandler,  { keyword, mode: 'search' }),
    callHandler(tiktokHandler,   { keyword }),
    callHandler(twitterHandler,  { keyword }),
  ]);

  const rd  = rakuten.data;
  const td  = trends.data;
  const yd  = youtube.data;
  const tkd = tiktok.data;
  const twd = twitter.data;

  // ── Scoring ───────────────────────────────────────────────
  let demand = 50, competition = 50, monetization = 50, socialBuzz = 50;

  const ds = rd?.demandSignal || rd?.data?.demandSignal;
  if (ds) {
    if (ds.level === '非常に高い') { demand = Math.min(95, demand + 35); competition = Math.min(90, competition + 30); }
    else if (ds.level === '高い')  { demand = Math.min(85, demand + 20); competition = Math.min(75, competition + 15); }
    else if (ds.level === '中程度') { demand = Math.min(65, demand + 5); }
    else { demand = Math.max(20, demand - 15); competition = Math.max(25, competition - 15); }
    if (ds.avgPrice > 5000) monetization = Math.min(90, monetization + 30);
    else if (ds.avgPrice > 2000) monetization = Math.min(80, monetization + 15);
  }

  const ts = td?.summary || td?.data?.summary;
  if (ts) {
    if (ts.recentTrend === 'rising')  demand = Math.min(95, demand + 15);
    if (ts.recentTrend === 'falling') demand = Math.max(10, demand - 20);
    if (ts.avgInterest > 70) demand = Math.min(95, demand + 10);
    if (ts.avgInterest < 20) demand = Math.max(10, demand - 15);
  }

  const ytTotal = yd?.totalResults || yd?.data?.totalResults;
  if (ytTotal) {
    if (ytTotal > 50000) demand = Math.min(95, demand + 10);
    socialBuzz = Math.min(90, 30 + Math.round(Math.log10(ytTotal + 1) * 15));
  }

  const twBuzz = twd?.socialBuzzScore || twd?.data?.socialBuzzScore;
  if (twBuzz) socialBuzz = Math.max(socialBuzz, twBuzz);

  const overall = Math.min(98, Math.max(5, Math.round(
    demand * 0.35 + (100 - competition) * 0.20 + monetization * 0.30 + socialBuzz * 0.15
  )));

  const scores = {
    demand:       { score: Math.round(demand),       label: scoreLabel(demand, isJa) },
    competition:  { score: Math.round(competition),  label: scoreLabel(competition, isJa) },
    monetization: { score: Math.round(monetization), label: scoreLabel(monetization, isJa) },
    socialBuzz:   { score: Math.round(socialBuzz),   label: scoreLabel(socialBuzz, isJa) },
    overall,
  };

  // ── Claude AI advice (dynamic, idea-specific) ─────────────
  const aiAdvice = await getClaudeAdvice(keyword, scores, lang, ts);

  // ── Fallback templates if Claude not configured ───────────
  const fallbackRoadmap = isJa ? [
    { day: 1, task: `「${keyword}」で競合5社をリサーチし差別化ポイントを特定` },
    { day: 2, task: 'ランディングページを作成・公開（BASE or note）' },
    { day: 3, task: 'X・Instagram・外国人コミュニティFBグループで告知' },
    { day: 4, task: 'ランサーズ・ストアカにサービスを出品' },
    { day: 5, task: '初回3名に無料相談オファー → フィードバック収集' },
    { day: 6, task: 'SEO記事1本をnoteに公開' },
    { day: 7, task: '結果を振り返り、改善提案を適用してv2に更新' },
  ] : [
    { day: 1, task: `Research 5 competitors in "${keyword}" and identify your differentiation` },
    { day: 2, task: 'Create and publish a landing page (BASE or note)' },
    { day: 3, task: 'Post on X, Instagram, and expat Facebook groups in Japan' },
    { day: 4, task: 'List your service on Lancers or Stratica' },
    { day: 5, task: 'Offer free consultation to 3 people → collect feedback' },
    { day: 6, task: 'Publish one SEO article on note' },
    { day: 7, task: 'Review results and apply kaizen improvements to v2' },
  ];

  const fallbackMonetization = isJa ? [
    { platform: 'ランサーズ・クラウドワークス', type: 'スキル販売', priceRange: '¥2,000〜¥15,000/件', link: 'https://www.lancers.jp' },
    { platform: 'note 有料記事', type: 'コンテンツ販売', priceRange: '¥300〜¥3,000/記事', link: 'https://note.com' },
    { platform: 'BASE', type: 'ネットショップ', priceRange: '自由設定・初期費用¥0', link: 'https://thebase.com' },
    { platform: 'メルカリ', type: '物販・転売', priceRange: '利益率10〜40%', link: 'https://mercari.com' },
  ] : [
    { platform: 'Lancers / Crowdworks', type: 'Skill services', priceRange: '¥2,000–¥15,000/project', link: 'https://www.lancers.jp' },
    { platform: 'note paid articles', type: 'Content sales', priceRange: '¥300–¥3,000/article', link: 'https://note.com' },
    { platform: 'BASE', type: 'Online shop', priceRange: 'Free to start', link: 'https://thebase.com' },
    { platform: 'Mercari resale', type: 'Physical goods', priceRange: '10–40% margin', link: 'https://mercari.com' },
  ];

  const fallbackKaizen = isJa ? {
    v1: { idea: keyword, action: '需要と競合を確認' },
    v2: { idea: `${keyword}（外国人特化）`, action: 'ターゲットを絞り差別化を明確化' },
    v3: { idea: `${keyword}（月額サブスクモデル）`, action: '価格設定とリテンション戦略を確定' },
  } : {
    v1: { idea: keyword, action: 'Verify demand and competition' },
    v2: { idea: `${keyword} (for expats in Japan)`, action: 'Narrow target, clarify differentiation' },
    v3: { idea: `${keyword} (monthly subscription)`, action: 'Lock in pricing and retention strategy' },
  };

  return ok(res, {
    idea: keyword,
    lang,
    timestamp: new Date().toISOString(),
    aiPowered: !!aiAdvice,
    scores,
    opportunityScore: overall,
    opportunityLabel: oppLabel(overall, isJa),
    summary: aiAdvice?.summary || null,
    nicheAdvice: aiAdvice?.nicheAdvice || null,
    pricingAdvice: aiAdvice?.pricingAdvice || null,
    firstStep: aiAdvice?.firstStep || null,
    warning: aiAdvice?.warning || null,
    sources: {
      rakuten:      { status: rakuten.ok  ? 'ok' : 'failed', mock: !!rd?.mock },
      googleTrends: { status: trends.ok   ? 'ok' : 'failed', mock: !!td?.mock },
      youtube:      { status: youtube.ok  ? 'ok' : 'failed', mock: !!yd?.mock },
      tiktok:       { status: tiktok.ok   ? 'ok' : 'failed', mock: !!tkd?.mock },
      twitter:      { status: twitter.ok  ? 'ok' : 'failed', mock: !!twd?.mock },
    },
    kaizen: aiAdvice?.kaizen
      ? {
          v1: { idea: aiAdvice.kaizen.v1, action: isJa ? '現状確認' : 'Validate as-is' },
          v2: { idea: aiAdvice.kaizen.v2, action: isJa ? 'ニッチ特定' : 'Niche down' },
          v3: { idea: aiAdvice.kaizen.v3, action: isJa ? '収益最適化' : 'Optimize revenue' },
        }
      : fallbackKaizen,
    monetizationPaths: aiAdvice?.monetizationPaths || fallbackMonetization,
    roadmap: aiAdvice?.roadmap || fallbackRoadmap,
    sideJobCompatibility: {
      hoursRequired: demand > 70
        ? (isJa ? '10〜20時間/週' : '10–20 hours/week')
        : (isJa ? '5〜10時間/週' : '5–10 hours/week'),
      initialCost: '¥0〜¥10,000',
      companyConflictRisk: competition > 75
        ? (isJa ? '中程度' : 'Medium')
        : (isJa ? '低い' : 'Low'),
      verdict: overall >= 65
        ? (isJa ? '副業として始めやすい。フルタイム勤務との両立が現実的です。' : 'Good side hustle potential. Realistic to start alongside full-time work.')
        : (isJa ? '市場は存在しますが、差別化戦略が重要です。' : 'Market exists but strong differentiation is essential.'),
    },
  });
};

function scoreLabel(score, isJa) {
  if (isJa) {
    if (score >= 80) return '高い';
    if (score >= 60) return '中程度';
    if (score >= 40) return 'やや低い';
    return '低い';
  } else {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    if (score >= 40) return 'Low';
    return 'Very Low';
  }
}

function oppLabel(score, isJa) {
  if (isJa) {
    if (score >= 80) return '非常に高い機会';
    if (score >= 65) return '高い機会';
    if (score >= 50) return '中程度の機会';
    if (score >= 35) return '限定的な機会';
    return '難しい市場';
  } else {
    if (score >= 80) return 'Very High Opportunity';
    if (score >= 65) return 'High Opportunity';
    if (score >= 50) return 'Medium Opportunity';
    if (score >= 35) return 'Limited Opportunity';
    return 'Difficult Market';
  }
}
