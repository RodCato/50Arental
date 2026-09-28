// Server-side only. No secrets belong in the static 50-A app.
const HEADERS = ['event_id', 'timestamp', 'module', 'action', 'value', 'unit', 'merchant', 'category', 'source', 'synced'];

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('missing spreadsheet');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Events');
  if (!sheet) throw new Error('missing Events tab');
  return sheet;
}

// Run once in the editor. Never clears existing rows.
function setupSheet() {
  const sheet = sheet_();
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  checkHeaders_(sheet);
  sheet.setFrozenRows(1);
}

function checkHeaders_(sheet) {
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(HEADERS)) throw new Error('header mismatch');
}

function validEvent_(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (Object.keys(event).length !== HEADERS.length || !HEADERS.every(key => Object.prototype.hasOwnProperty.call(event, key))) return false;
  if (typeof event.event_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(event.event_id)) return false;
  if (typeof event.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.timestamp)) return false;
  const time = Date.parse(event.timestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== event.timestamp) return false;
  // The schema can grow; the first milestone accepts only this operation.
  return event.module === 'water' && event.action === 'add' && event.value === 1 &&
    event.unit === 'gallon' && event.merchant === '' && event.category === '' &&
    event.source === 'alexa' && event.synced === false;
}

function doPost(e) {
  let payload;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || raw.length > 8192) return reply_({ok: false, error: 'invalid_request'});
    payload = JSON.parse(raw);
  } catch (_) { return reply_({ok: false, error: 'invalid_json'}); }
  const token = PropertiesService.getScriptProperties().getProperty('VOICE_CAPTURE_TOKEN');
  if (!token || token.length < 32) return reply_({ok: false, error: 'not_configured'});
  if (!payload || typeof payload.token !== 'string' || payload.token !== token) return reply_({ok: false, error: 'unauthorized'});
  if (!validEvent_(payload.event)) return reply_({ok: false, error: 'invalid_event'});
  const event = payload.event;
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    acquired = lock.tryLock(1000);
    if (!acquired) return reply_({ok: false, error: 'busy'});
    const sheet = sheet_();
    checkHeaders_(sheet);
    const row = HEADERS.map(key => event[key]);
    // Durable deduplication, serialized with append across invocations.
    const count = sheet.getLastRow() - 1;
    const rows = count > 0 ? sheet.getRange(2, 1, count, HEADERS.length).getValues() : [];
    const previous = rows.find(existing => existing[0] === event.event_id);
    if (previous) {
      // synced may eventually change; the event itself is immutable.
      if (JSON.stringify(previous.slice(0, 9)) !== JSON.stringify(row.slice(0, 9))) return reply_({ok: false, error: 'event_id_conflict'});
      return reply_({ok: true, event_id: event.event_id, duplicate: true});
    }
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length);
    // Preserve IDs/timestamps as text. value and synced remain typed cells.
    range.setNumberFormats([['@', '@', '@', '@', '0', '@', '@', '@', '@', 'General']]);
    range.setValues([row]);
    SpreadsheetApp.flush();
    return reply_({ok: true, event_id: event.event_id, duplicate: false});
  } catch (_) {
    // Never log the body or secret. Failure may occur after the write committed.
    return reply_({ok: false, error: 'storage_error'});
  } finally { if (acquired) lock.releaseLock(); }
}
