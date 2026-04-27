const axios = require("axios");
const { handleOptions, ok, err } = require("./lib/helpers");

// Utility to wait between retries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1. Google Trends ────────────────────────────────────────────────────────
async function fetchTrendData(keyword) {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) return mockTrendData(keyword);

  try {
    const res = await axios.get("https://serpapi.com", {
      params: { engine: "google_trends", q: keyword, date: "today 12-m", geo: "JP", api_key: SERPAPI_KEY },
      timeout: 10000,
    });

    const timeline = res.data?.interest_over_time?.timeline_data ?? [];
    if (timeline.length === 0) throw new Error("No data");

    const values = timeline.map((d) => Number(d.values?.[0]?.extracted_value ?? 0));
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s, v) => s + v, 0) / 4;

    return {
      keyword,
      score: Math.round(recentAvg),
      avg: Math.round(avg),
      recentAvg: Math.round(recentAvg),
      trend: recentAvg > avg * 1.1 ? "📈 Rising" : "➡️ Stable",
      rising: (res.data?.related_queries?.rising || []).slice(0, 3).map((q) => q.query),
      values: timeline.map((d) => ({
        date: d.date,
        value: Number(d.values?.[0]?.extracted_value ?? 0),
      })),
    };
  } catch (e) {
    return mockTrendData(keyword);
  }
}

// ── 2. Rakuten ──────────────────────────────────────────────────────────────
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

// ── 3. AI Generation via Groq ───────────────────────────────────────────────
async function generateWithResilience(trendData, rakutenData) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    console.warn("No GROQ_API_KEY found, using mock AI response.");
    return mockAIResult(trendData);
  }

  const prompt = `Keyword: ${trendData.keyword}. Trend: ${trendData.trend}. Market: ${rakutenData.level}.
Task: Create a Japanese business plan and a modern Tailwind HTML Landing Page.
Requirements:
1. Return ONLY a valid JSON object with no markdown, no backticks, no extra text.
2. Format: {"plan": {"title": "string", "tagline": "string", "opportunity": "string", "target": "string", "service": "string", "differentiation": ["string"], "revenueModel": "string", "actionPlan": ["string"], "seoKeywords": ["string"], "risk": "string"}, "html": "string"}
3. The "html" field must be a valid JSON string (escape all double quotes inside the HTML).
4. The HTML should be a complete, styled landing page using Tailwind CDN.`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama-3.3-70b-versatile",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GROQ_API_KEY}`,
          },
          timeout: 60000,
        }
      );

      const responseText = response.data?.choices?.[0]?.message?.content ?? "";
      const cleanJson = responseText.replace(/^```json\n?|```$/g, "").trim();
      return JSON.parse(cleanJson);

    } catch (e) {
      const status = e.response?.status;
      if (status === 429 || e.code === "ECONNABORTED") {
        attempts++;
        console.log(`Groq API rate-limited/timeout. Retry ${attempts}/3 in 10s...`);
        await sleep(10000);
        continue;
      }
      console.error("Groq API error:", e.message);
      throw new Error(`AI generation failed: ${e.message}`);
    }
  }

  throw new Error("Groq API is temporarily unavailable after retries. Please try again shortly.");
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const keyword = (req.query.keyword || "").trim() || "副業";

  try {
    const [trend, rakuten] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
    ]);

    const aiResult = await generateWithResilience(trend, rakuten);

    const youtube = { mock: true, totalResults: 0, topChannels: [] };
    const result = {
      businessPlan: aiResult.plan || null,
      websiteHTML: aiResult.html || null,
    };
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return ok(res, { trend, rakuten, youtube, result });

  } catch (e) {
    const isQuota = e.message.includes("rate-limited") || e.message.includes("unavailable");
    return err(res, isQuota ? 429 : 500, e.message);
  }
};

function mockTrendData(keyword) {
  const values = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(Date.now() - (11 - i) * 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 7).replace("-", "/"),
    value: Math.round(40 + Math.random() * 30),
  }));
  const avg = Math.round(values.reduce((s, v) => s + v.value, 0) / values.length);
  const recentAvg = Math.round(values.slice(-4).reduce((s, v) => s + v.value, 0) / 4);
  return { keyword, score: recentAvg, avg, recentAvg, trend: "➡️ Stable", rising: [], values };
}

function mockAIResult(trendData) {
  return {
    plan: {
      title: `${trendData.keyword} ビジネスプラン`,
      tagline: "AIキーを設定すると詳細プランが生成されます",
      opportunity: "AIキーを設定すると、リアルタイムのビジネスプランが生成されます。",
      target: "設定後に表示されます",
      service: "設定後に表示されます",
      differentiation: [],
      revenueModel: "設定後に表示されます",
      actionPlan: [],
      seoKeywords: [],
      risk: "設定後に表示されます",
    },
    html: `<div class="p-8 text-center"><h1 class="text-2xl font-bold">${trendData.keyword}</h1><p class="mt-4 text-gray-500">Set GROQ_API_KEY to enable AI generation.</p></div>`,
  };
}
