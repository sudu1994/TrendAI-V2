/**
 * api/analyze.js — SSI-AI Corporate Edition — FIXED VERSION
 */

const axios = require('axios');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper functions
function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
    res.status(200).end();
    return true;
  }
  return false;
}

function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(data);
}

function err(res, code, msg) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(code).json({ error: msg });
}

// Budget tracking
const BK = 'ssi_budget_v2';
const BCAP = 3000;

function getBudget() {
  if (typeof localStorage === 'undefined') return { spend: 0, searches: 0 };
  try {
    return JSON.parse(localStorage.getItem(BK) || '{"spend":0,"searches":0}');
  } catch {
    return { spend: 0, searches: 0 };
  }
}

function saveBudget(b) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BK, JSON.stringify(b));
  }
}

function checkBudget() {
  const b = getBudget();
  const allowed = b.spend < BCAP;
  return {
    allowed,
    totalSpendJpy: b.spend,
    remainingJpy: Math.max(0, BCAP - b.spend),
    searches: b.searches
  };
}

function trackUsage(userId, action, cost = 45) {
  const b = getBudget();
  b.spend = (b.spend || 0) + cost;
  b.searches = (b.searches || 0) + 1;
  saveBudget(b);
  console.log(`[TRACK] User: ${userId}, Action: ${action}, Cost: ¥${cost}, Total: ¥${b.spend}`);
}

// Validator
const THRESHOLD = 70;

function classifyIntent(k) {
  const kw = k || '';
  if (/自動化|SaaS|業務|管理|システム|AI|DX|クラウド|分析|効率|請求|勤怠|在庫|CRM|ERP/.test(kw)) return 'enterprise';
  if (/投資|株|FX|仮想通貨|資産|節税|副業|稼ぐ|収入/.test(kw)) return 'financial';
  if (/動画|YouTube|配信|ブログ|SNS|クリエイター/.test(kw)) return 'content';
  if (/食|グルメ|ファッション|美容|旅行|ペット|ダイエット|健康/.test(kw)) return 'consumer';
  return 'hybrid';
}

function estimateMockScores(kw, i) {
  const h = /AI|副業|フリーランス|ダイエット|転職|資産運用|自動化|ECサイト|SaaS/.test(kw);
  const m = /ミールキット|ペットフード|プログラミング|英語|ヨガ|サブスク/.test(kw);
  let b = h ? 74 : m ? 61 : 50;
  if (i === 'enterprise') b += 10;
  return {
    trendPts: Math.min(35, Math.round(b * 0.35)),
    rakutenPts: Math.min(30, Math.round(b * 0.28)),
    ytPts: Math.min(20, Math.round(b * 0.18)),
    yahooPts: Math.min(15, Math.round(b * 0.14))
  };
}

function computeValidationScore(trend, rakuten, youtube, yahoo) {
  const kw = trend?.keyword || '';
  const i = classifyIntent(kw);
  const isMock = !!(rakuten?.mock && youtube?.mock);
  
  let s = 0;
  const b = {};

  if (isMock) {
    const e = estimateMockScores(kw, i);
    s = e.trendPts + e.rakutenPts + e.ytPts + e.yahooPts;
    b.googleTrend = { raw: trend?.recentAvg ?? 0, points: e.trendPts, max: 35, note: 'estimated' };
    b.rakutenDemand = { raw: '推定', points: e.rakutenPts, max: 30, note: 'estimated' };
    b.youtubeVolume = { raw: '推定', points: e.ytPts, max: 20, note: 'estimated' };
    b.yahooShopping = { raw: yahoo?.totalHits ?? 0, points: e.yahooPts, max: 15 };
  } else {
    const tp = Math.min(35, Math.round((trend?.recentAvg ?? 0) * 0.35));
    s += tp;
    b.googleTrend = { raw: trend?.recentAvg ?? 0, points: tp, max: 35 };

    const dm = { '非常に高い': 30, '高い': 24, '中程度': 15, '低い': 6, 'Unknown': 8 };
    const rp = dm[rakuten?.demandSignal?.level] ?? 8;
    s += rp;
    b.rakutenDemand = { raw: rakuten?.demandSignal?.level ?? '—', points: rp, max: 30 };

    const yr = youtube?.totalResults ?? 0;
    const yp = yr > 50000 ? 20 : yr > 10000 ? 15 : yr > 1000 ? 10 : 5;
    s += yp;
    b.youtubeVolume = { raw: yr, points: yp, max: 20 };

    const yh = yahoo?.totalHits ?? 0;
    const yhp = yh > 10000 ? 15 : yh > 3000 ? 11 : yh > 500 ? 7 : 3;
    s += yhp;
    b.yahooShopping = { raw: yh, points: yhp, max: 15 };
  }

  s = Math.max(0, Math.min(100, s));

  return {
    score: s,
    threshold: THRESHOLD,
    unlocksPaidLayer: s >= THRESHOLD,
    breakdown: b,
    intent: i,
    isMockData: isMock,
    verdict: s >= THRESHOLD ? `✅ スコア ${s}/100 — Claude解除` : `🔒 スコア ${s}/100 — あと${THRESHOLD - s}点`
  };
}

// Data fetchers
async function fetchTrendData(keyword) {
  const KEY = process.env.SERPAPI_KEY;
  if (!KEY) return mockTrendData(keyword);
  
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google_trends', q: keyword, date: 'today 12-m', geo: 'JP', api_key: KEY },
      timeout: 10000,
    });
    const timeline = res.data?.interest_over_time?.timeline_data ?? [];
    if (!timeline.length) throw new Error('No trend data');
    
    const values = timeline.map((d) => Number(d.values?.[0]?.extracted_value ?? 0));
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s, v) => s + v, 0) / 4;
    
    return {
      keyword,
      score: Math.round(recentAvg),
      avg: Math.round(avg),
      recentAvg: Math.round(recentAvg),
      trend: recentAvg > avg * 1.1 ? '📈 Rising' : '➡️ Stable',
      rising: (res.data?.related_queries?.rising || []).slice(0, 3).map((q) => q.query),
      top: (res.data?.related_queries?.top || []).slice(0, 3).map((q) => q.query),
      values: timeline.map((d) => ({ date: d.date, value: Number(d.values?.[0]?.extracted_value ?? 0) })),
    };
  } catch (e) {
    console.log('[Trend] Using mock data:', e.message);
    return mockTrendData(keyword);
  }
}

async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { mock: true, demandSignal: { level: '低い', itemCount: 0, avgPrice: 0, totalReviews: 0 } };
  
  try {
    const r = await axios.get('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601', {
      params: { applicationId: APP_ID, format: 'json', keyword, hits: 10, sort: '-reviewCount' },
      timeout: 6000,
    });
    const count = r.data.count || 0;
    const items = (r.data.Items || []).map((i) => i.Item);
    const prices = items.map((i) => i.itemPrice).filter(Boolean);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const totalReviews = items.reduce((s, i) => s + (i.reviewCount || 0), 0);
    
    return {
      mock: false,
      demandSignal: {
        level: count > 5000 ? '高い' : count > 1000 ? '中程度' : '低い',
        itemCount: count,
        avgPrice,
        totalReviews
      },
      topItems: items.slice(0, 3).map((i) => ({
        name: i.itemName?.slice(0, 40),
        price: i.itemPrice,
        reviews: i.reviewCount || 0
      })),
    };
  } catch (e) {
    console.log('[Rakuten] Using mock data:', e.message);
    return { mock: true, demandSignal: { level: '低い', itemCount: 0, avgPrice: 0, totalReviews: 0 } };
  }
}

async function fetchYoutubeData(keyword) {
  const YT_KEY = process.env.YOUTUBE_API_KEY;
  if (!YT_KEY) return { mock: true, totalResults: 0, topVideos: [], keyword };
  
  try {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const search = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: keyword,
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        type: 'video',
        order: 'viewCount',
        publishedAfter: sixMonthsAgo,
        maxResults: 8,
        key: YT_KEY
      },
      timeout: 8000,
    });
    
    const items = search.data.items || [];
    const totalResults = search.data.pageInfo?.totalResults || 0;
    const ids = items.map((i) => i.id.videoId).join(',');
    
    let viewData = {};
    if (ids) {
      const stats = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'statistics', id: ids, key: YT_KEY },
        timeout: 5000,
      });
      stats.data.items?.forEach((v) => {
        viewData[v.id] = parseInt(v.statistics?.viewCount || 0);
      });
    }
    
    const topVideos = items.slice(0, 4).map((i) => ({
      title: i.snippet.title,
      channel: i.snippet.channelTitle,
      published: i.snippet.publishedAt?.slice(0, 10),
      views: viewData[i.id.videoId] || 0,
      videoId: i.id.videoId,
    }));
    
    const avgViews = topVideos.length ? Math.round(topVideos.reduce((s, v) => s + v.views, 0) / topVideos.length) : 0;
    
    return { mock: false, keyword, totalResults, topVideos, avgViews };
  } catch (e) {
    console.log('[YouTube] Using mock data:', e.message);
    return { mock: true, totalResults: 0, topVideos: [], keyword };
  }
}

async function fetchYahooShoppingData(keyword) {
  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  if (!CLIENT_ID) return { mock: true, totalHits: 0, avgPrice: 0, topSellers: [] };
  
  try {
    const r = await axios.get('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch', {
      params: { appid: CLIENT_ID, query: keyword, results: 20, in_stock: true, sort: '-sold' },
      timeout: 6000,
    });
    
    const items = r.data.hits || [];
    const prices = items.map((i) => i.price).filter(Boolean);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    
    return {
      mock: false,
      totalHits: r.data.totalResultsAvailable || 0,
      avgPrice,
      topSellers: items.slice(0, 3).map((i) => ({
        name: i.name?.slice(0, 40),
        price: i.price,
        seller: i.seller?.name
      }))
    };
  } catch (e) {
    console.log('[Yahoo] Using mock data:', e.message);
    return { mock: true, totalHits: 0, avgPrice: 0, topSellers: [] };
  }
}

// Groq generation
async function generateDraftWithGroq(trendData, rakutenData, yahooData) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return mockContent(trendData);

  const prompt = `Japanese business strategist. Keyword: ${trendData.keyword}
Trend: ${trendData.score}/100 (${trendData.trend})
Rakuten: ${rakutenData?.demandSignal?.level}, avg ¥${rakutenData?.demandSignal?.avgPrice}, ${rakutenData?.demandSignal?.itemCount} items
Yahoo: ${yahooData?.totalHits} listings, avg ¥${yahooData?.avgPrice}

Return ONLY raw JSON (no markdown):
{"plan":{"title":"","tagline":"","opportunity":"","target":"","service":"","differentiation":[],"revenueModel":"","actionPlan":[],"seoKeywords":[],"risk":""},"copy":{"heroHeadline":"","heroSub":"","heroCta":"","problems":[{"icon":"","title":"","desc":""}],"features":[{"icon":"","title":"","desc":""}],"pricing":[{"name":"","price":"","period":"","features":[],"cta":"","highlighted":false}],"testimonials":[{"name":"","role":"","initials":"","color":"","stars":5,"text":""}],"companyName":""}}`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          max_tokens: 3000,
          messages: [{ role: 'user', content: prompt }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`
          },
          timeout: 60000
        }
      );
      
      const raw = response.data?.choices?.[0]?.message?.content ?? '';
      const clean = raw.replace(/^```json\n?|```[\s\S]*?$/gm, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      if (e.response?.status === 429 || e.code === 'ECONNABORTED') {
        attempts++;
        await sleep(10000);
        continue;
      }
      console.error('[Groq] Generation failed:', e.message);
      throw e;
    }
  }
  
  throw new Error('Groq API unavailable after retries.');
}

// Claude generation
async function generateSiteWithClaude(keyword, trendData, rakutenData, yahooData, groqCopy) {
  const CORP_KEY = process.env.ANTHROPIC_CORP_KEY;
  if (!CORP_KEY) {
    console.error('[Claude] No ANTHROPIC_CORP_KEY found');
    return null;
  }

  const systemPrompt = `You are a web developer. Output ONLY a single complete HTML file. No markdown, no explanation, no code fences.`;

  const userPrompt = `Build a dark Japanese landing page for: "${keyword}"
Trend: ${trendData.score}/100 ${trendData.trend} | Rakuten: ${rakutenData?.demandSignal?.level} ¥${rakutenData?.demandSignal?.avgPrice} | Yahoo: ${yahooData?.totalHits} listings

Use this Groq-generated copy (do not regenerate content, just render it):
Hero: "${groqCopy?.heroHeadline}" — "${groqCopy?.heroSub}" — CTA: "${groqCopy?.heroCta}"
Company: ${groqCopy?.companyName}

Design rules: bg #0d1117, accent #00e5a0, all CSS inline in <style>, mobile responsive, sticky nav, hero+stats, 3 problem cards, 4 feature cards, 3-tier pricing, 3 testimonials, CTA section, footer.`;

  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5',
        max_tokens: 3500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CORP_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 45000,
      }
    );
    
    const text = r.data?.content?.[0]?.text || '';
    const cleaned = text.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
    console.log('[Claude] Generated', cleaned.length, 'chars');
    return cleaned;
  } catch (e) {
    console.error('[Claude] Site generation error:', e.response?.data || e.message);
    return null;
  }
}

// Main handler
module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = (req.query.keyword || '').trim() || 'AI';
  const forceClaude = req.query.force_claude === '1';
  const userId = req.headers['x-user-id'] || 'anonymous';

  try {
    console.log(`[START] Keyword: ${keyword}, Force Claude: ${forceClaude}`);

    // Phase 1: Free Layer
    const [trend, rakuten, youtube, yahoo] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYoutubeData(keyword),
      fetchYahooShoppingData(keyword),
    ]);

    console.log('[Data] Trend:', trend.score, 'Rakuten:', rakuten.mock ? 'MOCK' : rakuten.demandSignal.level, 'YouTube:', youtube.mock ? 'MOCK' : youtube.totalResults, 'Yahoo:', yahoo.mock ? 'MOCK' : yahoo.totalHits);

    // Groq draft
    let aiContent;
    try {
      aiContent = await generateDraftWithGroq(trend, rakuten, yahoo);
      console.log('[Groq] Generated plan');
    } catch (groqErr) {
      console.error('[Groq] Failed (non-fatal):', groqErr.message);
      aiContent = mockContent(trend);
    }

    // Phase 2: Validation
    const validation = computeValidationScore(trend, rakuten, youtube, yahoo);
    console.log('[Validation] Score:', validation.score, 'Unlocks:', validation.unlocksPaidLayer);

    // Phase 3: Claude (conditional or forced)
    let websiteHTML = null;
    let claudeUsed = false;
    let budgetStatus = checkBudget();

    const shouldUseClaude = forceClaude || validation.unlocksPaidLayer;

    if (shouldUseClaude && budgetStatus.allowed) {
      console.log('[Claude] Attempting generation...');
      websiteHTML = await generateSiteWithClaude(keyword, trend, rakuten, yahoo, aiContent?.copy);
      
      if (websiteHTML) {
        trackUsage(userId, 'website_generation', 45);
        budgetStatus = checkBudget(); // refresh
        claudeUsed = true;
        console.log('[Claude] Success! Budget now:', budgetStatus.totalSpendJpy);
      } else {
        console.log('[Claude] Failed, falling back to Groq HTML');
      }
    } else {
      if (!budgetStatus.allowed) {
        console.log('[Budget] Cap reached, using Groq fallback');
      } else {
        console.log('[Score] Below threshold, using Groq fallback');
      }
    }

    // Groq HTML fallback
    if (!websiteHTML && aiContent?.copy) {
      websiteHTML = buildHTML(aiContent.copy, keyword);
      console.log('[Groq] Generated HTML fallback');
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return ok(res, {
      trend,
      rakuten,
      youtube,
      yahoo,
      validation,
      budgetStatus,
      result: {
        businessPlan: aiContent?.plan || null,
        websiteHTML,
        generatedBy: claudeUsed ? 'claude-haiku' : 'groq-fallback',
      },
    });

  } catch (e) {
    console.error('[ERROR]', e);
    const msg = (e && e.message) ? e.message : 'Unknown server error';
    const isQuota = msg.includes('rate-limited') || msg.includes('unavailable');
    return err(res, isQuota ? 429 : 500, msg);
  }
};

// Groq HTML builder
function buildHTML(copy, keyword) {
  const { heroHeadline, heroSub, heroCta, problems, features, pricing, testimonials, companyName } = copy;

  const problemCards = (problems || []).map((p) => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform .2s,box-shadow .2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,0,0,.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:40px;margin-bottom:16px">${p.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px">${p.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0">${p.desc}</p>
    </div>`).join('');

  const featureCards = (features || []).map((f) => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform .2s,box-shadow .2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,229,160,.1)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:44px;margin-bottom:20px">${f.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px">${f.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0">${f.desc}</p>
    </div>`).join('');

  const pricingCards = (pricing || []).map((p) => `
    <div style="background:${p.highlighted ? 'linear-gradient(135deg,#0d2818,#0d1f2d)' : '#161b22'};border:${p.highlighted ? '2px solid #00e5a0' : '1px solid #30363d'};border-radius:20px;padding:40px 32px;position:relative;transition:transform .2s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
      ${p.highlighted ? '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;font-size:12px;font-weight:800;padding:4px 20px;border-radius:20px;letter-spacing:1px">人 気</div>' : ''}
      <div style="font-size:22px;font-weight:700;color:#e6edf3;margin-bottom:8px">${p.name}</div>
      <div style="margin-bottom:24px"><span style="font-size:42px;font-weight:800;color:${p.highlighted ? '#00e5a0' : '#e6edf3'}">${p.price}</span><span style="color:#8b949e;font-size:14px">${p.period}</span></div>
      <ul style="list-style:none;padding:0;margin:0 0 32px">${(p.features || []).map((f) => `<li style="color:#8b949e;font-size:14px;padding:8px 0;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:10px"><span style="color:#00e5a0">✓</span>${f}</li>`).join('')}</ul>
      <button style="width:100%;padding:14px;background:${p.highlighted ? 'linear-gradient(90deg,#00e5a0,#00b8d4)' : 'transparent'};border:${p.highlighted ? 'none' : '1px solid #30363d'};color:${p.highlighted ? '#0d1117' : '#e6edf3'};border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">${p.cta}</button>
    </div>`).join('');

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heroHeadline} | ${companyName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;background:#0d1117;color:#e6edf3}section{padding:80px 24px}.container{max-width:1100px;margin:0 auto}.g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}@media(max-width:768px){section{padding:48px 16px}.g3,.g4{grid-template-columns:1fr}}</style>
</head><body>
<nav style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(13,17,23,.9);backdrop-filter:blur(12px);border-bottom:1px solid #21262d;padding:0 24px"><div style="max-width:1100px;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between"><div style="font-size:20px;font-weight:800;background:linear-gradient(90deg,#00e5a0,#00b8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${companyName}</div><a href="#pricing" style="background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">${heroCta}</a></div></nav>
<section style="padding:140px 24px 80px;text-align:center;background:linear-gradient(135deg,#0f0c29,#302b63)"><div style="max-width:760px;margin:0 auto"><div style="display:inline-block;background:rgba(0,229,160,.12);border:1px solid rgba(0,229,160,.3);color:#00e5a0;font-size:13px;padding:6px 18px;border-radius:20px;margin-bottom:28px"># ${keyword}</div><h1 style="font-size:clamp(36px,7vw,68px);font-weight:900;line-height:1.15;margin-bottom:20px;background:linear-gradient(135deg,#fff,#a5b4fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${heroHeadline}</h1><p style="font-size:18px;color:#8b949e;margin-bottom:40px">${heroSub}</p><button style="background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;border:none;padding:18px 44px;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer">${heroCta} →</button></div></section>
<section style="background:#0d1117"><div class="container"><h2 style="font-size:36px;font-weight:800;text-align:center;margin-bottom:48px">こんな<span style="color:#00e5a0">お悩み</span>ありませんか？</h2><div class="g3">${problemCards}</div></div></section>
<section id="features" style="background:#0f1419"><div class="container"><h2 style="font-size:36px;font-weight:800;text-align:center;margin-bottom:48px">選ばれる<span style="color:#00e5a0">理由</span></h2><div class="g4">${featureCards}</div></div></section>
<section id="pricing" style="background:#0d1117"><div class="container"><h2 style="font-size:36px;font-weight:800;text-align:center;margin-bottom:48px">料金<span style="color:#00e5a0">プラン</span></h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;align-items:start">${pricingCards}</div></div></section>
<footer style="background:#080c10;border-top:1px solid #21262d;padding:40px 24px;text-align:center;color:#8b949e;font-size:13px">© 2026 ${companyName}. All rights reserved. <span style="font-size:10px;opacity:.5;margin-left:8px">Generated by Groq Llama-3.3</span></footer>
</body></html>`;
}

// Mock functions
function mockTrendData(keyword) {
  const values = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(Date.now() - (11 - i) * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7).replace('-', '/'),
    value: Math.round(40 + Math.random() * 30),
  }));
  const avg = Math.round(values.reduce((s, v) => s + v.value, 0) / values.length);
  const recentAvg = Math.round(values.slice(-4).reduce((s, v) => s + v.value, 0) / 4);
  return { keyword, score: recentAvg, avg, recentAvg, trend: '➡️ Stable', rising: [], top: [], values };
}

function mockContent(trendData) {
  return {
    plan: {
      title: `${trendData.keyword} プラン`,
      tagline: 'GROQ_API_KEYを設定してください',
      opportunity: '—',
      target: '—',
      service: '—',
      differentiation: [],
      revenueModel: '—',
      actionPlan: [],
      seoKeywords: [],
      risk: '—'
    },
    copy: {
      heroHeadline: `${trendData.keyword}で成功する`,
      heroSub: 'GROQ_API_KEYを設定するとAI生成コピーになります',
      heroCta: '無料で始める',
      problems: [
        { icon: '😓', title: '時間がかかりすぎる', desc: '従来の方法では多くの時間を無駄にしています。' },
        { icon: '💸', title: 'コストが高い', desc: '費用対効果が低いです。' },
        { icon: '⏰', title: '成果が出ない', desc: '努力しても結果が出ません。' }
      ],
      features: [
        { icon: '🚀', title: '高速処理', desc: '業界最速。' },
        { icon: '🤖', title: 'AI自動化', desc: '全自動。' },
        { icon: '📊', title: '詳細分析', desc: 'リアルタイム可視化。' },
        { icon: '🔒', title: '安全', desc: '最高水準セキュリティ。' }
      ],
      pricing: [
        { name: 'フリー', price: '¥0', period: '/月', features: ['基本機能', '月5回'], cta: '無料で始める', highlighted: false },
        { name: 'スタンダード', price: '¥2,980', period: '/月', features: ['全機能', '無制限'], cta: '今すぐ始める', highlighted: true },
        { name: 'プロ', price: '¥9,800', period: '/月', features: ['全機能', '専任担当'], cta: 'お問い合わせ', highlighted: false }
      ],
      testimonials: [
        { name: '田中 太郎', role: '会社員 / 東京', initials: '田', color: '#6366f1', stars: 5, text: '収入が3倍になりました。' },
        { name: '佐藤 花子', role: 'フリーランス / 大阪', initials: '佐', color: '#ec4899', stars: 5, text: '誰でも使いこなせます。' },
        { name: '鈴木 一郎', role: '経営者 / 福岡', initials: '鈴', color: '#f59e0b', stars: 5, text: '業務効率が劇的に改善。' }
      ],
      companyName: `${trendData.keyword} AI`,
    },
  };
}
