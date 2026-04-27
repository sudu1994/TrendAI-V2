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
    const res = await axios.get("https://serpapi.com", {
      params: { 
        engine: "google_trends", 
        q: keyword, 
        date: "today 12-m", 
        geo: "JP", 
        api_key: SERPAPI_KEY 
      },
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
  if (!APP_ID) return { level: "Unknown", count: 0 };
  try {
    const r = await axios.get("https://rakuten.co.jp", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 1 },
      timeout: 5000,
    });
    const count = r.data.count || 0;
    return { level: count > 5000 ? "High" : "Moderate", count };
  } catch { 
    return { level: "Low", count: 0 }; 
  }
}

// ── 3. AI Generation with Retry & Fallback Logic ───────────────────────────
async function generateWithResilience(trendData, rakutenData) {
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  
  for (const modelName of models) {
    let attempts = 0;
    while (attempts < 2) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { 
            responseMimeType: "application/json", 
            temperature: 0.7,
            maxOutputTokens: 2048 // Ensure enough space for HTML
          },
        });

        // Enhanced prompt to force valid JSON formatting for HTML strings
        const prompt = `Keyword: ${trendData.keyword}. Trend: ${trendData.trend}. Market: ${rakutenData.level}. 
        Task: Create a Japanese business plan and a modern Tailwind HTML Landing Page.
        Requirements:
        1. Return ONLY a JSON object.
        2. Format: {"plan": {"title": "string", "desc": "string"}, "html": "string"}
        3. The "html" field must be a valid JSON string (escape all double quotes inside the HTML).`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // 🚨 CRITICAL FIX: Clean markdown backticks if present
        const cleanJson = responseText.replace(/^```json\n?|```$/g, "").trim();
        
        return JSON.parse(cleanJson);

      } catch (e) {
        if (e.message.includes("429")) {
          attempts++;
          console.log(`Quota reached on ${modelName}, retrying in 15s...`);
          await sleep(15000);
          continue;
        }
        // If it's a JSON parse error, we catch it here to potentially retry
        console.error(`Error with ${modelName}:`, e.message);
        break; // Move to the next model
      }
    }
  }
  throw new Error("All AI models are currently rate-limited or returned invalid data. Please try again.");
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const keyword = (req.query.keyword || "").trim() || "副業";

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
