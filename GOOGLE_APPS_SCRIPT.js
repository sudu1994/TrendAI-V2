function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type || 'unknown';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    switch(type) {
      case 'idea':
        writeIdea(ss, data);
        break;
      case 'signals':
        writeSignals(ss, data);
        break;
      case 'validation':
        writeValidation(ss, data);
        break;
      case 'portfolio':
        writePortfolio(ss, data);
        break;
      case 'learning':
        writeLearning(ss, data);
        break;
      default:
        return error('Unknown type: ' + type);
    }
    
    return success({ received: type, timestamp: new Date().toISOString() });
  } catch (err) {
    return error(err.toString());
  }
}

function writeIdea(ss, data) {
  const sheet = ss.getSheetByName('ideas') || ss.insertSheet('ideas');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'keyword', 'score', 'arr_estimate', 'intent', 'market_type', 'idea_json', 'user_id']);
  }
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.keyword || '',
    data.score || 0,
    data.arr_estimate || '',
    data.intent || '',
    data.market_type || '',
    JSON.stringify(data.idea_json || {}),
    data.user_id || 'anonymous'
  ]);
}

function writeSignals(ss, data) {
  const sheet = ss.getSheetByName('signals') || ss.insertSheet('signals');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword', 'trend', 'rakuten', 'youtube', 'yahoo', 'estat', 'processed_at']);
  }
  sheet.appendRow([
    data.keyword || '',
    JSON.stringify(data.trend || {}),
    JSON.stringify(data.rakuten || {}),
    JSON.stringify(data.youtube || {}),
    JSON.stringify(data.yahoo || {}),
    JSON.stringify(data.estat || {}),
    data.processed_at || new Date().toISOString()
  ]);
}

function writeValidation(ss, data) {
  const sheet = ss.getSheetByName('validation') || ss.insertSheet('validation');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword', 'score', 'verdict', 'vc_rank', 'confidence', 'boost_reason']);
  }
  sheet.appendRow([
    data.keyword || '',
    data.score || 0,
    data.verdict || '',
    data.vc_rank || '',
    data.confidence || 0,
    data.boost_reason || ''
  ]);
}

function writePortfolio(ss, data) {
  const sheet = ss.getSheetByName('portfolio_sim') || ss.insertSheet('portfolio_sim');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword', 'arr', 'survival_prob', 'fail_cluster', 'sector', 'notes']);
  }
  sheet.appendRow([
    data.keyword || '',
    data.arr || '',
    data.survival_prob || '',
    data.fail_cluster || '',
    data.sector || '',
    data.notes || ''
  ]);
}

function writeLearning(ss, data) {
  const sheet = ss.getSheetByName('learning_log') || ss.insertSheet('learning_log');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['keyword', 'predicted_arr', 'actual_arr', 'error', 'model_adjustment']);
  }
  sheet.appendRow([
    data.keyword || '',
    data.predicted_arr || '',
    data.actual_arr || '',
    data.error || '',
    data.model_adjustment || ''
  ]);
}

function success(data) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg) {
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
