const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { handleOptions, ok, err } = require("./lib/helpers");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

// ── Google Trends (SerpAPI) ──────────────────────────────────────────────────
async function fetchTrendData(keyword) {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) {
    return {
      keyword, mock: true,
      values: Array.from({ length: 12 }, (_, i) => ({
        date: `2025-${String(i + 1).padStart(2, "0")}-01`,
        value: 40 + Math.floor(Math.random() * 45),
      })),
      avg: 62, recentAvg: 70, score: 70,
      trend: "📈 上昇中", rising: [], top: [],
    };
  }

  const params = {
    engine: "google_trends", q: keyword,
    date: "today 12-m", geo: "JP", hl: "ja",
    api_key: SERPAPI_KEY,
  };
  const res = await axios.get("https://serpapi.com/search.json", { params, timeout: 10000 });
  const timeline = res.data?.interest_over_time?.timeline_data ?? [];
  if (timeline.length === 0) throw new Error("トレンドデータが見つかりませんでした。");

  const values = timeline.map(d => ({
    date: d.date,
    value: Number(d.values?.[0]?.extracted_value ?? 0),
  }));
  const avg = values.reduce((s, d) => s + d.value, 0) / values.length;
  const recent = values.slice(-4);
  const recentAvg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const trend = recentAvg > avg * 1.1 ? "📈 上昇中" :
    recentAvg < avg * 0.9 ? "📉 下降中" : "➡️ 安定";
  const rising = res.data?.related_queries?.rising?.slice(0, 5).map(q => q.query) ?? [];
  const top = res.data?.related_queries?.top?.slice(0, 5).map(q => q.query) ?? [];

  return { keyword, values, avg: Math.round(avg), recentAvg: Math.round(recentAvg), score: Math.round(recentAvg), trend, rising, top };
}

// ── Rakuten ──────────────────────────────────────────────────────────────────
async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) {
    return { mock: true, demandSignal: { totalReviews: 14200, avgPrice: 3200, itemCount: 4100, level: "高い" } };
  }
  try {
    const r = await axios.get("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 10, sort: "-reviewCount" },
      timeout: 8000,
    });
    const items = r.data.Items.map(i => ({
      name: i.Item.itemName, price: i.Item.itemPrice,
      reviewCount: i.Item.reviewCount, reviewAverage: i.Item.reviewAverage,
    }));
    const totalReviews = items.reduce((s, i) => s + (i.reviewCount || 0), 0);
    const avgPrice = items.length ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length) : 0;
    const itemCount = r.data.count || 0;
    function demandLevel(reviews, count) {
      if (reviews > 50000 || count > 10000) return "非常に高い";
      if (reviews > 10000 || count > 3000) return "高い";
      if (reviews > 1000 || count > 500) return "中程度";
      return "低い";
    }
    return { mock: false, demandSignal: { totalReviews, avgPrice, itemCount, level: demandLevel(totalReviews, itemCount) }, topItems: items.slice(0, 3) };
  } catch (e) {
    return { mock: true, error: e.message, demandSignal: { totalReviews: 0, avgPrice: 0, itemCount: 0, level: "不明" } };
  }
}

// ── YouTube ──────────────────────────────────────────────────────────────────
async function fetchYouTubeData(keyword) {
  const YT_KEY = process.env.YOUTUBE_API_KEY;
  if (!YT_KEY) {
    return { mock: true, totalResults: 11800, topChannels: [] };
  }
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const r = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: {
        part: "snippet", q: keyword, type: "video",
        regionCode: "JP", relevanceLanguage: "ja",
        order: "viewCount", maxResults: 10,
        publishedAfter: sixMonthsAgo.toISOString(), key: YT_KEY,
      },
      timeout: 8000,
    });
    return {
      mock: false,
      totalResults: r.data.pageInfo?.totalResults || 0,
      topChannels: r.data.items.slice(0, 3).map(v => ({ title: v.snippet.title, channel: v.snippet.channelTitle })),
    };
  } catch (e) {
    return { mock: true, error: e.message, totalResults: 0, topChannels: [] };
  }
}

// ── AI Generation ────────────────────────────────────────────────────────────
async function generatePlanAndSite(trendData, rakutenData, youtubeData) {
  const { keyword, trend, score, avg, recentAvg, rising, top } = trendData;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
  });

  const rakutenContext = rakutenData.mock
    ? "楽天データ: 利用不可（RAKUTEN_APP_IDが未設定）"
    : `楽天マーケット需要: 商品数${rakutenData.demandSignal.itemCount}件、平均価格¥${rakutenData.demandSignal.avgPrice}、需要レベル${rakutenData.demandSignal.level}`;

  const ytContext = youtubeData.mock
    ? "YouTubeデータ: 利用不可（YOUTUBE_API_KEYが未設定）"
    : `YouTube検索結果: ${youtubeData.totalResults}件の動画`;

  const systemPrompt = `あなたはTrendBaseAIのアナリストです。GoogleトレンドデータとECデータを元に、ビジネスプランとTailwind CSSを使用したHTMLウェブサイトを日本語で生成します。必ず純粋なJSON形式のみで返答してください。`;

  const userPrompt = `
キーワード: "${keyword}"
トレンド: ${trend} | スコア: ${score} | 年間平均: ${avg} | 直近平均: ${recentAvg}
急上昇ワード: ${rising.join(", ") || "なし"}
関連ワード: ${top.join(", ") || "なし"}
${rakutenContext}
${ytContext}

以下のJSONを生成してください：
{
  "businessPlan": {
    "title": "ビジネス名",
    "tagline": "キャッチコピー",
    "opportunity": "トレンドと市場データに基づくチャンスの理由",
    "target": "顧客像",
    "service": "サービス概要",
    "differentiation": ["P1", "P2", "P3"],
    "seoKeywords": ["W1", "W2", "W3", "W4"],
    "revenueModel": "収益モデル",
    "actionPlan": ["S1", "S2", "S3"],
    "risk": "リスクと対策"
  },
  "websiteHTML": "完全なHTML文書（<!DOCTYPE html>から</html>まで）。Tailwind CDNとAlpine.js CDNを使用すること。全てのボタンがクリック時にアクションを実行するようにJavaScriptを記述すること。外部JSファイルは使わず、1つのHTML内で完結させること。"
}
重要：返答は必ずJSONの閉じカッコ '}' で終了させてください。`;

  const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
  const response = await result.response;
  const fullText = response.text();

  let cleaned = fullText.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  const lastBraceIndex = cleaned.lastIndexOf("}");
  if (lastBraceIndex !== -1) cleaned = cleaned.substring(0, lastBraceIndex + 1);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    throw new Error("AIの応答が正しくありませんでした。");
  }
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword?.trim();
  if (!keyword) return err(res, 400, "キーワードを入力してください。");

  try {
    // Run trend + external APIs in parallel
    const [trendData, rakutenData, youtubeData] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYouTubeData(keyword),
    ]);

    const aiResult = await generatePlanAndSite(trendData, rakutenData, youtubeData);

    return ok(res, {
      trend: trendData,
      rakuten: rakutenData,
      youtube: youtubeData,
      result: aiResult,
    });
  } catch (e) {
    console.error("API Error:", e);
    return err(res, 500, e.message || "内部サーバーエラー");
  }
};
