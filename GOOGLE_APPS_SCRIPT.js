/**
 * Google Apps Script for TrendAI V2 — Learning Loop Edition
 *
 * SETUP:
 * 1. Create Google Sheet named "TrendAI Results"
 * 2. Tools → Script Editor → Paste this entire file
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy deployment URL → set as SHEETS_URL env var in Vercel
 * 5. Also paste SHEETS_URL into index.html const SHEETS_URL = '...'
 *
 * SHEET TABS (auto-created):
 *   ideas        — one row per keyword search
 *   signals      — raw API data per search
 *   validation   — scoring breakdown
 *   ai_ideas     — AI self-generated ideas (learning output)
 *   learning_log — model accuracy tracking over time
 */

// ─── POST handler — receive data from frontend / Vercel ───────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type || 'unknown';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    switch(type) {
      case 'idea':        writeIdea(ss, data);       break;
      case 'signals':     writeSignals(ss, data);    break;
      case 'validation':  writeValidation(ss, data); break;
      case 'ai_idea':     writeAiIdea(ss, data);     break;
      case 'learning':    writeLearning(ss, data);   break;
      default: return error('Unknown type: ' + type);
    }

    return success({ received: type, timestamp: new Date().toISOString() });
  } catch (err) {
    return error(err.toString());
  }
}

// ─── GET handler — health check OR data dump for learning loop ────────────────
function doGet(e) {
  const type = e.parameter && e.parameter.type;

  // /exec?type=dump — returns history for AI learning
  if (type === 'dump') {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return success({
        ideas:      readSheet(ss, 'ideas'),
        validation: readSheet(ss, 'validation'),
        ai_ideas:   readSheet(ss, 'ai_ideas'),
      });
    } catch(err) {
      return error(err.toString());
    }
  }

  // /exec — health check
  return success({ status: 'ok', timestamp: new Date().toISOString() });
}

// ─── Read sheet rows as array of objects ──────────────────────────────────────
function readSheet(ss, name) {
  try {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    return data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  } catch(e) {
    return [];
  }
}

// ─── Write: search result idea ────────────────────────────────────────────────
function writeIdea(ss, data) {
  const sheet = ss.getSheetByName('ideas') || ss.insertSheet('ideas');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp','keyword','score','arr_estimate','intent','market_type','website_generated','generated_by','idea_json']);
    sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#00e5a0');
  }
  const idea = data.idea_json || {};
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.keyword   || '',
    data.score     || 0,
    data.arr_estimate || idea.arr?.year1 || '',
    data.intent    || '',
    data.market_type || '',
    idea.websiteGenerated ? 'Yes' : 'No',
    idea.generatedBy || 'unknown',
    JSON.stringify(idea),
  ]);
}

// ─── Write: raw signal data ───────────────────────────────────────────────────
function writeSignals(ss, data) {
  const sheet = ss.getSheetByName('signals') || ss.insertSheet('signals');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword','trend_score','trend_direction','rakuten_level','rakuten_items','youtube_results','yahoo_hits','is_mock','processed_at']);
    sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#00e5a0');
  }
  const t = data.trend || {}, r = data.rakuten || {}, y = data.youtube || {}, yh = data.yahoo || {};
  sheet.appendRow([
    data.keyword || '',
    t.score      || 0,
    t.trend      || '',
    r.demandSignal?.level || '',
    r.demandSignal?.itemCount || 0,
    y.totalResults || 0,
    yh.totalHits   || 0,
    (r.mock || y.mock) ? 'Yes' : 'No',
    data.processed_at || new Date().toISOString(),
  ]);
}

// ─── Write: validation score breakdown ───────────────────────────────────────
function writeValidation(ss, data) {
  const sheet = ss.getSheetByName('validation') || ss.insertSheet('validation');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword','score','verdict','intent','market_type','unlocks_claude','arr_year1','arr_year3','vc_thesis','timestamp']);
    sheet.getRange(1,1,1,10).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#00e5a0');
  }
  sheet.appendRow([
    data.keyword        || '',
    data.score          || 0,
    data.verdict        || '',
    data.intent         || '',
    data.market_type    || '',
    data.unlocks_claude ? 'Yes' : 'No',
    data.arr_year1      || '',
    data.arr_year3      || '',
    data.vc_thesis      || '',
    new Date().toISOString(),
  ]);
}

// ─── Write: AI self-generated idea (learning output) ─────────────────────────
function writeAiIdea(ss, data) {
  const sheet = ss.getSheetByName('ai_ideas') || ss.insertSheet('ai_ideas');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['name','keyword','category','predicted_score','confidence','arr_year1','arr_year3','why_now','based_on','data_points_used','generated_at']);
    sheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#0d2818').setFontColor('#00e5a0');
  }
  sheet.appendRow([
    data.name                   || '',
    data.keyword                || '',
    data.category               || '',
    data.predicted_validation_score || 0,
    data.confidence_level       || '',
    data.arr_year1              || '',
    data.arr_year3              || '',
    data.why_now                || '',
    data.based_on_pattern       || '',
    data.data_points_used       || 0,
    data.generated_at           || new Date().toISOString(),
  ]);
}

// ─── Write: model accuracy log ────────────────────────────────────────────────
function writeLearning(ss, data) {
  const sheet = ss.getSheetByName('learning_log') || ss.insertSheet('learning_log');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword','predicted_score','actual_score','error','pattern','model_iteration','logged_at']);
    sheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#1a0a2e').setFontColor('#a78bfa');
  }
  sheet.appendRow([
    data.keyword         || '',
    data.predicted_score || 0,
    data.actual_score    || 0,
    Math.abs((data.predicted_score||0) - (data.actual_score||0)),
    data.pattern         || '',
    data.model_iteration || 1,
    new Date().toISOString(),
  ]);
}

function success(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
