// GET /api/google-trends?keyword=副業
// Google Trends Japan — via SerpAPI
// Free tier: 100 searches/month (Optimized to 1 credit per request)

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

module.exports = async function handler(req, res) {
  // Handle CORS and preflight requests
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';

  // Fallback to Mock Data if no API Key is found
  if (!SERPAPI_KEY) {
    return ok(res, {
      mock: true,
      setup: 'Sign up free at https://serpapi.com (100 searches/month) → add SERPAPI_KEY to Vercel env vars',
      data: mockTrends(keyword),
    });
  }

  try {
    // Single request to SerpApi (Gets both timeline and related queries)
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_trends',
        q: keyword,
        geo: 'JP',
        date: 'today 12-m', // Last 12 months
        api_key: SERPAPI_KEY,
      },
      timeout: 10000,
    });

    const data = response.data;

    // 1. Process Timeline Data
    const timeline = (data.interest_over_time?.timeline_data || []).map(d => ({
      date: d.date,
      value: d.values?.[0]?.extracted_value || 0,
    }));

    // 2. Process Trend Logic
    const values = timeline.map(t => t.value);
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 50;
    const recentAvg = values.slice(-4).length
      ? values.slice(-4).reduce((s, v) => s + v, 0) / values.slice(-4).length
      : avg;
    
    // Thresholds: +10% for rising, -15% for falling
    const trend = recentAvg > avg * 1.1 ? 'rising' : recentAvg < avg * 0.85 ? 'falling' : 'stable';

    // 3. Process Related Queries (Extracted from the same single request)
    const related = {
      rising: (data.related_queries?.rising || []).slice(0, 5),
      top: (data.related_queries?.top || []).slice(0, 5),
    };

    // 4. Set Vercel Edge Cache (1 hour public cache, serve stale while revalidating)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return ok(res, {
      source: 'google_trends_serpapi',
      keyword,
      geo: 'JP',
      summary: {
        avgInterest: Math.round(avg),
        recentTrend: trend,
        trendLabel: trend === 'rising' ? '上昇中' : trend === 'falling' ? '低下中' : '安定',
        peakValue: values.length ? Math.max(...values) : 0,
      },
      timeline,
      related,
    });

  } catch (e) {
    console.error('SerpApi Error:', e.message);
    // Return mock data on error so the frontend doesn't break
    return err(res, 500, e.message, { 
      mock: true, 
      data: mockTrends(keyword) 
    });
  }
};

/**
 * Fallback data for local development or credit exhaustion
 */
function mockTrends(keyword) {
  return {
    note: 'Mock — Check SERPAPI_KEY or Credits (Free 100/month)',
    keyword,
    summary: { 
      avgInterest: 62, 
      recentTrend: 'rising', 
      trendLabel: '上昇中', 
      peakValue: 100 
    },
    timeline: Array.from({ length: 12 }, (_, i) => ({
      date: `2025-${String(i + 1).padStart(2, '0')}-01`,
      value: 40 + Math.floor(Math.random() * 45),
    })),
    related: { rising: [], top: [] },
  };
}
