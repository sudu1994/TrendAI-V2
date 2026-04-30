/**
 * api/analyze.js — SSI-AI Corporate Edition
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  HYBRID FLOW                                             │
 * │  Phase 1 (FREE)  → SerpAPI / Rakuten / YouTube / Yahoo  │
 * │  Phase 2 (GATE)  → Validation Score 0–100               │
 * │  Phase 3 (PAID)  → Claude — ONLY if score ≥ 70          │
 * └──────────────────────────────────────────────────────────┘
 *
 * Corporate API key: ANTHROPIC_CORP_KEY (Vercel env var, never client-exposed)
 * User identity:     x-user-id request header (set by auth middleware / SSO)
 */

const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');
const { checkBudget, trackUsage } = require('./lib/budget');
const { computeValidationScore } = require('./lib/validator');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — FREE LAYER (Groq + external APIs, ¥0 to company)
// ─────────────────────────────────────────────────────────────────────────────

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
      keyword, score: Math.round(recentAvg), avg: Math.round(avg), recentAvg: Math.round(recentAvg),
      trend: recentAvg > avg * 1.1 ? '📈 Rising' : '➡️ Stable',
      rising: (res.data?.related_queries?.rising || []).slice(0, 3).map((q) => q.query),
      top: (res.data?.related_queries?.top || []).slice(0, 3).map((q) => q.query),
      values: timeline.map((d) => ({ date: d.date, value: Number(d.values?.[0]?.extracted_value ?? 0) })),
    };
  } catch { return mockTrendData(keyword); }
}

async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { mock: true, demandSignal: { level: 'Unknown', itemCount: 0, avgPrice: 0, totalReviews: 0 } };
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
      demandSignal: { level: count > 5000 ? '高い' : count > 1000 ? '中程度' : '低い', itemCount: count, avgPrice, totalReviews },
      topItems: items.slice(0, 3).map((i) => ({ name: i.itemName?.slice(0, 40), price: i.itemPrice, reviews: i.reviewCount || 0 })),
    };
  } catch { return { mock: true, demandSignal: { level: '低い', itemCount: 0, avgPrice: 0, totalReviews: 0 } }; }
}

async function fetchYoutubeData(keyword) {
  const YT_KEY = process.env.YOUTUBE_API_KEY;
  if (!YT_KEY) return { mock: true, totalResults: 0, topVideos: [], keyword };
  try {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const search = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q: keyword, regionCode: 'JP', relevanceLanguage: 'ja', type: 'video', order: 'viewCount', publishedAfter: sixMonthsAgo, maxResults: 8, key: YT_KEY },
      timeout: 8000,
    });
    const items = search.data.items || [];
    const totalResults = search.data.pageInfo?.totalResults || 0;
    const ids = items.map((i) => i.id.videoId).join(',');
    let viewData = {};
    if (ids) {
      const stats = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'statistics', id: ids, key: YT_KEY }, timeout: 5000,
      });
      stats.data.items?.forEach((v) => { viewData[v.id] = parseInt(v.statistics?.viewCount || 0); });
    }
    const topVideos = items.slice(0, 4).map((i) => ({
      title: i.snippet.title, channel: i.snippet.channelTitle,
      published: i.snippet.publishedAt?.slice(0, 10), views: viewData[i.id.videoId] || 0, videoId: i.id.videoId,
    }));
    const avgViews = topVideos.length ? Math.round(topVideos.reduce((s, v) => s + v.views, 0) / topVideos.length) : 0;
    return { mock: false, keyword, totalResults, topVideos, avgViews };
  } catch { return { mock: true, totalResults: 0, topVideos: [], keyword }; }
}

async function fetchYahooShoppingData(keyword) {
  const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
  if (!CLIENT_ID) return { mock: true, totalHits: 0, avgPrice: 0, topSellers: [] };
  try {
    const r = await axios.get('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch', {
      params: { appid: CLIENT_ID, query: keyword, results: 20, in_stock: true, sort: '-sold' }, timeout: 6000,
    });
    const items = r.data.hits || [];
    const prices = items.map((i) => i.price).filter(Boolean);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    return { mock: false, totalHits: r.data.totalResultsAvailable || 0, avgPrice, topSellers: items.slice(0, 3).map((i) => ({ name: i.name?.slice(0, 40), price: i.price, seller: i.seller?.name })) };
  } catch { return { mock: true, totalHits: 0, avgPrice: 0, topSellers: [] }; }
}

// Groq — free, used for initial business plan draft (Phase 1)
async function generateDraftWithGroq(trendData, rakutenData, yahooData) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return mockContent(trendData);

  // Compact prompt — minimise tokens while retaining structure
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
        { model: 'llama-3.3-70b-versatile', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 60000 }
      );
      const raw = response.data?.choices?.[0]?.message?.content ?? '';
      const clean = raw.replace(/^```json\n?|```[\s\S]*?$/gm, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      if (e.response?.status === 429 || e.code === 'ECONNABORTED') { attempts++; await sleep(10000); continue; }
      throw new Error(`Groq generation failed: ${e.message}`);
    }
  }
  throw new Error('Groq API unavailable after retries.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — PAID LAYER (Claude via corporate key — gated by score ≥ 70)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateSiteWithClaude
 * Uses the CENTRALIZED corporate Anthropic key (ANTHROPIC_CORP_KEY).
 * Called ONLY when validation.unlocksPaidLayer === true AND budget allows.
 *
 * Optimised prompt targets ~1,200 input + ~2,800 output tokens
 * ≈ Haiku: $0.0003 + $0.0035 = $0.0038 ≈ ¥0.57  (well within ¥10–50 target)
 */
async function generateSiteWithClaude(keyword, trendData, rakutenData, yahooData, groqCopy) {
  const CORP_KEY = process.env.ANTHROPIC_CORP_KEY;
  if (!CORP_KEY) return null;

  // Compact system prompt — saves ~40% tokens vs original
  const systemPrompt = `You are a web developer. Output ONLY a single complete HTML file. No markdown, no explanation, no code fences.`;

  // Pass pre-computed copy from Groq to avoid re-generating — saves tokens
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
        model: 'claude-haiku-4-5',   // Haiku: 5–10× cheaper than Sonnet
        max_tokens: 3500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      {
        headers: { 'Content-Type': 'application/json', 'x-api-key': CORP_KEY, 'anthropic-version': '2023-06-01' },
        timeout: 45000,
      }
    );
    const text = r.data?.content?.[0]?.text || '';
    return text.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
  } catch (e) {
    console.error('Claude site gen error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const keyword = (req.query.keyword || '').trim() || '副業';
  // User identity from header — set by your auth/SSO layer
  const userId = req.headers['x-user-id'] || 'anonymous';

  try {
    // ── PHASE 1: Free Layer — all in parallel ─────────────────────────────
    const [trend, rakuten, youtube, yahoo] = await Promise.all([
      fetchTrendData(keyword),
      fetchRakutenData(keyword),
      fetchYoutubeData(keyword),
      fetchYahooShoppingData(keyword),
    ]);

    // Groq draft (free)
    const aiContent = await generateDraftWithGroq(trend, rakuten, yahoo);

    // ── PHASE 2: Gatekeeper — compute validation score ────────────────────
    const validation = computeValidationScore(trend, rakuten, youtube, yahoo);

    // ── PHASE 3: Paid Layer — Claude, conditionally ───────────────────────
    let websiteHTML = null;
    let claudeUsed = false;
    let budgetStatus = null;

    if (validation.unlocksPaidLayer) {
      // BudgetCheck middleware — halts if monthly cap exceeded
      budgetStatus = checkBudget();

      if (budgetStatus.allowed) {
        websiteHTML = await generateSiteWithClaude(keyword, trend, rakuten, yahoo, aiContent?.copy);
        if (websiteHTML) {
          // Log usage against userId
          trackUsage(userId, 'website_generation');
          claudeUsed = true;
        }
      }
      // If budget capped, fall through to Groq HTML fallback silently
    }

    // Groq-copy HTML fallback (free, always available)
    if (!websiteHTML && aiContent?.copy) {
      websiteHTML = buildHTML(aiContent.copy, keyword);
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return ok(res, {
      trend, rakuten, youtube, yahoo,
      validation,           // ← exposes score + verdict to frontend
      budgetStatus,
      result: {
        businessPlan: aiContent?.plan || null,
        websiteHTML,
        generatedBy: claudeUsed ? 'claude-haiku' : 'groq-fallback',
      },
    });

  } catch (e) {
    const isQuota = e.message.includes('rate-limited') || e.message.includes('unavailable');
    return err(res, isQuota ? 429 : 500, e.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GROQ-BASED HTML FALLBACK (unchanged from original, ¥0)
// ─────────────────────────────────────────────────────────────────────────────
function buildHTML(copy, keyword) {
  const { heroHeadline, heroSub, heroCta, problems, features, pricing, testimonials, companyName } = copy;

  const problemCards = (problems||[]).map((p) => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform .2s,box-shadow .2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,0,0,.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:40px;margin-bottom:16px">${p.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px">${p.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0">${p.desc}</p>
    </div>`).join('');

  const featureCards = (features||[]).map((f) => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform .2s,box-shadow .2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,229,160,.1)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:44px;margin-bottom:20px">${f.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px">${f.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0">${f.desc}</p>
    </div>`).join('');

  const pricingCards = (pricing||[]).map((p) => `
    <div style="background:${p.highlighted ? 'linear-gradient(135deg,#0d2818,#0d1f2d)' : '#161b22'};border:${p.highlighted ? '2px solid #00e5a0' : '1px solid #30363d'};border-radius:20px;padding:40px 32px;position:relative;transition:transform .2s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
      ${p.highlighted ? '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;font-size:12px;font-weight:800;padding:4px 20px;border-radius:20px;letter-spacing:1px">人 気</div>' : ''}
      <div style="font-size:22px;font-weight:700;color:#e6edf3;margin-bottom:8px">${p.name}</div>
      <div style="margin-bottom:24px"><span style="font-size:42px;font-weight:800;color:${p.highlighted ? '#00e5a0' : '#e6edf3'}">${p.price}</span><span style="color:#8b949e;font-size:14px">${p.period}</span></div>
      <ul style="list-style:none;padding:0;margin:0 0 32px">${(p.features||[]).map((f) => `<li style="color:#8b949e;font-size:14px;padding:8px 0;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:10px"><span style="color:#00e5a0">✓</span>${f}</li>`).join('')}</ul>
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
<footer style="background:#080c10;border-top:1px solid #21262d;padding:40px 24px;text-align:center;color:#8b949e;font-size:13px">© 2026 ${companyName}. All rights reserved. <span style="font-size:10px;opacity:.5;margin-left:8px">Generated by Groq Llama-3.3 (Free Layer)</span></footer>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────
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
    plan: { title: `${trendData.keyword} プラン`, tagline: 'GROQ_API_KEYを設定してください', opportunity: '—', target: '—', service: '—', differentiation: [], revenueModel: '—', actionPlan: [], seoKeywords: [], risk: '—' },
    copy: {
      heroHeadline: `${trendData.keyword}で稼ぐ`, heroSub: 'GROQ_API_KEYを設定するとAI生成コピーになります', heroCta: '無料で始める',
      problems: [{ icon: '😓', title: '時間がかかりすぎる', desc: '従来の方法では多くの時間を無駄にしています。' }, { icon: '💸', title: 'コストが高い', desc: '費用対効果が低いです。' }, { icon: '⏰', title: '成果が出ない', desc: '努力しても結果が出ません。' }],
      features: [{ icon: '🚀', title: '高速処理', desc: '業界最速。' }, { icon: '🤖', title: 'AI自動化', desc: '全自動。' }, { icon: '📊', title: '詳細分析', desc: 'リアルタイム可視化。' }, { icon: '🔒', title: '安全', desc: '最高水準セキュリティ。' }],
      pricing: [{ name: 'フリー', price: '¥0', period: '/月', features: ['基本機能', '月5回'], cta: '無料で始める', highlighted: false }, { name: 'スタンダード', price: '¥2,980', period: '/月', features: ['全機能', '無制限'], cta: '今すぐ始める', highlighted: true }, { name: 'プロ', price: '¥9,800', period: '/月', features: ['全機能', '専任担当'], cta: 'お問い合わせ', highlighted: false }],
      testimonials: [{ name: '田中 太郎', role: '会社員 / 東京', initials: '田', color: '#6366f1', stars: 5, text: '収入が3倍になりました。' }, { name: '佐藤 花子', role: 'フリーランス / 大阪', initials: '佐', color: '#ec4899', stars: 5, text: '誰でも使いこなせます。' }, { name: '鈴木 一郎', role: '経営者 / 福岡', initials: '鈴', color: '#f59e0b', stars: 5, text: '業務効率が劇的に改善。' }],
      companyName: `${trendData.keyword} AI`,
    },
  };
}
