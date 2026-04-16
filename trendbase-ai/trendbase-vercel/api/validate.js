// POST /api/validate
// Body: { idea: "remote medicine", lang: "en" | "ja" }
// Calls each data source directly (no internal handler imports — more reliable on Vercel)
const { handleOptions, ok, err } = require('./lib/helpers');

const RAKUTEN_APP_ID   = process.env.RAKUTEN_APP_ID;
const SERPAPI_KEY      = process.env.SERPAPI_KEY;
const YOUTUBE_API_KEY  = process.env.YOUTUBE_API_KEY;
const TIKAPI_KEY       = process.env.TIKAPI_KEY;
const CLAUDE_KEY       = process.env.ANTHROPIC_API_KEY;

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchRakuten(keyword) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = new URL('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706');
    url.searchParams.set('applicationId', RAKUTEN_APP_ID);
    url.searchParams.set('format', 'json');
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('hits', '10');
    url.searchParams.set('sort', '-reviewCount');
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    const items = data.Items || [];
    const totalReviews = items.reduce((s, i) => s + (i.Item?.reviewCount || 0), 0);
    const avgPrice = items.length ? Math.round(items.reduce((s, i) => s + (i.Item?.itemPrice || 0), 0) / items.length) : 0;
    const itemCount = data.count || 0;
    return { totalReviews, avgPrice, itemCount, level: demandLevel(totalReviews, itemCount) };
  } catch { return null; }
}

async function fetchGoogleTrends(keyword) {
  if (!SERPAPI_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', keyword);
    url.searchParams.set('geo', 'JP');
    url.searchParams.set('date', 'today 12-m');
    url.searchParams.set('api_key', SERPAPI_KEY);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const timeline = data.interest_over_time?.timeline_data || [];
    const values = timeline.map(d => d.values?.[0]?.extracted_value || 0);
    if (!values.length) return null;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s, v) => s + v, 0) / Math.max(1, values.slice(-4).length);
    const trend = recentAvg > avg * 1.1 ? 'rising' : recentAvg < avg * 0.85 ? 'falling' : 'stable';
    return { avgInterest: Math.round(avg), recentTrend: trend, peakValue: Math.max(...values) };
  } catch { return null; }
}

async function fetchYouTube(keyword) {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', keyword);
    url.searchParams.set('type', 'video');
    url.searchParams.set('regionCode', 'JP');
    url.searchParams.set('relevanceLanguage', 'ja');
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('publishedAfter', sixMonthsAgo.toISOString());
    url.searchParams.set('key', YOUTUBE_API_KEY);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    return { totalResults: data.pageInfo?.totalResults || 0 };
  } catch { return null; }
}

async function fetchTikTok() {
  if (!TIKAPI_KEY) return null;
  try {
    const r = await fetch('https://api.tikapi.io/public/explore?country=JP&count=20', {
      headers: { 'X-API-KEY': TIKAPI_KEY },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const data = await r.json();
    return { videoCount: (data.itemList || []).length };
  } catch { return null; }
}

async function fetchClaude(keyword, scores, lang) {
  if (!CLAUDE_KEY) return null;
  const isEn = lang === 'en';
  const systemPrompt = isEn
    ? 'You are a Japan market business advisor. Respond ONLY in valid JSON — no markdown, no extra text.'
    : 'あなたは日本市場のビジネスアドバイザーです。有効なJSONのみで返答してください。マークダウンや余分なテキストは不要です。';

  const prompt = isEn
    ? `Business idea: "${keyword}"
Scores — demand:${scores.demand.score}, competition:${scores.competition.score}, monetization:${scores.monetization.score}, overall:${scores.overall}
Google Trends: ${scores._trendDir||'unknown'}

Return ONLY this JSON:
{"summary":"2-3 sentence market opportunity assessment","nicheAdvice":"1-2 sentence low-competition niche suggestion","pricingAdvice":"Japan market price range with brief reasoning","firstStep":"One concrete action to take today","warning":"One key risk or challenge","kaizen":{"v1":"current idea as-is","v2":"niche-refined version","v3":"monetization-optimized version (subscription)"},"roadmap":[{"day":1,"task":"..."},{"day":2,"task":"..."},{"day":3,"task":"..."},{"day":4,"task":"..."},{"day":5,"task":"..."},{"day":6,"task":"..."},{"day":7,"task":"..."}],"monetizationPaths":[{"platform":"platform name","priceRange":"price range"},{"platform":"platform name","priceRange":"price range"}]}`
    : `ビジネスアイデア：「${keyword}」
スコア — 需要:${scores.demand.score}, 競合:${scores.competition.score}, 収益化:${scores.monetization.score}, 総合:${scores.overall}
Googleトレンド：${scores._trendDir||'不明'}

以下のJSONのみを返してください：
{"summary":"2〜3文での市場機会の説明","nicheAdvice":"競合が少ないニッチの提案（1〜2文）","pricingAdvice":"日本市場での推奨価格帯と理由","firstStep":"今すぐできる最初の具体的なアクション（1文）","warning":"注意すべきリスクまたは課題（1文）","kaizen":{"v1":"現状のアイデアをそのまま","v2":"ニッチを特定した改善版","v3":"月額モデルなど収益最適化版"},"roadmap":[{"day":1,"task":"..."},{"day":2,"task":"..."},{"day":3,"task":"..."},{"day":4,"task":"..."},{"day":5,"task":"..."},{"day":6,"task":"..."},{"day":7,"task":"..."}],"monetizationPaths":[{"platform":"プラットフォーム名","priceRange":"価格帯"},{"platform":"プラットフォーム名","priceRange":"価格帯"}]}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':CLAUDE_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:1200, system: systemPrompt, messages:[{role:'user',content:prompt}] }),
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('Claude error:', e.message);
    return null;
  }
}

// ── Scoring ───────────────────────────────────────────────────

function demandLevel(reviews, count) {
  if (reviews > 50000 || count > 10000) return '非常に高い';
  if (reviews > 10000 || count > 3000)  return '高い';
  if (reviews > 1000  || count > 500)   return '中程度';
  return '低い';
}

function calculateScores(rakuten, trends, youtube, tiktok) {
  let demand = 50, competition = 50, monetization = 50, socialBuzz = 50;
  let trendDir = 'unknown';

  if (rakuten) {
    if (rakuten.level === '非常に高い') { demand = Math.min(95, demand+35); competition = Math.min(90, competition+30); }
    else if (rakuten.level === '高い')  { demand = Math.min(85, demand+20); competition = Math.min(75, competition+15); }
    else if (rakuten.level === '中程度') { demand = Math.min(65, demand+5); }
    else { demand = Math.max(20, demand-15); competition = Math.max(25, competition-15); }
    if (rakuten.avgPrice > 5000) monetization = Math.min(90, monetization+30);
    else if (rakuten.avgPrice > 2000) monetization = Math.min(80, monetization+15);
  }
  if (trends) {
    trendDir = trends.recentTrend;
    if (trends.recentTrend === 'rising')  demand = Math.min(95, demand+15);
    if (trends.recentTrend === 'falling') demand = Math.max(10, demand-20);
    if (trends.avgInterest > 70) demand = Math.min(95, demand+10);
    if (trends.avgInterest < 20) demand = Math.max(10, demand-15);
  }
  if (youtube?.totalResults) {
    if (youtube.totalResults > 50000) demand = Math.min(95, demand+10);
    socialBuzz = Math.min(90, 30 + Math.round(Math.log10(youtube.totalResults+1)*15));
  }
  if (tiktok?.videoCount) socialBuzz = Math.min(95, socialBuzz+10);

  const overall = Math.min(98, Math.max(5, Math.round(
    demand*0.35 + (100-competition)*0.20 + monetization*0.30 + socialBuzz*0.15
  )));
  return { demand, competition, monetization, socialBuzz, overall, _trendDir: trendDir };
}

function scoreLabel(score, isEn) {
  if (isEn) {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    if (score >= 40) return 'Low';
    return 'Very low';
  }
  if (score >= 80) return '高い';
  if (score >= 60) return '中程度';
  if (score >= 40) return 'やや低い';
  return '低い';
}

function oppLabel(score, isEn) {
  if (isEn) {
    if (score >= 80) return 'Very High Opportunity';
    if (score >= 65) return 'High Opportunity';
    if (score >= 50) return 'Medium Opportunity';
    if (score >= 35) return 'Limited Opportunity';
    return 'Difficult Market';
  }
  if (score >= 80) return '非常に高い機会';
  if (score >= 65) return '高い機会';
  if (score >= 50) return '中程度の機会';
  if (score >= 35) return '限定的な機会';
  return '難しい市場';
}

// ── Main handler ──────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return err(res, 405, 'POST only');

  const { idea, lang = 'ja' } = req.body || {};
  if (!idea || idea.trim().length < 2) return err(res, 400, 'idea is required');

  const keyword = idea.trim();
  const isEn = lang === 'en';

  // All data sources in parallel (15s max)
  const [rakuten, trends, youtube, tiktok] = await Promise.all([
    fetchRakuten(keyword),
    fetchGoogleTrends(keyword),
    fetchYouTube(keyword),
    fetchTikTok(),
  ]);

  const raw = calculateScores(rakuten, trends, youtube, tiktok);
  const scores = {
    demand:       { score: Math.round(raw.demand),       label: scoreLabel(raw.demand, isEn) },
    competition:  { score: Math.round(raw.competition),  label: scoreLabel(raw.competition, isEn) },
    monetization: { score: Math.round(raw.monetization), label: scoreLabel(raw.monetization, isEn) },
    socialBuzz:   { score: Math.round(raw.socialBuzz),   label: scoreLabel(raw.socialBuzz, isEn) },
    overall: raw.overall,
    _trendDir: raw._trendDir,
  };

  // Claude AI advice (uses scored data)
  const ai = await fetchClaude(keyword, scores, lang);

  // Fallback content if Claude not configured
  const fallbackRoadmap = isEn
    ? [{day:1,task:`Research 5 competitors for "${keyword}" and identify your angle`},{day:2,task:'Create a landing page on BASE or note'},{day:3,task:'Post in expat communities on Facebook and Reddit Japan'},{day:4,task:'List your service on Lancers'},{day:5,task:'Offer 3 free consultations → collect feedback'},{day:6,task:'Publish one SEO article on note'},{day:7,task:'Review and apply kaizen to v2'}]
    : [{day:1,task:`「${keyword}」で競合5社をリサーチし差別化ポイントを特定`},{day:2,task:'ランディングページを作成・公開（BASE or note）'},{day:3,task:'X・Instagram・外国人コミュニティで告知'},{day:4,task:'ランサーズにサービスを出品'},{day:5,task:'初回3名に無料相談 → フィードバック収集'},{day:6,task:'SEO記事1本をnoteに公開'},{day:7,task:'結果を振り返りv2に改善'}];

  const fallbackMoney = isEn
    ? [{platform:'Lancers / Crowdworks',priceRange:'¥2,000–¥15,000/project'},{platform:'note paid articles',priceRange:'¥300–¥3,000/article'},{platform:'BASE online shop',priceRange:'Free to start'},{platform:'Mercari resale',priceRange:'10–40% margin'}]
    : [{platform:'ランサーズ・クラウドワークス',priceRange:'¥2,000〜¥15,000/件'},{platform:'note 有料記事',priceRange:'¥300〜¥3,000/記事'},{platform:'BASE ネットショップ',priceRange:'初期費用¥0'},{platform:'メルカリ 転売',priceRange:'利益率10〜40%'}];

  const fallbackKaizen = isEn
    ? {v1:{idea:keyword},v2:{idea:`${keyword} for expats in Japan`},v3:{idea:`${keyword} — monthly subscription`}}
    : {v1:{idea:keyword},v2:{idea:`${keyword}（在日外国人向け）`},v3:{idea:`${keyword}（月額サブスクモデル）`}};

  return ok(res, {
    idea: keyword, lang,
    timestamp: new Date().toISOString(),
    aiPowered: !!ai,
    scores,
    opportunityScore: raw.overall,
    opportunityLabel: oppLabel(raw.overall, isEn),
    summary:       ai?.summary       || null,
    nicheAdvice:   ai?.nicheAdvice   || null,
    pricingAdvice: ai?.pricingAdvice || null,
    firstStep:     ai?.firstStep     || null,
    warning:       ai?.warning       || null,
    sources: {
      rakuten:      { status: rakuten  ? 'ok' : 'failed', mock: !rakuten  },
      googleTrends: { status: trends   ? 'ok' : 'failed', mock: !trends   },
      youtube:      { status: youtube  ? 'ok' : 'failed', mock: !youtube  },
      tiktok:       { status: tiktok   ? 'ok' : 'failed', mock: !tiktok   },
    },
    kaizen:           ai?.kaizen           || fallbackKaizen,
    monetizationPaths: ai?.monetizationPaths || fallbackMoney,
    roadmap:          ai?.roadmap          || fallbackRoadmap,
    sideJobCompatibility: {
      hoursRequired: raw.demand > 70 ? (isEn?'10–20 hrs/week':'10〜20時間/週') : (isEn?'5–10 hrs/week':'5〜10時間/週'),
      initialCost: '¥0–¥10,000',
      companyConflictRisk: raw.competition > 75 ? (isEn?'Medium':'中程度') : (isEn?'Low':'低い'),
      verdict: raw.overall >= 65
        ? (isEn?'Good side-hustle potential. Realistic alongside full-time work.':'副業として始めやすい。フルタイム勤務との両立が現実的です。')
        : (isEn?'Market exists but strong differentiation is essential.':'市場は存在しますが、差別化戦略が重要です。'),
    },
  });
};
