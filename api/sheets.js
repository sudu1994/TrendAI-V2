/**
 * api/sheets.js — Server-side proxy for Google Sheets writes
 * Browser → Vercel (no CORS) → Google Apps Script → Sheets
 * POST /api/sheets  { type, ...data }
 */
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const SHEETS_URL = process.env.SHEETS_URL || '';

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return err(res, 405, 'POST only');
  if (!SHEETS_URL) return err(res, 503, 'SHEETS_URL not configured');

  try {
    const payload = req.body;
    if (!payload || !payload.type) return err(res, 400, 'Missing type');

    const r = await axios.post(SHEETS_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    return ok(res, { sent: true, sheetsResponse: r.data });
  } catch (e) {
    console.error('[sheets proxy] failed:', e.response?.data || e.message);
    return err(res, 500, e.message);
  }
};
