const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { handleOptions, ok, err } = require("./lib/helpers");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

// Utility to wait between retries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1. Google Trends (Optimized for Tokens) ────────────────────────────────
async function fetchTrendData(keyword) {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) return mockTrendData(keyword);

  try {
    const res = await axios.get("https://serpapi.com/search.json", {
      params: { engine: "google_trends", q: keyword, date: "today 12-m", geo: "JP", api_key: SERPAPI_KEY },
      timeout: 10000,
    });

    const timeline = res.data?.interest_over_time?.timeline_data ?? [];
    if (timeline.length === 0) throw new Error("No data");

    const values = timeline.map(d => Number(d.values?.[0]?.extracted_value ?? 0));
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s, v) => s + v, 0) / 4;

    return {
      keyword,
      score: Math.round(recentAvg),
      trend: recentAvg > avg * 1.1 ? "📈 Rising" : "➡️ Stable",
      rising: (res.data?.related_queries?.rising || []).slice(0, 3).map(q => q.query),
    };
  } catch (e) {
    return mockTrendData(keyword);
  }
}

// ── 2. Rakuten (Summarized) ────────────────────────────────────────────────
async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { level: "Unknown" };
  try {
    const r = await axios.get("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 1 },
      timeout: 5000,
    });
    const count = r.data.count || 0;
    return { level: count > 5000 ? "High" : "Moderate", count };
  } catch { return { level: "Low" }; }
}

// ── 3. AI Generation with Retry & Fallback Logic ───────────────────────────
async function generateWithResilience(trendData, rakutenData) {
  // Try 2.0 Flash (fastest), then 1.5 Flash (higher quota often)
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  
  for (const modelName of models) {
    let attempts = 0;
    while (attempts < 2) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
        });

        // Minimized prompt to save Input Tokens
        const prompt = `Keyword: ${trendData.keyword}. Trend: ${trendData.trend}. Market: ${rakutenData.level}. 
        Create a Japanese business plan and Tailwind HTML LP. Return JSON: 
        {"plan": {"title":"", "desc":""}, "html": "..."}`;

        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
      } catch (e) {
        if (e.message.includes("429")) {
          attempts++;
          console.log(`429 on ${modelName}, waiting 15s...`);
          await sleep(15000); // Wait for the quota bucket to refill
          continue;
        }
        throw e;
      }
    }
  }
  throw new Error("All AI models are currently rate-limited. Please try again in a minute.");
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const keyword = req.query.keyword?.trim() || "副業";

  try {
    const [trend, rakuten] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword)
    ]);

    const aiResult = await generateWithResilience(trend, rakuten);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return ok(res, { trend, rakuten, ai: aiResult });

  } catch (e) {
    const isQuota = e.message.includes("rate-limited");
    return err(res, isQuota ? 429 : 500, e.message);
  }
};

function mockTrendData(keyword) {
  return { keyword, score: 50, trend: "➡️ Stable", rising: [] };
}
