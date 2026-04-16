// POST /api/validate
// Body: { idea: "AIを使ったビザ申請サポート" }
//
// Aggregates all data sources in parallel and returns
// a unified validation score + launch kit + kaizen roadmap.
//
// On Vercel, calls sibling functions directly (same deployment),
// so no extra HTTP roundtrips — just imports the handlers.
const { handleOptions, ok, err } = require('./lib/helpers');

// Import route handlers directly — no HTTP needed on same Vercel deployment
const rakutenHandler  = require('./rakuten');
const trendsHandler   = require('./google-trends');
const youtubeHandler  = require('./youtube');
const tiktokHandler   = require('./tiktok');
const twitterHandler  = require('./twitter');

// Helper: call a handler and capture its JSON response
function callHandler(handler, query = {}) {
  return new Promise((resolve) => {
    const req = { method: 'GET', query, headers: {} };
    const chunks = [];
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

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return err(res, 405, 'POST only');

  const { idea } = req.body || {};
  if (!idea || idea.trim().length < 2) return err(res, 400, 'idea is required');

  const keyword = idea.trim();

  // Fire all sources in parallel
  const [rakuten, trends, youtube, tiktok, twitter] = await Promise.all([
    callHandler(rakutenHandler,  { keyword }),
    callHandler(trendsHandler,   { keyword }),
    callHandler(youtubeHandler,  { keyword, mode: 'search' }),
    callHandler(tiktokHandler,   { keyword }),
    callHandler(twitterHandler,  { keyword }),
  ]);

  const rd = rakuten.data;
  const td = trends.data;
  const yd = youtube.data;
  const tkd = tiktok.data;
  const twd = twitter.data;

  // ── Score calculation ─────────────────────────────────────
  let demand       = 50;
  let competition  = 50;
  let monetization = 50;
  let socialBuzz   = 50;

  // Rakuten signal
  const ds = rd?.demandSignal || rd?.data?.demandSignal;
  if (ds) {
    if (ds.level === '非常に高い') { demand = Math.min(95, demand + 35); competition = Math.min(90, competition + 30); }
    else if (ds.level === '高い')  { demand = Math.min(85, demand + 20); competition = Math.min(75, competition + 15); }
    else if (ds.level === '中程度') { demand = Math.min(65, demand + 5); }
    else                            { demand = Math.max(20, demand - 15); competition = Math.max(25, competition - 15); }
    if (ds.avgPrice > 5000) monetization = Math.min(90, monetization + 30);
    else if (ds.avgPrice > 2000) monetization = Math.min(80, monetization + 15);
  }

  // Google Trends signal
  const ts = td?.summary || td?.data?.summary;
  if (ts) {
    if (ts.recentTrend === 'rising')  demand = Math.min(95, demand + 15);
    if (ts.recentTrend === 'falling') demand = Math.max(10, demand - 20);
    if (ts.avgInterest > 70)  demand = Math.min(95, demand + 10);
    if (ts.avgInterest < 20)  demand = Math.max(10, demand - 15);
  }

  // YouTube signal
  const ytTotal = yd?.totalResults || yd?.data?.totalResults;
  if (ytTotal) {
    if (ytTotal > 50000) demand = Math.min(95, demand + 10);
    socialBuzz = Math.min(90, 30 + Math.round(Math.log10(ytTotal + 1) * 15));
  }

  // Twitter signal
  const twBuzz = twd?.socialBuzzScore || twd?.data?.socialBuzzScore;
  if (twBuzz) socialBuzz = Math.max(socialBuzz, twBuzz);

  const overall = Math.min(98, Math.max(5, Math.round(
    demand * 0.35 + (100 - competition) * 0.20 + monetization * 0.30 + socialBuzz * 0.15
  )));

  const scores = {
    demand:       { score: Math.round(demand),       label: label(demand) },
    competition:  { score: Math.round(competition),  label: label(competition) },
    monetization: { score: Math.round(monetization), label: label(monetization) },
    socialBuzz:   { score: Math.round(socialBuzz),   label: label(socialBuzz) },
    overall,
  };

  return ok(res, {
    idea: keyword,
    timestamp: new Date().toISOString(),
    scores,
    opportunityScore: overall,
    opportunityLabel: opportunityLabel(overall),
    sources: {
      rakuten:      { status: rakuten.ok  ? 'ok' : 'failed', mock: !!rd?.mock },
      googleTrends: { status: trends.ok   ? 'ok' : 'failed', mock: !!td?.mock },
      youtube:      { status: youtube.ok  ? 'ok' : 'failed', mock: !!yd?.mock },
      tiktok:       { status: tiktok.ok   ? 'ok' : 'failed', mock: !!tkd?.mock },
      twitter:      { status: twitter.ok  ? 'ok' : 'failed', mock: !!twd?.mock },
    },
    kaizen: {
      v1: { label: 'バージョン1 — 広いアイデア',    idea: keyword,                               action: '需要と競合を確認' },
      v2: { label: 'バージョン2 — ニッチ特定',      idea: `${keyword}（外国人特化）`,              action: 'ターゲットを絞り差別化を明確化' },
      v3: { label: 'バージョン3 — 収益最適化',      idea: `${keyword}（月額サブスクモデル）`,      action: '価格設定とリテンション戦略を確定' },
    },
    monetizationPaths: [
      { platform: 'ランサーズ・クラウドワークス', type: 'スキル販売',     priceRange: '¥2,000〜¥15,000/件',      link: 'https://www.lancers.jp' },
      { platform: 'note 有料記事',               type: 'コンテンツ販売', priceRange: '¥300〜¥3,000/記事',       link: 'https://note.com' },
      { platform: 'BASE',                        type: 'ネットショップ', priceRange: '自由設定・初期費用¥0',    link: 'https://thebase.com' },
      { platform: 'メルカリ',                    type: '物販・転売',     priceRange: '利益率10〜40%',           link: 'https://mercari.com' },
    ],
    launchKit: {
      adCopy: {
        twitter: `【副業を始めたい方へ】${keyword}で副収入を。データに基づく7日間プランで最短収益化。`,
        instagram: `在日外国人の副業に特化。${keyword}で安定した収益を。`,
      },
      seoKeywords: [`${keyword} 副業`, `${keyword} 日本 外国人`, `${keyword} やり方`, `${keyword} 稼ぐ`],
    },
    roadmap: [
      { day: 1, task: `競合5社をリサーチし「${keyword}」の差別化ポイントを特定` },
      { day: 2, task: 'ランディングページを作成・公開（BASE or note）' },
      { day: 3, task: 'X・Instagram・外国人コミュニティFBグループで告知' },
      { day: 4, task: 'ランサーズ・ストアカにサービスを出品' },
      { day: 5, task: '初回3名に無料相談オファー → フィードバック収集' },
      { day: 6, task: 'SEO記事1本をnoteに公開' },
      { day: 7, task: '結果を振り返り、改善提案を適用してv2に更新' },
    ],
    sideJobCompatibility: {
      hoursRequired: demand > 70 ? '10〜20時間/週' : '5〜10時間/週',
      initialCost: '¥0〜¥10,000',
      companyConflictRisk: competition > 75 ? '中程度' : '低い',
      verdict: overall >= 65
        ? '副業として始めやすい。フルタイム勤務との両立が現実的です。'
        : '市場は存在しますが、差別化戦略が重要です。',
    },
  });
};

function label(score) {
  if (score >= 80) return '高い';
  if (score >= 60) return '中程度';
  if (score >= 40) return 'やや低い';
  return '低い';
}

function opportunityLabel(score) {
  if (score >= 80) return '非常に高い機会';
  if (score >= 65) return '高い機会';
  if (score >= 50) return '中程度の機会';
  if (score >= 35) return '限定的な機会';
  return '難しい市場';
}
