/**
 * api/trending.js — Live JP trending keywords for ticker + suggestions
 *
 * Priority:
 *  1. SerpAPI google_trends_trending_now (JP) — real Google Trends data
 *  2. SerpAPI related queries on seed keywords — rising searches  
 *  3. Groq — generate realistic JP trending business keywords (free fallback)
 *  4. Static seed — always works
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

async function fetchTrendingNow(apiKey) {
  const res = await axios.get('https://serpapi.com/search', {
    params: { engine: 'google_trends_trending_now', frequency: 'daily', geo: 'JP', api_key: apiKey },
    timeout: 8000,
  });
  const searches = res.data?.trending_searches || [];
  if (!searches.length) throw new Error('empty');
  return searches.slice(0, 12).map((item, i) => ({
    keyword: item.query || item.title?.query || '',
    score: Math.max(99 - i * 7, 30),
    source: 'google_trends',
  })).filter(x => x.keyword.length > 1);
}

async function fetchRisingQueries(apiKey) {
  const res = await axios.get('https://serpapi.com/search', {
    params: { engine: 'google_trends', q: 'ビジネス', date: 'today 1-m', geo: 'JP', api_key: apiKey },
    timeout: 8000,
  });
  const rising = res.data?.related_queries?.rising || [];
  const top = res.data?.related_queries?.top || [];
  const merged = [...rising.slice(0, 6), ...top.slice(0, 6)]
    .map((q, i) => ({ keyword: q.query || '', score: Math.max(88 - i * 6, 30), source: 'rising' }))
    .filter(x => x.keyword.length > 1);
  if (!merged.length) throw new Error('empty');
  return merged;
}

async function fetchGroqTrending() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no key');
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
      temperature: 0.8,
      messages: [{
        role: 'user',
        content: `${today}時点で日本でトレンドになっているビジネス・消費者向けキーワードを10個リストアップしてください。
テック、ライフスタイル、食品、美容、金融、健康、エンタメのカテゴリから。
具体的で実際に検索されている言葉を使ってください。

JSONのみ返してください（マークダウン不要）:
[{"keyword":"キーワード","score":85},{"keyword":"...","score":78}]`
      }]
    },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 12000 }
  );
  const raw = res.data?.choices?.[0]?.message?.content || '';
  const clean = raw.replace(/```[\w]*\n?/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('bad response');
  return parsed
    .map(x => ({ keyword: String(x.keyword || ''), score: Number(x.score) || 70, source: 'groq' }))
    .filter(x => x.keyword.length > 1)
    .slice(0, 12);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const SERP = process.env.SERPAPI_KEY;
  let trending = [];
  let source = 'static';

  if (SERP) {
    try { trending = await fetchTrendingNow(SERP); source = 'google_trends_now'; }
    catch (e1) {
      console.log('trending_now failed:', e1.message);
      try { trending = await fetchRisingQueries(SERP); source = 'google_trends_rising'; }
      catch (e2) { console.log('rising failed:', e2.message); }
    }
  }

  if (!trending.length) {
    try { trending = await fetchGroqTrending(); source = 'groq'; }
    catch (e3) { console.log('groq failed:', e3.message); }
  }

  if (!trending.length) { trending = STATIC_SEED; source = 'static'; }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return ok(res, { trending, source, count: trending.length, updatedAt: new Date().toISOString() });
};
