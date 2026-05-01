/**
 * Google Apps Script for TrendAI V2 — Learning Loop Edition
 *
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Extensions → Apps Script → paste this entire file → Save
 * 3. Deploy → New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL → set as SHEETS_URL in Vercel env vars
 *    AND update SHEETS_URL const in index.html
 *
 * IMPORTANT: Every time you edit this file you must create a NEW deployment
 * (not update existing) for changes to take effect.
 */

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  // CORS headers via meta — Apps Script handles this automatically for Anyone access
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'No post data received' });
    }

    const data = JSON.parse(e.postData.contents);
    const type = data.type || 'unknown';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    switch(type) {
      case 'idea':       writeIdea(ss, data);      break;
      case 'signals':    writeSignals(ss, data);   break;
      case 'validation': writeValidation(ss, data);break;
      case 'ai_idea':    writeAiIdea(ss, data);    break;
      case 'learning':   writeLearning(ss, data);  break;
      default: return jsonResponse({ success: false, error: 'Unknown type: ' + type });
    }

    return jsonResponse({ success: true, received: type, timestamp: new Date().toISOString() });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  const type = e.parameter && e.parameter.type;

  if (type === 'dump') {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({
        success: true,
        data: {
          ideas:      readSheet(ss, 'ideas'),
          validation: readSheet(ss, 'validation'),
          ai_ideas:   readSheet(ss, 'ai_ideas'),
        }
      });
    } catch(err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  // Health check
  return jsonResponse({ success: true, status: 'ok', timestamp: new Date().toISOString() });
}

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
  } catch(e) { return []; }
}

function writeIdea(ss, data) {
  const sheet = getOrCreateSheet(ss, 'ideas',
    ['timestamp','keyword','score','arr_estimate','intent','market_type','website_generated','generated_by','learned_from']);
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
    idea.learnedFrom || 0,
  ]);
}

function writeSignals(ss, data) {
  const sheet = getOrCreateSheet(ss, 'signals',
    ['keyword','trend_score','trend_direction','rakuten_level','rakuten_items','youtube_results','yahoo_hits','is_mock','processed_at']);
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

function writeValidation(ss, data) {
  const sheet = getOrCreateSheet(ss, 'validation',
    ['keyword','score','verdict','intent','market_type','unlocks_claude','arr_year1','arr_year3','vc_thesis','timestamp']);
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

function writeAiIdea(ss, data) {
  const sheet = getOrCreateSheet(ss, 'ai_ideas',
    ['name','keyword','category','predicted_score','confidence','arr_year1','arr_year3','why_now','based_on','data_points_used','generated_at']);
  sheet.appendRow([
    data.name || '',
    data.keyword || '',
    data.category || '',
    data.predicted_validation_score || 0,
    data.confidence_level || '',
    data.arr_year1 || '',
    data.arr_year3 || '',
    data.why_now || '',
    data.based_on_pattern || '',
    data.data_points_used || 0,
    data.generated_at || new Date().toISOString(),
  ]);
}

function writeLearning(ss, data) {
  const sheet = getOrCreateSheet(ss, 'learning_log',
    ['keyword','predicted_score','actual_score','error','pattern','logged_at']);
  sheet.appendRow([
    data.keyword || '',
    data.predicted_score || 0,
    data.actual_score || 0,
    Math.abs((data.predicted_score||0) - (data.actual_score||0)),
    data.pattern || '',
    new Date().toISOString(),
  ]);
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#0d1117')
      .setFontColor('#00e5a0');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
