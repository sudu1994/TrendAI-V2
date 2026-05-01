/**
 * api/ideas.js — AI-Generated Proactive Ideas
 *
 * The system reads its own Sheets history, learns what keywords/markets
 * score high in Japan, and proactively generates new ideas it PREDICTS
 * would score well — even without the user searching them.
 *
 * GET /api/ideas          → returns AI-generated idea list (cached 1h)
 * GET /api/ideas?refresh=1 → forces re-generation
 *
 * This is the "learning output" — what the model has figured out on its own.
 */

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');
const { getKnowledgeContext } = require('./learn');

const GROQ_KEY = process.env.GROQ_API_KEY || '';

let _ideaCache = null;
let _ideaCacheTs = 0;
const CACHE_TTL = 60 * 60 * 1000;

async function generateProactiveIdeas(ctx) {
  if (!ctx.hasHistory || !ctx.intelligence) {
    // No history yet — return seed ideas with clear labeling
    return {
      source: 'seed',
      message: 'まだ検索履歴がありません。キーワードを検索するとAIが学習を開始します。',
      ideas: getSeedIdeas(),
      learnedFrom: 0,
    };
  }

  const intel = ctx.intelligence;
  const patterns = ctx.patterns;

  if (!GROQ_KEY) {
    return {
      source: 'pattern_only',
      ideas: intel.generated_ideas || [],
      patterns: intel,
      learnedFrom: patterns.totalSearches,
    };
  }

  // Generate a deeper set of ideas using full learned context
  try {
    const prompt = `あなたは日本市場専門のベンチャーキャピタリストAIです。
過去の検索・バリデーションデータから学習し、まだ誰も検索していないが高スコアが予測されるビジネスアイデアを独自に生成してください。

【学習済み市場インテリジェンス】
${intel.market_brief}

【勝者パターン】
${intel.winning_pattern}

【避けるべきパターン】
${intel.avoid_pattern}

【実績データ】
- ${patterns.totalSearches}件の検索から学習
- 勝率: ${patterns.winRate}%
- 最高スコアキーワード: ${patterns.topKeywords?.[0]?.keyword}(${patterns.topKeywords?.[0]?.score}点)

今日の日付: ${new Date().toLocaleDateString('ja-JP')}

上記の学習内容に基づき、AIが自律的に発見した5つのビジネスアイデアをJSONのみで返してください:
{
  "ideas": [
    {
      "id": "idea_001",
      "name": "ビジネス名",
      "keyword": "コアキーワード（日本語）",
      "tagline": "15字以内のキャッチコピー",
      "category": "SaaS|EC|FinTech|AI|Consumer|B2B",
      "why_this_market": "学習データから導いた理由（2文）",
      "why_now": "タイミングの根拠",
      "target_customer": "具体的なターゲット",
      "problem": "解決する課題",
      "solution": "ソリューション",
      "revenue_model": "収益モデル",
      "price_point": "¥X,XXX/月",
      "arr_year1": "¥XXm",
      "arr_year3": "¥XXXm",
      "predicted_validation_score": 82,
      "confidence_level": "high|medium|low",
      "based_on_pattern": "どの学習パターンから",
      "risks": ["リスク1", "リスク2"],
      "moat": "競合優位性"
    }
  ],
  "generation_context": {
    "data_points_used": ${patterns.totalSearches},
    "dominant_market": "${patterns.topIntent}",
    "learning_iteration": 1
  }
}`;

    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 3000,
        temperature: 0.75,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 45000,
      }
    );

    const raw = res.data?.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```[\w]*\n?/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      source: 'ai_learned',
      ideas: parsed.ideas || [],
      generationContext: parsed.generation_context,
      marketBrief: intel.market_brief,
      learnedFrom: patterns.totalSearches,
      winnersFound: patterns.winnerCount,
      learningIteration: Math.floor(patterns.totalSearches / 10) + 1,
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[ideas] Groq generation failed:', e.message);
    return {
      source: 'fallback',
      ideas: intel.generated_ideas || getSeedIdeas(),
      learnedFrom: patterns.totalSearches,
      error: e.message,
    };
  }
}

function getSeedIdeas() {
  return [
    { id:'seed_001', name:'AIレポーター', keyword:'AI副業', tagline:'AIで稼ぐ副業自動化', category:'AI', why_now:'副業人口急増×AI普及', revenue_model:'¥2,980/月', predicted_validation_score:78, confidence_level:'medium', based_on_pattern:'seed' },
    { id:'seed_002', name:'ペット予防医療SaaS', keyword:'ペット保険', tagline:'愛犬の健康をAI管理', category:'Consumer', why_now:'ペット産業5兆円規模', revenue_model:'¥1,480/月', predicted_validation_score:71, confidence_level:'medium', based_on_pattern:'seed' },
    { id:'seed_003', name:'中小企業DXワンストップ', keyword:'DX自動化', tagline:'中小企業のDXを30日で', category:'B2B', why_now:'DX補助金×人材不足', revenue_model:'¥9,800/月', predicted_validation_score:84, confidence_level:'high', based_on_pattern:'seed' },
  ];
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const force = req.query.refresh === '1';

  try {
    if (!force && _ideaCache && Date.now() - _ideaCacheTs < CACHE_TTL) {
      return ok(res, _ideaCache);
    }

    const ctx = await getKnowledgeContext(false);
    const result = await generateProactiveIdeas(ctx);

    _ideaCache = result;
    _ideaCacheTs = Date.now();

    return ok(res, result);
  } catch (e) {
    return err(res, 500, e.message);
  }
};
