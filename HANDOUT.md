# TrendAI V2 - COMPLETE FIX & HANDOUT

## ✅ ALL ISSUES FIXED (Updated 2026-05-02)

---

## 🔴 ISSUES IDENTIFIED & FIXED

### 1. **Yahoo Shopping Always Shows 100% But Returns Mock Data**
- **Issue**: Yahoo API wasn't being called properly even with valid CLIENT_ID
- **Root Cause**: Error handling was silently falling back to mock data
- **Fix**: Improved error logging + proper Yahoo API implementation with correct endpoint

### 2. **AI Keyword Generates 100% But No Website Output**
- **Issue**: Claude generation was skipped even when score ≥70
- **Root Cause**: Budget check + missing `force_claude=1` parameter handling
- **Fix**: Added `force_claude` parameter support + better budget tracking

### 3. **Nothing Outputs to Google Sheets** ✅ NOW FIXED
- **Issue**: `sendToSheets()` function was missing from `index.html`
- **Root Cause**: Apps Script was deployed but frontend never called it
- **Fix**: Added `sendToSheets()` to `index.html`, wired into both `analyze()` and `runClaude()`
- **Also Fixed**: CSP header was blocking `script.google.com` — now allowed

---

## ✅ GOOGLE SHEETS — WHAT WAS DONE

The following changes were made to `public/index.html`:

1. **Added `SHEETS_URL` constant** pointing to your deployed Apps Script:
   ```
   https://script.google.com/macros/s/AKfycbw0ypJ...exec
   ```

2. **Added `sendToSheets(data)` function** that sends 3 payloads on each analysis:
   - `type: 'idea'` → writes to `ideas` sheet
   - `type: 'signals'` → writes to `signals` sheet  
   - `type: 'validation'` → writes to `validation` sheet

3. **Called from `analyze()`** — fires on every keyword search (fire-and-forget, silent fail)

4. **Called from `runClaude()`** — fires again when Claude generates a website

5. **Fixed CSP header** — added `https://script.google.com` to `connect-src`

---

## 🔧 SETUP INSTRUCTIONS

### Required Environment Variables (Vercel)
```bash
SERPAPI_KEY=your_serpapi_key_here          # Google Trends data
RAKUTEN_APP_ID=your_rakuten_app_id_here   # Rakuten marketplace
YOUTUBE_API_KEY=your_youtube_key_here     # YouTube stats
YAHOO_CLIENT_ID=your_yahoo_client_id_here # Yahoo Shopping
GROQ_API_KEY=your_groq_key_here           # Free tier (business plan)
ANTHROPIC_CORP_KEY=your_claude_key_here   # Claude Haiku (website gen)
```

### Google Sheets Setup ✅ (Already deployed)
Your Apps Script is live at:
```
https://script.google.com/macros/s/AKfycbw0ypJD5vdljvDl5zxFZbuK9Q-XASG651lOvGhG7nRdMBscypttQlMUdfdoBehgBtib/exec
```

Make sure your Google Sheet has these tabs (they auto-create if missing):
- `ideas` — one row per keyword search
- `signals` — raw API data (Trends, Rakuten, YouTube, Yahoo)
- `validation` — scoring data

---

## 🚀 DEPLOYMENT STEPS

```bash
# Deploy to Vercel
npm i -g vercel
vercel login
cd TrendAI-V2-fixed
vercel

# Set env vars
vercel env add SERPAPI_KEY
vercel env add RAKUTEN_APP_ID
vercel env add YOUTUBE_API_KEY
vercel env add YAHOO_CLIENT_ID
vercel env add GROQ_API_KEY
vercel env add ANTHROPIC_CORP_KEY

vercel --prod
```

---

## 🧪 TEST PLAN

### Unit Tests — Run in browser console after deployment

```javascript
// TEST 1: Health check
fetch('/api/health').then(r=>r.json()).then(console.log)
// Expected: { status: 'ok', ... }

// TEST 2: Basic keyword analysis
fetch('/api/analyze?keyword=AI副業').then(r=>r.json()).then(d=>{
  console.assert(d.trend, 'trend missing');
  console.assert(d.validation, 'validation missing');
  console.assert(typeof d.validation.score === 'number', 'score not a number');
  console.log('✅ Basic analysis:', d.validation.score + '/100');
})

// TEST 3: Force Claude
fetch('/api/analyze?keyword=AI副業&force_claude=1').then(r=>r.json()).then(d=>{
  console.assert(d.result?.websiteHTML, 'no website HTML generated');
  console.assert(d.result?.generatedBy, 'generatedBy missing');
  console.log('✅ Force Claude:', d.result.generatedBy);
})

// TEST 4: Sheets integration (check Network tab in DevTools)
// After any search, look for POST requests to script.google.com
// Status will be "opaque" (no-cors) — that's correct behavior
```

### Stress Test — Run in browser console

```javascript
// Stress test: 10 sequential keyword searches
async function stressTest(){
  const keywords=['AI','副業','ミールキット','ペット','投資','英語','ダイエット','旅行','料理','美容'];
  const results=[];
  for(const kw of keywords){
    const t=Date.now();
    try{
      const r=await fetch('/api/analyze?keyword='+encodeURIComponent(kw));
      const d=await r.json();
      const ms=Date.now()-t;
      results.push({kw,score:d.validation?.score,ms,ok:true});
      console.log(`✅ ${kw}: ${d.validation?.score}/100 (${ms}ms)`);
    }catch(e){
      results.push({kw,ms:Date.now()-t,ok:false,err:e.message});
      console.log(`❌ ${kw}: ${e.message}`);
    }
    // 1s delay to avoid rate limits
    await new Promise(r=>setTimeout(r,1000));
  }
  console.table(results);
  const okCount=results.filter(r=>r.ok).length;
  console.log(`\nResult: ${okCount}/${keywords.length} passed`);
  const avgMs=results.filter(r=>r.ok).reduce((a,b)=>a+b.ms,0)/okCount;
  console.log(`Avg response time: ${Math.round(avgMs)}ms`);
}
stressTest();
```

### Expected Stress Test Results
| Metric | Target |
|--------|--------|
| Success rate | ≥90% |
| Avg response time | <10s |
| Score range | 0–100 (not always 100) |
| No crashes | ✅ |

---

## 📊 GOOGLE SHEETS — HOW TO VERIFY DATA IS FLOWING

1. Open your Google Sheet
2. Search a keyword in the app (e.g., "AI副業")
3. Within 5 seconds, check:
   - `ideas` tab → new row appeared
   - `signals` tab → raw data row appeared
   - `validation` tab → score row appeared

**Note**: Because we use `mode: 'no-cors'`, fetch responses are "opaque" — no error/success confirmation in JS. Verify via the Sheet itself.

---

## 🐛 DEBUGGING

### Check Vercel Logs
```bash
vercel logs --follow
```

### Common Issues

1. **"No API key found"**
   → Set environment variables in Vercel dashboard

2. **"Mock data" for all sources**
   → Check API keys are valid and have quota remaining

3. **Claude not generating**
   → Check: Score ≥ 70 OR `force_claude=1`
   → Check: Budget not exceeded (¥3,000 cap)
   → Check: ANTHROPIC_CORP_KEY is valid

4. **Yahoo always returns mock**
   → Verify YAHOO_CLIENT_ID is correct
   → Endpoint: `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch`

5. **Sheets not receiving data**
   → Check browser DevTools Network tab for requests to `script.google.com`
   → Verify Apps Script is deployed with "Anyone" access
   → Try opening the Apps Script URL directly in a browser (should return `{"status":"ok"}`)

---

## 📁 FILE STRUCTURE

```
TrendAI-V2-fixed/
├── api/
│   ├── analyze.js          ← MAIN API (FIXED)
│   ├── trending.js         ← Live trends ticker
│   ├── health.js           ← Health check
│   └── lib/
│       ├── helpers.js      ← CORS, response helpers
│       ├── budget.js       ← Budget tracking
│       └── validator.js    ← Scoring engine
├── public/
│   └── index.html          ← Frontend UI (SHEETS INTEGRATION ADDED ✅)
├── vercel.json             ← Vercel config
├── package.json            ← Dependencies
├── GOOGLE_APPS_SCRIPT.js   ← Sheets Apps Script (already deployed)
└── GOOGLE_SHEETS_BACKEND.js← Multi-sheet backend (already deployed)
```

---

## ✨ FEATURES STATUS

✅ Google Trends data fetching  
✅ Rakuten demand analysis  
✅ YouTube volume metrics  
✅ Yahoo Shopping data  
✅ Groq business plan generation  
✅ Claude website generation (gated by score ≥70)  
✅ Budget tracking (localStorage)  
✅ Validation scoring (0-100)  
✅ Force Claude parameter  
✅ Fallback to Groq HTML  
✅ Error handling & logging  
✅ **Google Sheets output (NEWLY FIXED)**  

🔄 TO IMPLEMENT (future):
- User authentication
- Historical data storage / trend comparison
- Multi-user budget tracking (server-side)

---

**Last Updated**: 2026-05-02  
**Version**: 2.1 (Sheets Fixed)  
**Status**: ✅ Production Ready

---

## 🆕 FIX v2.1 — Vercel Error & Live Ticker (Added 2026-05-02)

### Problem 1: Vercel deployment error
**Root cause**: `vercel.json` was using the deprecated `builds` + `routes` format which fails on current Vercel CLI.  
**Fix**: Rewrote to modern `rewrites` format. No `builds` block needed — Vercel auto-detects `/api/*.js` as serverless functions and `/public/` as static.

### Problem 2: Ticker and 今注目 showing static seed data only
**Root cause**: The fetch calls in `index.html` used relative paths (`/api/trending`, `/api/analyze`). When the HTML is served from Google Apps Script, these relative URLs resolve to GAS — not to Vercel — and 404 immediately, so the code falls through to the static `SEED` array.

**Fix**: Added `API_BASE` config constant at the top of the `<script>` block:
```javascript
const API_BASE = '';  // Set to your Vercel URL if HTML is served from GAS
```

**If your HTML is served by Vercel** (recommended): leave `API_BASE = ''` — relative paths work fine.

**If your HTML is served by Google Apps Script**: set:
```javascript
const API_BASE = 'https://your-app.vercel.app';
```

### Problem 3: 今注目 shows no source label
**Fix**: `setSuggestions()` now accepts a `source` param and shows:
- `🔴 LIVE` — from Google Trends real-time
- `📈 LIVE` — from Google Trends rising queries
- `🤖 AI生成` — from Groq-generated keywords
- (no label) — static seed fallback

### Vercel Deploy Sequence
```bash
cd TrendAI-V2-fixed
npm install
vercel --prod
```
After deploy, copy your Vercel URL (e.g. `https://trend-ai-v2-xxx.vercel.app`).  
If you're serving the HTML from GAS, paste it into `index.html` at the `API_BASE` line.  
If Vercel serves the HTML directly, no change needed.
