const axios = require("axios");
const { handleOptions, ok, err } = require("./lib/helpers");

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
      values: timeline.map((d) => ({ date: d.date, value: Number(d.values?.[0]?.extracted_value ?? 0) })),
    };
  } catch (e) {
    return mockTrendData(keyword);
  }
}

// ── 2. Rakuten ──────────────────────────────────────────────────────────────
async function fetchRakutenData(keyword) {
  const APP_ID = process.env.RAKUTEN_APP_ID;
  if (!APP_ID) return { mock: true, demandSignal: { level: "Unknown", itemCount: 0, avgPrice: 0, totalReviews: 0 } };
  try {
    const r = await axios.get("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706", {
      params: { applicationId: APP_ID, format: "json", keyword, hits: 1 },
      timeout: 5000,
    });
    const count = r.data.count || 0;
    const item = r.data.Items?.[0]?.Item || {};
    return {
      mock: false,
      demandSignal: {
        level: count > 5000 ? "High" : count > 1000 ? "Moderate" : "Low",
        itemCount: count,
        avgPrice: item.itemPrice || 0,
        totalReviews: item.reviewCount || 0,
      },
    };
  } catch {
    return { mock: true, demandSignal: { level: "Low", itemCount: 0, avgPrice: 0, totalReviews: 0 } };
  }
}

// ── 3. Groq: generate CONTENT ONLY (not HTML) ───────────────────────────────
async function generateContent(trendData, rakutenData) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    console.warn("No GROQ_API_KEY found, using mock.");
    return mockContent(trendData);
  }

  const demandLevel = rakutenData?.demandSignal?.level || "Unknown";
  const prompt = `You are a Japanese business strategist and copywriter.

Keyword: ${trendData.keyword}
Trend: ${trendData.trend}
Market: ${demandLevel}

Generate landing page copy and a business plan for this keyword/trend in Japanese.
Return ONLY a raw JSON object with NO markdown, NO backticks, NO extra text.

{
  "plan": {
    "title": "Business name (Japanese, catchy)",
    "tagline": "One-line tagline (Japanese)",
    "opportunity": "2-3 sentences about market opportunity",
    "target": "Target customer description",
    "service": "Service description",
    "differentiation": ["point 1", "point 2", "point 3"],
    "revenueModel": "How money is made",
    "actionPlan": ["step 1", "step 2", "step 3", "step 4"],
    "seoKeywords": ["kw1", "kw2", "kw3", "kw4", "kw5"],
    "risk": "Main risks and mitigations"
  },
  "copy": {
    "heroHeadline": "Bold 10-15 char hero headline (Japanese)",
    "heroSub": "Hero subheadline 20-30 chars (Japanese)",
    "heroCta": "CTA button text (Japanese, 6-10 chars)",
    "problems": [
      {"icon": "😓", "title": "Pain point title", "desc": "1-2 sentence description"},
      {"icon": "💸", "title": "Pain point title", "desc": "1-2 sentence description"},
      {"icon": "⏰", "title": "Pain point title", "desc": "1-2 sentence description"}
    ],
    "features": [
      {"icon": "🚀", "title": "Feature name", "desc": "Short description"},
      {"icon": "🤖", "title": "Feature name", "desc": "Short description"},
      {"icon": "📊", "title": "Feature name", "desc": "Short description"},
      {"icon": "🔒", "title": "Feature name", "desc": "Short description"}
    ],
    "pricing": [
      {"name": "フリー", "price": "¥0", "period": "/月", "features": ["feature1", "feature2", "feature3"], "cta": "無料で始める", "highlighted": false},
      {"name": "スタンダード", "price": "¥2,980", "period": "/月", "features": ["feature1", "feature2", "feature3", "feature4"], "cta": "今すぐ始める", "highlighted": true},
      {"name": "プロ", "price": "¥9,800", "period": "/月", "features": ["feature1", "feature2", "feature3", "feature4", "feature5"], "cta": "お問い合わせ", "highlighted": false}
    ],
    "testimonials": [
      {"name": "田中 太郎", "role": "会社員 / 東京", "initials": "田", "color": "#6366f1", "stars": 5, "text": "Testimonial text"},
      {"name": "佐藤 花子", "role": "フリーランス / 大阪", "initials": "佐", "color": "#ec4899", "stars": 5, "text": "Testimonial text"},
      {"name": "鈴木 一郎", "role": "経営者 / 福岡", "initials": "鈴", "color": "#f59e0b", "stars": 5, "text": "Testimonial text"}
    ],
    "companyName": "Company name for footer"
  }
}`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model: "llama-3.3-70b-versatile", max_tokens: 4096, messages: [{ role: "user", content: prompt }] },
        { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 60000 }
      );
      const responseText = response.data?.choices?.[0]?.message?.content ?? "";
      const cleanJson = responseText.replace(/^```json\n?|```[\s\S]*?$/gm, "").trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      const status = e.response?.status;
      if (status === 429 || e.code === "ECONNABORTED") {
        attempts++;
        await sleep(10000);
        continue;
      }
      console.error("Groq error:", e.message);
      throw new Error(`AI generation failed: ${e.message}`);
    }
  }
  throw new Error("Groq API unavailable after retries.");
}

// ── 4. Build premium HTML from content ──────────────────────────────────────
function buildHTML(copy, keyword) {
  const { heroHeadline, heroSub, heroCta, problems, features, pricing, testimonials, companyName } = copy;

  const problemCards = problems.map(p => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,0,0,0.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:40px;margin-bottom:16px;">${p.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px;">${p.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0;">${p.desc}</p>
    </div>`).join("");

  const featureCards = features.map(f => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 40px rgba(0,229,160,0.1)'" onmouseout="this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:44px;margin-bottom:20px;">${f.icon}</div>
      <h3 style="color:#e6edf3;font-size:18px;font-weight:700;margin:0 0 12px;">${f.title}</h3>
      <p style="color:#8b949e;font-size:14px;line-height:1.7;margin:0;">${f.desc}</p>
    </div>`).join("");

  const pricingCards = pricing.map(p => `
    <div style="background:${p.highlighted ? 'linear-gradient(135deg,#0d2818,#0d1f2d)' : '#161b22'};border:${p.highlighted ? '2px solid #00e5a0' : '1px solid #30363d'};border-radius:20px;padding:40px 32px;position:relative;transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
      ${p.highlighted ? '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;font-size:12px;font-weight:800;padding:4px 20px;border-radius:20px;letter-spacing:1px;">人 気</div>' : ''}
      <div style="font-size:22px;font-weight:700;color:#e6edf3;margin-bottom:8px;">${p.name}</div>
      <div style="margin-bottom:24px;"><span style="font-size:42px;font-weight:800;color:${p.highlighted ? '#00e5a0' : '#e6edf3'};">${p.price}</span><span style="color:#8b949e;font-size:14px;">${p.period}</span></div>
      <ul style="list-style:none;padding:0;margin:0 0 32px;">
        ${p.features.map(f => `<li style="color:#8b949e;font-size:14px;padding:8px 0;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:10px;"><span style="color:#00e5a0;font-size:16px;">✓</span>${f}</li>`).join("")}
      </ul>
      <button style="width:100%;padding:14px;background:${p.highlighted ? 'linear-gradient(90deg,#00e5a0,#00b8d4)' : 'transparent'};border:${p.highlighted ? 'none' : '1px solid #30363d'};color:${p.highlighted ? '#0d1117' : '#e6edf3'};border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">${p.cta}</button>
    </div>`).join("");

  const testimonialCards = testimonials.map(t => `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;">
      <div style="color:#f59e0b;font-size:18px;margin-bottom:16px;">${"★".repeat(t.stars)}</div>
      <p style="color:#c9d1d9;font-size:14px;line-height:1.8;margin:0 0 24px;">"${t.text}"</p>
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:44px;height:44px;border-radius:50%;background:${t.color};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:white;flex-shrink:0;">${t.initials}</div>
        <div>
          <div style="color:#e6edf3;font-size:15px;font-weight:700;">${t.name}</div>
          <div style="color:#8b949e;font-size:13px;">${t.role}</div>
        </div>
      </div>
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heroHeadline} | ${companyName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;background:#0d1117;color:#e6edf3;}
  section{padding:96px 24px;}
  .container{max-width:1100px;margin:0 auto;}
  h2.section-title{font-size:clamp(26px,4vw,38px);font-weight:800;text-align:center;margin-bottom:16px;}
  p.section-sub{color:#8b949e;text-align:center;font-size:16px;margin-bottom:56px;line-height:1.7;}
  .grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;}
  .grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
  @keyframes glow{0%,100%{box-shadow:0 0 20px rgba(0,229,160,0.4)}50%{box-shadow:0 0 40px rgba(0,229,160,0.8)}}
  @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
</style>
</head>
<body>

<!-- NAV -->
<nav style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(13,17,23,0.85);backdrop-filter:blur(12px);border-bottom:1px solid #21262d;padding:0 24px;">
  <div style="max-width:1100px;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;background:linear-gradient(90deg,#00e5a0,#00b8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${companyName}</div>
    <div style="display:flex;gap:32px;">
      <a href="#features" style="color:#8b949e;text-decoration:none;font-size:14px;transition:color 0.2s;" onmouseover="this.style.color='#e6edf3'" onmouseout="this.style.color='#8b949e'">機能</a>
      <a href="#pricing" style="color:#8b949e;text-decoration:none;font-size:14px;transition:color 0.2s;" onmouseover="this.style.color='#e6edf3'" onmouseout="this.style.color='#8b949e'">料金</a>
      <a href="#pricing" style="background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;padding:8px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;">${heroCta}</a>
    </div>
  </div>
</nav>

<!-- HERO -->
<section style="padding:160px 24px 100px;text-align:center;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);background-size:200% 200%;animation:gradientShift 8s ease infinite;position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(0,229,160,0.12) 0%,transparent 60%);pointer-events:none;"></div>
  <div style="position:relative;z-index:1;max-width:800px;margin:0 auto;">
    <div style="display:inline-block;background:rgba(0,229,160,0.12);border:1px solid rgba(0,229,160,0.3);color:#00e5a0;font-size:13px;font-weight:600;padding:6px 18px;border-radius:20px;margin-bottom:32px;letter-spacing:1px;"># ${keyword}</div>
    <h1 style="font-size:clamp(36px,7vw,72px);font-weight:900;line-height:1.15;margin-bottom:24px;background:linear-gradient(135deg,#ffffff,#a5b4fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${heroHeadline}</h1>
    <p style="font-size:clamp(16px,2.5vw,22px);color:#8b949e;line-height:1.7;margin-bottom:48px;max-width:600px;margin-left:auto;margin-right:auto;">${heroSub}</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <button style="background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;border:none;padding:18px 44px;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer;animation:glow 2s ease-in-out infinite;letter-spacing:0.5px;" onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='none'">${heroCta} →</button>
      <button style="background:transparent;color:#e6edf3;border:1px solid #30363d;padding:18px 44px;border-radius:12px;font-size:17px;font-weight:600;cursor:pointer;" onmouseover="this.style.borderColor='#00e5a0';this.style.color='#00e5a0'" onmouseout="this.style.borderColor='#30363d';this.style.color='#e6edf3'">詳細を見る</button>
    </div>
    <div style="margin-top:64px;display:flex;justify-content:center;gap:48px;flex-wrap:wrap;">
      <div style="text-align:center;"><div style="font-size:28px;font-weight:800;color:#00e5a0;">10,000+</div><div style="color:#8b949e;font-size:13px;margin-top:4px;">利用ユーザー数</div></div>
      <div style="text-align:center;"><div style="font-size:28px;font-weight:800;color:#00e5a0;">98%</div><div style="color:#8b949e;font-size:13px;margin-top:4px;">顧客満足度</div></div>
      <div style="text-align:center;"><div style="font-size:28px;font-weight:800;color:#00e5a0;">24/7</div><div style="color:#8b949e;font-size:13px;margin-top:4px;">サポート対応</div></div>
    </div>
  </div>
</section>

<!-- PROBLEMS -->
<section style="padding:96px 24px;background:#0d1117;">
  <div class="container">
    <h2 class="section-title">こんな<span style="color:#00e5a0;">お悩み</span>ありませんか？</h2>
    <p class="section-sub">多くの方が同じ課題を抱えています。私たちが解決します。</p>
    <div class="grid-3">${problemCards}</div>
  </div>
</section>

<!-- FEATURES -->
<section id="features" style="padding:96px 24px;background:linear-gradient(180deg,#0d1117,#0f1419);">
  <div class="container">
    <h2 class="section-title">選ばれる<span style="color:#00e5a0;">理由</span></h2>
    <p class="section-sub">最先端の技術と使いやすいデザインで、あなたのビジネスを加速します。</p>
    <div class="grid-4">${featureCards}</div>
  </div>
</section>

<!-- PRICING -->
<section id="pricing" style="padding:96px 24px;background:#0d1117;">
  <div class="container">
    <h2 class="section-title">シンプルな<span style="color:#00e5a0;">料金プラン</span></h2>
    <p class="section-sub">あなたのニーズに合わせたプランをお選びください。いつでもアップグレード・ダウングレード可能です。</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;align-items:start;">${pricingCards}</div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section style="padding:96px 24px;background:linear-gradient(180deg,#0d1117,#0f1419);">
  <div class="container">
    <h2 class="section-title">お客様の<span style="color:#00e5a0;">声</span></h2>
    <p class="section-sub">全国のユーザーから喜びの声をいただいています。</p>
    <div class="grid-3">${testimonialCards}</div>
  </div>
</section>

<!-- CTA BANNER -->
<section style="padding:96px 24px;text-align:center;background:linear-gradient(135deg,#0d2818,#0d1f2d);">
  <div style="max-width:600px;margin:0 auto;">
    <h2 style="font-size:clamp(28px,4vw,44px);font-weight:800;margin-bottom:20px;">今すぐ<span style="color:#00e5a0;">無料</span>で始めよう</h2>
    <p style="color:#8b949e;font-size:16px;line-height:1.7;margin-bottom:40px;">クレジットカード不要。30日間の無料トライアル付き。いつでもキャンセル可能。</p>
    <button style="background:linear-gradient(90deg,#00e5a0,#00b8d4);color:#0d1117;border:none;padding:20px 60px;border-radius:12px;font-size:18px;font-weight:800;cursor:pointer;letter-spacing:0.5px;" onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='none'">${heroCta} →</button>
  </div>
</section>

<!-- FOOTER -->
<footer style="background:#080c10;border-top:1px solid #21262d;padding:48px 24px;">
  <div style="max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:24px;">
    <div style="font-size:20px;font-weight:800;background:linear-gradient(90deg,#00e5a0,#00b8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${companyName}</div>
    <div style="display:flex;gap:32px;flex-wrap:wrap;">
      <a href="#" style="color:#8b949e;text-decoration:none;font-size:14px;">利用規約</a>
      <a href="#" style="color:#8b949e;text-decoration:none;font-size:14px;">プライバシーポリシー</a>
      <a href="#" style="color:#8b949e;text-decoration:none;font-size:14px;">お問い合わせ</a>
    </div>
    <div style="color:#8b949e;font-size:13px;">© 2025 ${companyName}. All rights reserved.</div>
  </div>
</footer>

</body>
</html>`;
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

    const aiContent = await generateContent(trend, rakuten);
    const websiteHTML = buildHTML(aiContent.copy, keyword);

    const youtube = { mock: true, totalResults: 0, topChannels: [] };
    const result = {
      businessPlan: aiContent.plan || null,
      websiteHTML,
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

function mockContent(trendData) {
  return {
    plan: {
      title: `${trendData.keyword} ビジネスプラン`,
      tagline: "GROQ_API_KEYを設定すると詳細プランが生成されます",
      opportunity: "APIキーを設定すると、リアルタイムのビジネスプランが生成されます。",
      target: "設定後に表示されます", service: "設定後に表示されます",
      differentiation: [], revenueModel: "設定後に表示されます",
      actionPlan: [], seoKeywords: [], risk: "設定後に表示されます",
    },
    copy: {
      heroHeadline: `${trendData.keyword}で稼ぐ`,
      heroSub: "GROQ_API_KEYを設定するとAIがリアルなコピーを生成します",
      heroCta: "無料で始める",
      problems: [
        { icon: "😓", title: "時間がかかりすぎる", desc: "従来の方法では多くの時間を無駄にしています。" },
        { icon: "💸", title: "コストが高い", desc: "既存のサービスは費用対効果が低いです。" },
        { icon: "⏰", title: "成果が出ない", desc: "努力しても思うような結果が得られません。" },
      ],
      features: [
        { icon: "🚀", title: "高速処理", desc: "業界最速のパフォーマンスを実現。" },
        { icon: "🤖", title: "AI自動化", desc: "面倒な作業を全自動で処理します。" },
        { icon: "📊", title: "詳細分析", desc: "リアルタイムで成果を可視化。" },
        { icon: "🔒", title: "安全・安心", desc: "最高水準のセキュリティで保護。" },
      ],
      pricing: [
        { name: "フリー", price: "¥0", period: "/月", features: ["基本機能", "月5回まで", "メールサポート"], cta: "無料で始める", highlighted: false },
        { name: "スタンダード", price: "¥2,980", period: "/月", features: ["全機能", "無制限", "優先サポート", "分析レポート"], cta: "今すぐ始める", highlighted: true },
        { name: "プロ", price: "¥9,800", period: "/月", features: ["全機能", "無制限", "専任担当", "カスタム連携", "SLA保証"], cta: "お問い合わせ", highlighted: false },
      ],
      testimonials: [
        { name: "田中 太郎", role: "会社員 / 東京", initials: "田", color: "#6366f1", stars: 5, text: "このサービスを使い始めてから収入が3倍になりました。本当に助かっています。" },
        { name: "佐藤 花子", role: "フリーランス / 大阪", initials: "佐", color: "#ec4899", stars: 5, text: "操作が簡単で誰でもすぐに使いこなせます。サポートも丁寧で安心です。" },
        { name: "鈴木 一郎", role: "経営者 / 福岡", initials: "鈴", color: "#f59e0b", stars: 5, text: "導入してから業務効率が劇的に改善されました。コスパも最高です。" },
      ],
      companyName: `${trendData.keyword} AI`,
    },
  };
}
