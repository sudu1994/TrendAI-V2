# TrendBaseAI — Merged v1 + v2

Google Trends × Rakuten × YouTube × Gemini AI — Vercel ready.

## Environment Variables

Set these in Vercel → Project → Settings → Environment Variables:

| Variable | Required | Source |
|---|---|---|
| `GOOGLE_GENAI_API_KEY` | ✅ Yes | [Google AI Studio](https://aistudio.google.com/) — free |
| `SERPAPI_KEY` | ✅ Yes | [SerpAPI](https://serpapi.com/) — 100 free/month |
| `RAKUTEN_APP_ID` | Optional | [楽天 Web Service](https://webservice.rakuten.co.jp/) — free |
| `YOUTUBE_API_KEY` | Optional | [Google Cloud Console](https://console.cloud.google.com/) — 10k units/day free |
| `TIKAPI_KEY` | Optional | [TikAPI](https://tikapi.io/) — $10/month |
| `APIFY_TOKEN` | Optional | [Apify](https://apify.com/) — $0.001/100 results |
| `TWITTER_BEARER_TOKEN` | Optional | [X Developer Portal](https://developer.x.com/) — $100/month |

> **Without optional keys**, the app returns realistic mock data and still works fully.

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/analyze?keyword=ミールキット` | Main: Google Trends + Rakuten + YouTube + AI plan |
| `GET /api/rakuten?keyword=副業` | Rakuten demand data |
| `GET /api/youtube?keyword=副業` | YouTube Japan search |
| `GET /api/google-trends?keyword=副業` | Google Trends only |
| `GET /api/tiktok?keyword=副業` | TikTok JP trends |
| `GET /api/twitter?keyword=副業` | Twitter/X buzz score |
| `GET /api/health` | Health check |
