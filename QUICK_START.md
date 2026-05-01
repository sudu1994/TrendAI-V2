# 🚀 QUICK START GUIDE - TrendAI V2

## ⚡ Fast Setup (5 Minutes)

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Deploy
```bash
cd TrendAI-V2-main
vercel
```

### 3. Set Environment Variables
Go to Vercel Dashboard → Your Project → Settings → Environment Variables

Add these 6 variables:
```
SERPAPI_KEY=your_key
RAKUTEN_APP_ID=your_key  
YOUTUBE_API_KEY=your_key
YAHOO_CLIENT_ID=your_key
GROQ_API_KEY=your_key
ANTHROPIC_CORP_KEY=your_key
```

### 4. Redeploy
```bash
vercel --prod
```

### 5. Test
```
https://your-app.vercel.app/api/analyze?keyword=AI
```

---

## 🔑 Get API Keys (15 Minutes)

### Free Tier Keys (Start Here)

1. **Groq** (Fastest)
   - https://console.groq.com/
   - Click "Create API Key"
   - Free: 14,400 requests/day
   - ✅ Copy to GROQ_API_KEY

2. **SerpAPI** (100 free/month)
   - https://serpapi.com/
   - Sign up → Dashboard → API Key
   - ✅ Copy to SERPAPI_KEY

3. **YouTube Data API**
   - https://console.cloud.google.com/
   - Create Project → Enable YouTube Data API v3
   - Credentials → Create API Key
   - ✅ Copy to YOUTUBE_API_KEY

### Paid/Registration Required

4. **Rakuten** (Japanese account)
   - https://webservice.rakuten.co.jp/
   - Free tier available
   - ✅ Copy App ID to RAKUTEN_APP_ID

5. **Yahoo Japan** (Japanese account)
   - https://developer.yahoo.co.jp/
   - Register app
   - ✅ Copy Client ID to YAHOO_CLIENT_ID

6. **Anthropic Claude**
   - https://console.anthropic.com/
   - Add credits (~$5 minimum)
   - Create API key
   - ✅ Copy to ANTHROPIC_CORP_KEY

---

## ✅ Verification Checklist

- [ ] Vercel deployment successful
- [ ] All 6 env vars set
- [ ] `/api/health` returns 200 OK
- [ ] Search works, shows data
- [ ] Score calculates correctly
- [ ] Claude generates when score ≥70
- [ ] Budget tracking works

---

## 🐛 Troubleshooting

### All Data Shows "MOCK"
→ Check environment variables are set in Vercel (not just locally)

### Claude Doesn't Generate
→ Ensure score ≥70 OR add `?force_claude=1` to URL
→ Check ANTHROPIC_CORP_KEY is valid

### Yahoo Always Mock
→ Verify YAHOO_CLIENT_ID format
→ Check API quota

### Budget Not Tracking
→ Budget stored in browser localStorage
→ Clear browser cache to reset

---

## 📊 Quick Test Keywords

| Keyword | Expected Score | Should Generate? |
|---------|---------------|------------------|
| AI | ~85 | ✅ Yes |
| AI副業 | ~90 | ✅ Yes |  
| 転職 | ~75 | ✅ Yes |
| ペット | ~45 | ❌ No |
| サブスク | ~60 | ❌ No |

Force Claude: Add `?force_claude=1` to any search

---

## 🎯 Next Steps

1. ✅ Deploy & test basic functionality
2. 📊 Set up Google Sheets (see HANDOUT.md)
3. 🔐 Add authentication (optional)
4. 📈 Monitor Vercel logs
5. 💰 Monitor API costs

---

## 💡 Cost Estimates

### Per Search (All APIs)
- SerpAPI: $0.05 (or free tier)
- Rakuten: Free
- YouTube: Free (quota)
- Yahoo: Free (quota)
- Groq: Free
- **Total: ~$0.05 or FREE**

### Claude Generation
- Haiku: ~¥45 per website
- Only triggers when score ≥70
- Monthly cap: ¥3,000 (67 websites)

### Recommended Budget
- Start: $10/month
- Scale: $50/month (1000 searches)
- Enterprise: $200+/month

---

**Ready to go? Run:**
```bash
vercel
```
