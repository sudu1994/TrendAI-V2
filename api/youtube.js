// GET /api/youtube?keyword=副業&mode=trending|search
// YouTube Data API v3 — free (10,000 units/day)
// Setup: https://console.cloud.google.com → Enable YouTube Data API v3 → create API key
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const YT_KEY  = process.env.YOUTUBE_API_KEY;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '';
  const mode    = req.query.mode    || (keyword ? 'search' : 'trending');

  // ── Env guard ─────────────────────────────────────────────────────────────
  console.log(`[YouTube] YOUTUBE_API_KEY present: ${Boolean(YT_KEY)}`);
  if (!YT_KEY) {
    const msg = 'YOUTUBE_API_KEY is not configured. Enable YouTube Data API v3 free at https://console.cloud.google.com and add key to Vercel env vars.';
    console.error(`[YouTube] ${msg}`);
    return err(res, 503, msg, {
      source: 'mock',
      error: 'YOUTUBE_API_KEY missing',
      setup: 'https://console.cloud.google.com',
    });
  }

  console.log(`[YouTube] Request start — keyword="${keyword}" mode="${mode}"`);

  try {
    if (mode === 'trending') {
      const r = await axios.get(`${YT_BASE}/videos`, {
        params: {
          part:       'snippet,statistics',
          chart:      'mostPopular',
          regionCode: 'JP',
          hl:         'ja',
          maxResults: 20,
          key:        YT_KEY,
        },
        timeout: 8000,
      });
      console.log(`[YouTube] Trending response status: ${r.status}`);

      const videos = r.data.items.map(v => ({
        title:     v.snippet.title,
        channel:   v.snippet.channelTitle,
        viewCount: parseInt(v.statistics.viewCount || 0),
        tags:      v.snippet.tags?.slice(0, 5) || [],
      }));

      const words = videos.flatMap(v =>
        v.title.split(/[\s　・【】「」（）()]+/).filter(w => w.length > 1)
      );
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      const topKeywords = Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([word, count]) => ({ word, count }));

      return ok(res, {
        source: 'live',
        error:  null,
        apiSource: 'youtube_data_api_v3',
        region: 'JP',
        trendKeywords: topKeywords,
        videoCount: videos.length,
      });
    }

    // Search mode — demand signal for a specific keyword
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const r = await axios.get(`${YT_BASE}/search`, {
      params: {
        part:              'snippet',
        q:                 keyword,
        type:              'video',
        regionCode:        'JP',
        relevanceLanguage: 'ja',
        order:             'viewCount',
        maxResults:        10,
        publishedAfter:    sixMonthsAgo.toISOString(),
        key:               YT_KEY,
      },
      timeout: 8000,
    });
    console.log(`[YouTube] Search response status: ${r.status}`);

    return ok(res, {
      source: 'live',
      error:  null,
      apiSource: 'youtube_data_api_v3',
      keyword,
      totalResults: r.data.pageInfo?.totalResults || 0,
      results: r.data.items.map(v => ({
        title:       v.snippet.title,
        channel:     v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
      })),
    });

  } catch (e) {
    const errMsg = e.response
      ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data?.error?.message || e.message)}`
      : e.message;
    console.error(`[YouTube] Request failed — ${errMsg}`);
    return err(res, 502, `YouTube API error: ${errMsg}`, {
      source: 'mock',
      error:  errMsg,
    });
  }
};
