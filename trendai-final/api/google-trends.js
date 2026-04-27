const { GoogleGenerativeAI } = require("@google/generative-ai");
const { handleOptions, ok, err } = require('./lib/helpers');

// Using the key you provided
const GENAI_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GENAI_KEY);

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      Perform a search trend analysis for "${keyword}" in Japan.
      Return a JSON object with this exact structure:
      {
        "summary": {
          "avgInterest": number (0-100),
          "recentTrend": "rising" | "falling" | "stable",
          "trendLabel": "上昇中" | "低下中" | "安定",
          "peakValue": number
        },
        "timeline": [{"date": "2024-01-01", "value": number}],
        "related": {
          "top": [string],
          "rising": [string]
        }
      }
      Provide 12 months of monthly data for the timeline.
    `;

    const result = await model.generateContent(prompt);
    const data = JSON.parse(result.response.text());

    // 1-hour cache to save your API quota
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return ok(res, {
      source: 'gemini_api_live',
      keyword,
      ...data
    });

  } catch (e) {
    console.error('Gemini Error:', e.message);
    
    // Automatic Retry Logic for 429 Errors
    if (e.message.includes('429')) {
      return err(res, 429, "Rate limit reached. Please wait 60 seconds.");
    }

    return err(res, 500, "API Failure", { mock: true });
  }
};
