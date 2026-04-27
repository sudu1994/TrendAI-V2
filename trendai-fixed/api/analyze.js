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
  if (!APP_ID) return {
    mock: true,
    demandSignal: { level: "Unknown", itemCount: 0, avgPrice: 0, totalReviews: 0 },
  };
  try {
    const r = await axios.get("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 1 },
      timeout: 5000,
    });
    const count = r.data.count || 0;
    const item = r.data.Items?.[0]?.Item || {};
    const avgPrice = item.itemPrice || 0;
    const totalReviews = item.reviewCount || 0;
    return {
      mock: false,
      demandSignal: {
        level: count > 5000 ? "High" : count > 1000 ? "Moderate" : "Low",
        itemCount: count,
        avgPrice,
        totalReviews,
      },
    };
  } catch {
    return {
      mock: true,
      demandSignal: { level: "Low", itemCount: 0, avgPrice: 0, totalReviews: 0 },
    };
  }
}

// ── 3. AI Generation via Groq ───────────────────────────────────────────────
async function generateWithResilience(trendData, rakutenData) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    console.warn("No GROQ_API_KEY found, using mock AI response.");
    return mockAIResult(trendData);
  }

  const demandLevel = rakutenData?.demandSignal?.level || "Unknown";
  const prompt = `You are an expert Japanese web designer and business strategist.

Keyword: ${trendData.keyword}
Trend: ${trendData.trend}
Market demand: ${demandLevel}

Task: Create a compelling Japanese business plan AND a stunning complete HTML landing page.

Return ONLY raw JSON. No markdown, no backticks, no explanation.

Format: {"plan":{"title":"string","tagline":"string","opportunity":"string","target":"string","service":"string","differentiation":["string","string","string"],"revenueModel":"string","actionPlan":["string","string","string"],"seoKeywords":["string","string","string","string"],"risk":"string"},"html":"string"}

For the html field create a COMPLETE beautiful modern single-page site with inline CSS only (no Tailwind):
1. HERO: dark gradient background (#0f0c29 to #302b63), large bold Japanese headline, subheadline, glowing green CTA button, subtle animated gradient
2. PROBLEM section: 3 cards each showing a pain point this keyword solves, dark card background #161b22, border #30363d
3. FEATURES section: 3-4 feature cards with large emoji icons, feature name, short description, hover lift effect
4. PRICING section: 3 tiers (フリー / スタンダード / プロ) - middle card highlighted with accent color border and "人気" badge
5. TESTIMONIALS: 3 realistic Japanese customer quotes with colored circle avatars (initials), star ratings
6. FOOTER: company name, nav links, copyright 2025
Design rules: background #0d1117, cards #161b22, accent #00e5a0, text white/#e6edf3, muted #8b949e
All CSS inline via style attributes. All text Japanese. Make it look premium and real.
Escape all double quotes in HTML as needed for valid JSON string.`;

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
