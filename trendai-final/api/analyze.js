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
    const recentAvg = values.slice(-4).reduce((s, d) => s + d.value, 0) / 4;
    
    const trend = recentAvg > avg * 1.1 ? "📈 上昇中" : recentAvg < avg * 0.9 ? "📉 下降中" : "➡️ 安定";

    return {
      keyword,
      values,
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
      params: { applicationId: APP_ID, format: "json", keyword, hits: 10, sort: "-reviewCount" },
      timeout: 8000,
    });

    const items = (r.data.Items || []).map(i => ({
      name: i.Item.itemName,
      price: i.Item.itemPrice,
      reviewCount: i.Item.reviewCount,
    }));

    const totalReviews = items.reduce((s, i) => s + (i.reviewCount || 0), 0);
    const itemCount = r.data.count || 0;

    const level = itemCount > 10000 ? "非常に高い" : itemCount > 3000 ? "高い" : "中程度";

    return { mock: false, demandSignal: { totalReviews, itemCount, level }, topItems: items.slice(0, 3) };
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
      params: {
        part: "snippet", q: keyword, type: "video", regionCode: "JP",
        maxResults: 5, order: "viewCount", key: YT_KEY,
      },
      timeout: 8000,
    });
    return { mock: false, totalResults: r.data.pageInfo?.totalResults || 0 };
  } catch (e) {
    return { mock: true, totalResults: 0 };
  }
}

// ── 4. AI Generation (Business Plan & Website) ──────────────────────────────
async function generateAIPayload(trendData, rakutenData, youtubeData) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
  });

  const prompt = `
    キーワード: "${trendData.keyword}"
    トレンド状況: ${trendData.trend} (スコア: ${trendData.score})
    市場需要: ${rakutenData.demandSignal.level} (商品数: ${rakutenData.demandSignal.itemCount})
    YouTube関心度: ${youtubeData.totalResults}件のヒット

    上記データを分析し、起業家向けのビジネスプランと、Tailwind CSSを使用した1枚完結のランディングページHTMLを生成してください。
    
    返却形式 (JSON):
    {
      "businessPlan": { "title": "", "opportunity": "", "target": "", "service": "", "revenueModel": "" },
      "websiteHTML": "<!DOCTYPE html>..."
    }
  `;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword?.trim() || "副業";

  try {
    // Phase 1: Fetch all external data in parallel
    const [trend, rakuten, youtube] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYouTubeData(keyword),
    ]);

    // Phase 2: Generate AI response based on that data
    const aiResult = await generateAIPayload(trend, rakuten, youtube);

    // Set Cache for 1 hour to save API credits
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return ok(res, {
      success: true,
      data: { trend, rakuten, youtube },
      ai: aiResult
    });

  } catch (e) {
    console.error("Critical Error:", e);
    return err(res, 500, "生成中にエラーが発生しました。");
  }
};

// Helper for Fallback Data
function mockTrendData(keyword) {
  return {
    keyword, mock: true, trend: "➡️ 安定", score: 50,
    values: [], rising: [], top: []
  };
}
