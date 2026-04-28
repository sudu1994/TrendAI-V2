/**
 * api/proxy.js — Zero-Log Hardened Proxy
 * Routes Claude (CORS-blocked) and RESAS through a safe serverless bridge.
 * The user key is read from x-fwd-key, forwarded, then discarded immediately.
 * console.log is NEVER called with headers, keys, or bodies.
 */

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  // Add your Vercel deployment URL here, e.g.:
  // 'https://ssi-ai.vercel.app',
]);

const TARGETS = {
  claude: {
    baseUrl:     'https://api.anthropic.com',
    defaultPath: '/v1/messages',
    authHeader:  'x-api-key',
    extraHeaders:{ 'anthropic-version': '2023-06-01' },
    methods:     ['POST'],
  },
  resas: {
    baseUrl:     'https://opendata.resas-portal.go.jp',
    defaultPath: '/api/v1/prefectures',
    authHeader:  'X-API-KEY',
    extraHeaders:{},
    methods:     ['GET'],
  },
};

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';

  // CORS — only allowed origins get the header
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-target, x-fwd-key, x-path-suffix');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  const targetId = req.headers['x-target'];
  const config = TARGETS[targetId];
  if (!config) return res.status(400).json({ error: `Unknown target: "${targetId}"` });
  if (!config.methods.includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  // Extract key — NEVER logged
  const userKey = req.headers['x-fwd-key'];
  if (!userKey) return res.status(401).json({ error: 'Missing x-fwd-key header' });

  const pathSuffix = req.headers['x-path-suffix'] || config.defaultPath;
  if (/\.\./.test(pathSuffix)) return res.status(400).json({ error: 'Invalid path' });

  let upstreamUrl = `${config.baseUrl}${pathSuffix}`;

  const upstreamHeaders = {
    'Content-Type': 'application/json',
    [config.authHeader]: userKey,
    ...config.extraHeaders,
  };

  try {
    const fetchOpts = {
      method: req.method,
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(25_000),
    };
    if (req.method === 'POST' && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }
    if (req.method === 'GET') {
      const qs = new URLSearchParams(req.query || {}).toString();
      if (qs) upstreamUrl += '?' + qs;
    }

    const upstream = await fetch(upstreamUrl, fetchOpts);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);

    // Forward rate-limit info only (not auth info)
    const rl = upstream.headers.get('x-ratelimit-remaining-requests');
    if (rl) res.setHeader('x-ratelimit-remaining', rl);

    if (ct.includes('application/json')) {
      return res.status(upstream.status).json(await upstream.json());
    }
    return res.status(upstream.status).send(await upstream.text());

  } catch (err) {
    // Log error type only — never headers or body
    const safeMsg = err.name === 'TimeoutError' ? 'Upstream timeout (25s)' : 'Upstream connection failed';
    return res.status(502).json({ error: safeMsg });
  }
};
