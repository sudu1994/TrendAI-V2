const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { handleOptions, ok, err } = require("./lib/helpers");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

// ── 1. Google Trends (SerpAPI) ──────────────────────────────────────────────
async function fetchTrendData(keyword) {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) return mockTrendData(keyword);

  try {
    const res = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_trends",
        q: keyword,
        date: "today 12-m",
        geo: "JP",
        hl: "ja",
        api_key: SERPAPI_KEY,
      },
      timeout: 10000,
    });

    const timeline = res.data?.interest_over_time?.timeline_data ?? [];
    if (timeline.length === 0) throw new Error("No trend data found.");

    const values = timeline.map(d => ({
      date: d.date,
      value: Number(d.values?.[0]?.extracted_value ?? 0),
    }));

    const avg = values.reduce((s, d) => s + d.value, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s, d) => s + d.value, 0) / Math.max(values.slice(-4).length, 1);
    
    const trend = recentAvg > avg * 1.1 ? "📈 上昇中" : recentAvg < avg * 0.9 ? "📉 下降中" : "➡️ 安定";

    return {
      keyword,
      avg: Math.round(avg),
      recentAvg: Math.round(recentAvg),
      score: Math.round(recentAvg),
      trend,
      rising: (res.data?.related_queries?.rising || []).slice(0, 5).map(q => q.query),
      top: (res.data?.related_queries?.top || []).slice(0, 5).map(q => q.query),
    };
  } catch (e) {
    console.error("SerpAPI Error:", e.message);
    return mockTrendData(keyword);
  }
}

// ── 2. Rakuten Market Data ──────────────────────────────────────────────────
async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { mock: true, demandSignal: { level: "不明", itemCount: 0 } };

  try {
    const r = await axios.get("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 5, sort: "-reviewCount" },
      timeout: 8000,
    });

    const itemCount = r.data.count || 0;
    const level = itemCount > 10000 ? "非常に高い" : itemCount > 3000 ? "高い" : "中程度";

    return { mock: false, demandSignal: { itemCount, level } };
  } catch (e) {
    return { mock: true, demandSignal: { level: "エラー", itemCount: 0 } };
  }
}

// ── 3. YouTube Signal Data ──────────────────────────────────────────────────
async function fetchYouTubeData(keyword) {
  const YT_KEY = process.env.YOUTUBE_API_KEY;
  if (!YT_KEY) return { mock: true, totalResults: 0 };

  try {
    const r = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: { part: "snippet", q: keyword, type: "video", regionCode: "JP", maxResults: 1, key: YT_KEY },
      timeout: 8000,
    });
    return { mock: false, totalResults: r.data.pageInfo?.totalResults || 0 };
  } catch (e) {
    return { mock: true, totalResults: 0 };
  }
}

// ── 4. AI Generation with Fallback ──────────────────────────────
async function generateAIPayload(trendData, rakutenData, youtubeData) {
  // Try 2.0 Flash first, fallback to 1.5 Flash if 429 occurs
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  let lastError;

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      });

      const prompt = `
        キーワード: "${trendData.keyword}"
        分析データ: トレンド ${trendData.trend} (スコア ${trendData.score}), 楽天需要 ${rakutenData.demandSignal.level}, YouTube関連数 ${youtubeData.totalResults}
        
        任務: 上記データを基に、具体的で斬新なビジネスプランと、Tailwind CSS + Alpine.jsを使用した1枚のモダンなLP（HTML）を生成してください。
        
        制約事項:
        1. 必ず有効なJSON形式で返却すること。
        2. websiteHTMLは <!DOCTYPE html> から始まる完全なコードであること。
        3. 日本語で出力すること。

        返却JSON構造:
        {
          "businessPlan": { "title": "", "opportunity": "", "target": "", "service": "", "revenueModel": "" },
          "websiteHTML": ""
        }
      `;

      const result = await model.generateContent(prompt);
      return JSON.parse(result.response.text());
    } catch (e) {
      lastError = e;
      if (e.message.includes("429")) continue; // Try next model
      throw e;
    }
  }
  throw lastError;
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword?.trim() || "副業";

  try {
    const [trend, rakuten, youtube] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYouTubeData(keyword),
    ]);

    const aiResult = await generateAIPayload(trend, rakuten, youtube);

    // Caching for Vercel Edge
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return ok(res, {
      success: true,
      data: { trend, rakuten, youtube },
      ai: aiResult
    });

  } catch (e) {
    console.error("Critical Error:", e);
    // If we hit a total 429, tell the user to wait
    const status = e.message.includes("429") ? 429 : 500;
    return err(res, status, e.message || "内部エラーが発生しました。");
  }
};

function mockTrendData(keyword) {
  return { keyword, mock: true, trend: "➡️ 安定", score: 50, rising: [], top: [] };
}
