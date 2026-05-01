/**
 * api/learn.js — Learning Loop: reads Sheets history, extracts patterns,
 * returns a "knowledge context" object that other endpoints inject into prompts.
 *
 * GET /api/learn          → returns pattern summary (cached 1h)
 * POST /api/learn         → triggers a full re-analysis of sheet history
 *
 * Flow:
 *  1. Fetch raw rows from Google Sheets (via SHEETS_URL)
 *  2. Extract winning patterns (score≥70 keywords, top intents, best ARR combos)
 *  3. Ask Groq to synthesize patterns into a "market intelligence brief"
 *  4. Return the brief — consumed by /api/analyze and /api/ideas
 */

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const SHEETS_URL = process.env.SHEETS_URL || '';
const GROQ_KEY   = process.env.GROQ_API_KEY || '';

// In-memory cache (resets per cold start — good enough for serverless)
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Fetch history from Sheets ────────────────────────────────────────────────
async function fetchSheetHistory() {
  if (!SHEETS_URL) return { ideas: [], signals: [], validation: [] };
  try {
    const r = await axios.get(SHEETS_URL + '?type=dump', { timeout: 10000 });
    return r.data || {};
  } catch (e) {
    console.warn('[learn] Sheet fetch failed:', e.message);
    return { ideas: [], signals: [], validation: [] };
  }
}

// ─── Extract patterns from raw rows ──────────────────────────────────────────
function extractPatterns(history) {
  const ideas = Array.isArray(history.ideas) ? history.ideas : [];
  if (!ideas.length) return null;

  // Winners = score ≥ 70
  const winners = ideas.filter(r => Number(r.score) >= 70);
  const losers  = ideas.filter(r => Number(r.score) < 50);

  // Intent distribution among winners
  const intentCounts = {};
  winners.forEach(r => {
    const i = r.intent || 'hybrid';
    intentCounts[i] = (intentCounts[i] || 0) + 1;
  });
  const topIntent = Object.entries(intentCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || 'hybrid';

  // Top scoring keywords
  const topKeywords = [...ideas]
    .sort((a,b) => Number(b.score) - Number(a.score))
    .slice(0, 10)
    .map(r => ({ keyword: r.keyword, score: Number(r.score), intent: r.intent, arr: r.arr_estimate }));

  // Score distribution
  const scores = ideas.map(r => Number(r.score)).filter(s => !isNaN(s));
  const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
  const maxScore = scores.length ? Math.max(...scores) : 0;

  // Common patterns in high scorers
  const winnerKeywords = winners.map(r => r.keyword || '').join(' ');
  const hasEnterpriseWins = /AI|SaaS|DX|自動化|システム/.test(winnerKeywords);
  const hasConsumerWins   = /ダイエット|美容|食|ペット|旅行/.test(winnerKeywords);
  const hasFinanceWins    = /投資|副業|稼ぐ|FX|資産/.test(winnerKeywords);

  return {
    totalSearches: ideas.length,
    winnerCount: winners.length,
    loserCount: losers.length,
    winRate: ideas.length ? Math.round(winners.length / ideas.length * 100) : 0,
    avgScore,
    maxScore,
    topIntent,
    intentCounts,
    topKeywords,
    marketSignals: {
      enterprise: hasEnterpriseWins,
      consumer: hasConsumerWins,
      finance: hasFinanceWins,
    },
    winnerKeywordSample: winners.slice(0, 5).map(r => r.keyword),
    loserKeywordSample:  losers.slice(0, 5).map(r => r.keyword),
  };
}

// ─── Ask Groq to synthesize patterns into actionable intelligence ─────────────
async function synthesizeIntelligence(patterns) {
  if (!GROQ_KEY || !patterns) return null;
  try {
    const prompt = `あなたは日本市場のベンチャーアナリストです。
以下のキーワードバリデーションデータから市場インテリジェンスを生成してください。

【データ】
- 総検索数: ${patterns.totalSearches}件
- 勝者(スコア≥70): ${patterns.winnerCount}件 (勝率 ${patterns.winRate}%)
- 平均スコア: ${patterns.avgScore}/100
- 最高スコア: ${patterns.maxScore}/100
- 最多インテント: ${patterns.topIntent}
- 高スコアキーワード例: ${patterns.winnerKeywordSample.join('、')}
- 低スコアキーワード例: ${patterns.loserKeywordSample.join('、')}
- トップキーワード: ${patterns.topKeywords.slice(0,5).map(k=>`${k.keyword}(${k.score}点)`).join('、')}
- エンタープライズ勝者: ${patterns.marketSignals.enterprise ? 'あり' : 'なし'}
- コンシューマー勝者: ${patterns.marketSignals.consumer ? 'あり' : 'なし'}
- 金融系勝者: ${patterns.marketSignals.finance ? 'あり' : 'なし'}

このデータから以下をJSONのみで返してください（マークダウン不要）:
{
  "market_brief": "2-3文の市場サマリー",
  "winning_pattern": "勝者に共通するパターンの説明",
  "avoid_pattern": "スコアが低かったパターンの説明",
  "predicted_winners": [
    {"keyword": "未検索だが高スコア予測のキーワード", "reason": "理由", "predicted_score": 85}
  ],
  "generated_ideas": [
    {
      "name": "ビジネス名",
      "keyword": "コアキーワード",
      "category": "カテゴリ",
      "why_now": "なぜ今このタイミングか",
      "target": "ターゲット",
      "model": "収益モデル",
      "arr_estimate": "¥XXXm",
      "confidence": 87,
      "based_on": "どのパターンから導いたか"
    }
  ],
  "learning_summary": "システムが今回学習した内容の1文要約"
}`;

    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    const raw = res.data?.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```[\w]*\n?/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.warn('[learn] Groq synthesis failed:', e.message);
    return null;
  }
}

// ─── Main exported knowledge getter (used by analyze + ideas) ─────────────────
async function getKnowledgeContext(forceRefresh = false) {
  if (!forceRefresh && _cache && Date.now() - _cacheTs < CACHE_TTL) {
    return _cache;
  }

  const history = await fetchSheetHistory();
  const patterns = extractPatterns(history);
  const intelligence = await synthesizeIntelligence(patterns);

  const context = {
    hasHistory: !!(patterns && patterns.totalSearches > 0),
    patterns,
    intelligence,
    generatedAt: new Date().toISOString(),
    dataPoints: patterns?.totalSearches || 0,
  };

  _cache = context;
  _cacheTs = Date.now();
  return context;
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const force = req.method === 'POST' || req.query.refresh === '1';

  try {
    const ctx = await getKnowledgeContext(force);
    return ok(res, ctx);
  } catch (e) {
    return err(res, 500, e.message);
  }
};

module.exports.getKnowledgeContext = getKnowledgeContext;
