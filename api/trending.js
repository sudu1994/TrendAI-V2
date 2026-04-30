/**
 * api/trending.js — Live JP trending keywords for ticker + suggestions
 *
 * Priority:
 *  1. SerpAPI google_trends_trending_now (JP) — real Google Trends data
 *  2. SerpAPI related queries on a seed keyword — rising searches
 *  3. Groq — generate realistic JP trending business keywords (free fallback)
 *  4. Static seed — absolute last resort
 *
 * Result is cached for 1 hour via Vercel edge cache.
 */

const axios = require('axios');
const { handleOptions, ok } = require('./lib/helpers');

const STATIC_SEED = [
  { keyword: 'AIツール', score: 92 },
  { keyword: '副業', score: 88 },
  { keyword: 'ミールキット', score: 76 },
  { keyword: 'ペットフード', score: 71 },
  { keyword: 'プログラミングスクール', score: 68 },
  { keyword: 'ミニマリスト家具', score: 64 },
  { keyword: 'フリーランス', score: 61 },
  { keyword: 'サブスク', score: 58 },
];

// ── 1. SerpAPI: Google Trends Trending Now (Japan) ─────────────────────────
async function fetchTrendingNow(apiKey) {
  const res = await axios.get('https://serpapi.com/search', {
    params: { engine: 'google_trends_trending_now', frequency: 'daily', geo: 'JP', api_key: apiKey },
    timeout: 10000,
  });
  const searches = res.data?.trending_searches || [];
  if (!searches.length) throw new Error('No trending data');
  return searches.slice(0, 12).map((item, i) => ({
    keyword: item.query || item.title?.query || item.title || '',
    score: Math.max(99 - i * 7, 30),
    traffic: item.formattedTraffic || item.traffic || '',
    source: 'google_trends',
  })).filter(x => x.keyword.length > 1);
}

// ── 2. SerpAPI: Rising queries on broad seed (fallback) ────────────────────
async function fetchRisingQueries(apiKey) {
  const seeds = ['ビジネス', 'AI', '副業'];
  const results = [];
  for (const seed of seeds) {
    try {
      const res = await axios.get('https://serpapi.com/search', {
        params: { engine: 'google_trends', q: seed, date: 'today 1-m', geo: 'JP', api_key: apiKey },
        timeout: 8000,
      });
      const rising = res.data?.related_queries?.rising || [];
      const top = res.data?.related_queries?.top || [];
      [...rising.slice(0, 4), ...top.slice(0, 3)].forEach((q, i) => {
        if (q.query && q.query.length > 1) {
          results.push({ keyword: q.query, score: Math.max(85 - i * 8, 30), source: 'rising' });
        }
      });
    } catch { /* skip this seed */ }
  }
  if (!results.length) throw new Error('No rising queries');
  // dedupe
  const seen = new Set();
  return results.filter(x => { if (seen.has(x.keyword)) return false; seen.add(x.keyword); return true; }).slice(0, 12);
}

// ── 3. Groq: Generate realistic JP trending keywords (free) ────────────────
async function fetchGroqTrending() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('No Groq key');

  const prompt = `You are a Japanese market analyst. Today's date: ${new Date().toISOString().slice(0, 10)}.

List 10 real trending business/consumer keywords in Japan RIGHT NOW.
Focus on: tech, lifestyle, food, beauty, finance, health, entertainment.
These must be specific Japanese-market trends — not generic words.

Return ONLY a raw JSON array, no markdown:
[{"keyword":"キーワード","score":85},{"keyword":"...","score":78}]

Score = estimated Google Trends interest 0-100. Vary the scores realistically.`;

  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model: 'llama-3.3-70b-versatile', max_tokens: 400, temperature: 0.7,
      messages: [{ role: 'user', content: prompt }] },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  const raw = res.data?.choices?.[0]?.message?.content || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Bad Groq response');
  return parsed.map(x => ({ keyword: x.keyword, score: x.score || 70, source: 'groq' }))
    .filter(x => x.keyword && x.keyword.length > 1);
}

// ── Main handler ───────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const SERP_KEY = process.env.SERPAPI_KEY;
  let trending = [];
  let source = 'static';

  try {
    if (SERP_KEY) {
      try {
        trending = await fetchTrendingNow(SERP_KEY);
        source = 'google_trends_now';
      } catch {
        trending = await fetchRisingQueries(SERP_KEY);
        source = 'google_trends_rising';
      }
    } else {
      trending = await fetchGroqTrending();
      source = 'groq';
    }
  } catch {
    trending = STATIC_SEED;
    source = 'static';
  }

  // Always return something
  if (!trending.length) { trending = STATIC_SEED; source = 'static'; }

  // 1-hour cache
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return ok(res, { trending, source, updatedAt: new Date().toISOString() });
};
