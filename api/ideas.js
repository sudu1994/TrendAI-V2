/**
 * api/ideas.js — AI Learning Loop + Proactive Idea Generation
 * Reads Sheets history → extracts patterns → generates new ideas autonomously
 * GET /api/ideas          → cached results
 * GET /api/ideas?refresh=1 → force regenerate
 */

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const SHEETS_URL = process.env.SHEETS_URL || '';
const GROQ_KEY   = process.env.GROQ_API_KEY || '';

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60 * 60 * 1000;

// ── 1. Fetch history from Sheets ──────────────────────────────────────────────
async function fetchSheetHistory() {
  if (!SHEETS_URL) return { ideas: [] };
  try {
    const r = await axios.get(SHEETS_URL + '?type=dump', { timeout: 10000 });
    return r.data?.data || r.data || {};
  } catch (e) {
    console.warn('[ideas] Sheet fetch failed:', e.message);
    return { ideas: [] };
  }
}

// ── 2. Extract winning patterns from raw rows ─────────────────────────────────
function extractPatterns(history) {
  const ideas = Array.isArray(history.ideas) ? history.ideas : [];
  if (!ideas.length) return null;

  const winners = ideas.filter(r => Number(r.score) >= 70);
  const losers  = ideas.filter(r => Number(r.score) < 50);

  const intentCounts = {};
  winners.forEach(r => { const i = r.intent||'hybrid'; intentCounts[i]=(intentCounts[i]||0)+1; });
  const topIntent = Object.entries(intentCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'hybrid';

  const topKeywords = [...ideas]
    .sort((a,b) => Number(b.score)-Number(a.score))
    .slice(0,10)
    .map(r => ({ keyword: r.keyword, score: Number(r.score), intent: r.intent }));

  const scores = ideas.map(r => Number(r.score)).filter(s => !isNaN(s));
  const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

  const winnerText = winners.map(r=>r.keyword||'').join(' ');
  return {
    totalSearches: ideas.length,
    winnerCount: winners.length,
    winRate: Math.round(winners.length/ideas.length*100),
    avgScore,
    maxScore: scores.length ? Math.max(...scores) : 0,
    topIntent,
    topKeywords,
    marketSignals: {
      enterprise: /AI|SaaS|DX|自動化|システム/.test(winnerText),
      consumer:   /ダイエット|美容|食|ペット|旅行/.test(winnerText),
      finance:    /投資|副業|稼ぐ|FX|資産/.test(winnerText),
    },
    winnerSample: winners.slice(0,5).map(r=>r.keyword),
    loserSample:  losers.slice(0,5).map(r=>r.keyword),
  };
}

// ── 3. Ask Groq to generate ideas from learned patterns ───────────────────────
async function generateIdeas(patterns) {
  if (!GROQ_KEY) return null;

  const prompt = `あなたは日本市場専門のベンチャーキャピタリストAIです。
以下の学習データから、まだ誰も検索していないが高スコアが予測されるビジネスアイデアを5つ生成してください。

【学習データ】
- 総検索数: ${patterns.totalSearches}件、勝率: ${patterns.winRate}%
- 平均スコア: ${patterns.avgScore}/100、最高: ${patterns.maxScore}/100
- 最多勝利インテント: ${patterns.topIntent}
- 高スコアキーワード例: ${patterns.winnerSample.join('、')}
- 低スコアキーワード例: ${patterns.loserSample.join('、')}
- エンタープライズ勝者: ${patterns.marketSignals.enterprise?'あり':'なし'}
- コンシューマー勝者: ${patterns.marketSignals.consumer?'あり':'なし'}
- 金融系勝者: ${patterns.marketSignals.finance?'あり':'なし'}
今日: ${new Date().toLocaleDateString('ja-JP')}

JSONのみ返してください（マークダウン不要）:
{"market_brief":"市場サマリー2文","winning_pattern":"勝者パターン","avoid_pattern":"敗者パターン","ideas":[{"id":"idea_001","name":"ビジネス名","keyword":"コアキーワード","tagline":"15字キャッチコピー","category":"SaaS|EC|FinTech|AI|Consumer|B2B","why_now":"タイミング根拠","target_customer":"ターゲット","revenue_model":"収益モデル","price_point":"¥X,XXX/月","arr_year1":"¥XXm","arr_year3":"¥XXXm","predicted_validation_score":82,"confidence_level":"high|medium|low","based_on_pattern":"学習パターン","moat":"競合優位性"}]}`;

  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model: 'llama-3.3-70b-versatile', max_tokens: 2500, temperature: 0.75,
      messages: [{ role: 'user', content: prompt }] },
    { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 45000 }
  );
  const raw = res.data?.choices?.[0]?.message?.content || '';
  const clean = raw.replace(/```[\w]*\n?/g, '').trim();
  return JSON.parse(clean);
}

function seedIdeas() {
  return [
    { id:'s1', name:'AIレポーター', keyword:'AI副業', tagline:'AIで稼ぐ副業自動化', category:'AI', why_now:'副業人口急増×AI普及', revenue_model:'¥2,980/月', arr_year1:'¥12m', arr_year3:'¥80m', predicted_validation_score:78, confidence_level:'medium', based_on_pattern:'seed' },
    { id:'s2', name:'ペット予防医療SaaS', keyword:'ペット保険', tagline:'愛犬の健康をAI管理', category:'Consumer', why_now:'ペット産業5兆円規模', revenue_model:'¥1,480/月', arr_year1:'¥8m', arr_year3:'¥55m', predicted_validation_score:71, confidence_level:'medium', based_on_pattern:'seed' },
    { id:'s3', name:'中小企業DXワンストップ', keyword:'DX自動化', tagline:'中小企業のDXを30日で', category:'B2B', why_now:'DX補助金×人材不足', revenue_model:'¥9,800/月', arr_year1:'¥35m', arr_year3:'¥200m', predicted_validation_score:84, confidence_level:'high', based_on_pattern:'seed' },
  ];
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const force = req.query.refresh === '1';

  try {
    if (!force && _cache && Date.now() - _cacheTs < CACHE_TTL) {
      return ok(res, _cache);
    }

    const history  = await fetchSheetHistory();
    const patterns = extractPatterns(history);

    if (!patterns) {
      const result = { source:'seed', ideas: seedIdeas(), learnedFrom:0,
        message:'まだ検索履歴がありません。キーワードを検索するとAIが学習を開始します。' };
      _cache = result; _cacheTs = Date.now();
      return ok(res, result);
    }

    let parsed = null;
    try { parsed = await generateIdeas(patterns); } catch(e) { console.warn('[ideas] Groq failed:', e.message); }

    const result = {
      source: parsed ? 'ai_learned' : 'pattern_only',
      ideas: parsed?.ideas || seedIdeas(),
      marketBrief: parsed?.market_brief || '',
      winningPattern: parsed?.winning_pattern || '',
      avoidPattern: parsed?.avoid_pattern || '',
      learnedFrom: patterns.totalSearches,
      winnersFound: patterns.winnerCount,
      winRate: patterns.winRate,
      topKeywords: patterns.topKeywords,
      generatedAt: new Date().toISOString(),
    };

    _cache = result; _cacheTs = Date.now();
    return ok(res, result);

  } catch (e) {
    return err(res, 500, e.message);
  }
};
