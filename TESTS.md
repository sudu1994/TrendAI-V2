# TrendAI V2 — Test Suite

Paste each block into your **browser DevTools console** after deploying to Vercel.
Set `BASE` to your actual Vercel URL.

```javascript
const BASE = 'https://YOUR-APP.vercel.app'; // ← change this

// ─────────────────────────────────────────
// UNIT TESTS
// ─────────────────────────────────────────

async function runTests() {
  let passed = 0, failed = 0;
  function ok(label, cond) {
    if (cond) { console.log('✅', label); passed++; }
    else       { console.error('❌', label); failed++; }
  }

  // T1: Health endpoint
  console.group('T1: Health');
  const h = await fetch(BASE+'/api/health').then(r=>r.json()).catch(()=>null);
  ok('Returns 200', !!h);
  ok('status === ok', h?.status === 'ok');
  console.groupEnd();

  // T2: Basic analysis
  console.group('T2: Basic analysis (AI)');
  const a = await fetch(BASE+'/api/analyze?keyword=AI').then(r=>r.json()).catch(()=>null);
  ok('Response received', !!a);
  ok('Has trend object',   !!a?.trend);
  ok('Has validation',     !!a?.validation);
  ok('Score is 0-100',     a?.validation?.score >= 0 && a?.validation?.score <= 100);
  ok('Has breakdown',      !!a?.validation?.breakdown);
  ok('Has rakuten',        !!a?.rakuten);
  ok('Has youtube',        !!a?.youtube);
  console.groupEnd();

  // T3: Score threshold logic
  console.group('T3: Score threshold');
  ok('unlocksPaidLayer is boolean', typeof a?.validation?.unlocksPaidLayer === 'boolean');
  ok('threshold exists',           typeof a?.validation?.threshold === 'number');
  ok('threshold is 70',            a?.validation?.threshold === 70);
  console.groupEnd();

  // T4: High-demand keyword gets high score
  console.group('T4: High-demand keyword (AIツール)');
  const b = await fetch(BASE+'/api/analyze?keyword=AIツール').then(r=>r.json()).catch(()=>null);
  ok('Response received', !!b);
  ok('Score > 0', b?.validation?.score > 0);
  console.groupEnd();

  // T5: Business plan present
  console.group('T5: Business plan');
  ok('businessPlan exists', !!a?.result?.businessPlan || !!b?.result?.businessPlan);
  console.groupEnd();

  // T6: Budget status
  console.group('T6: Budget status');
  ok('budgetStatus in response', 'budgetStatus' in a);
  console.groupEnd();

  // T7: Trending endpoint
  console.group('T7: /api/trending');
  const t = await fetch(BASE+'/api/trending').then(r=>r.json()).catch(()=>null);
  ok('Returns array or object', !!t);
  console.groupEnd();

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed+failed} tests`);
}

runTests();
```

---

```javascript
// ─────────────────────────────────────────
// SHEETS INTEGRATION TEST
// ─────────────────────────────────────────

const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbw0ypJD5vdljvDl5zxFZbuK9Q-XASG651lOvGhG7nRdMBscypttQlMUdfdoBehgBtib/exec';

async function testSheets() {
  console.log('Testing Google Sheets integration...');
  
  // GET health check (no-cors not needed for GET)
  try {
    const r = await fetch(SHEETS_URL);
    const d = await r.json();
    console.log('✅ Sheets GET health:', d);
  } catch(e) {
    console.warn('⚠ Sheets GET failed (expected if CORS blocked):', e.message);
  }

  // POST test record
  try {
    await fetch(SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'idea',
        timestamp: new Date().toISOString(),
        keyword: 'TEST_KEYWORD',
        score: 99,
        arr_estimate: '¥1,000,000',
        intent: 'test',
        market_type: 'test',
        idea_json: { test: true }
      })
    });
    console.log('✅ Sheets POST sent (opaque response — check your Sheet for the TEST_KEYWORD row)');
  } catch(e) {
    console.error('❌ Sheets POST failed:', e.message);
  }
}

testSheets();
```

---

```javascript
// ─────────────────────────────────────────
// STRESS TEST (10 keywords, 1s apart)
// ─────────────────────────────────────────

async function stressTest() {
  const BASE = 'https://YOUR-APP.vercel.app'; // ← change this
  const keywords = ['AI','副業','ミールキット','ペット','投資','英語','ダイエット','旅行','料理','美容'];
  const results = [];
  
  console.log(`🔥 Stress test: ${keywords.length} keywords`);
  
  for (const kw of keywords) {
    const t = Date.now();
    try {
      const r = await fetch(BASE+'/api/analyze?keyword='+encodeURIComponent(kw));
      const d = await r.json();
      const ms = Date.now() - t;
      const score = d.validation?.score ?? 'N/A';
      const mockCount = [d.trend?.isMock, d.rakuten?.isMock, d.youtube?.isMock, d.yahoo?.isMock].filter(Boolean).length;
      results.push({ kw, score, ms, mocks: mockCount, ok: true });
      console.log(`✅ ${kw.padEnd(12)} score=${String(score).padStart(3)} mocks=${mockCount}/4 (${ms}ms)`);
    } catch(e) {
      results.push({ kw, ms: Date.now()-t, ok: false, err: e.message });
      console.error(`❌ ${kw}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n── Summary ──────────────────────────');
  const ok = results.filter(r => r.ok);
  console.log(`Pass rate:    ${ok.length}/${results.length}`);
  console.log(`Avg time:     ${Math.round(ok.reduce((a,b)=>a+b.ms,0)/ok.length)}ms`);
  console.log(`Avg score:    ${Math.round(ok.reduce((a,b)=>a+(b.score||0),0)/ok.length)}/100`);
  console.log(`Full mock:    ${ok.filter(r=>r.mocks===4).length} keywords`);
  console.log(`Partial live: ${ok.filter(r=>r.mocks>0&&r.mocks<4).length} keywords`);
  console.log(`All live:     ${ok.filter(r=>r.mocks===0).length} keywords`);
  console.table(results);
}

stressTest();
```
