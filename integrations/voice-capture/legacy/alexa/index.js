'use strict';

function speech(text, end = true) {
  const response = {outputSpeech: {type: 'PlainText', text}, shouldEndSession: end};
  if (!end) response.reprompt = {outputSpeech: {type: 'PlainText', text: 'Say add a gallon, or stop.'}};
  return {version: '1.0', response};
}

function waterEvent(request) {
  if (typeof request.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,193}$/.test(request.requestId)) throw new Error('Invalid request ID');
  if (typeof request.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(request.timestamp)) throw new Error('Invalid timestamp');
  const timestamp = new Date(request.timestamp).toISOString();
  if (timestamp !== request.timestamp.replace(/(?<=:\d{2})Z$/, '.000Z')) throw new Error('Invalid date');
  return {event_id: `alexa:${request.requestId}`, timestamp, module: 'water', action: 'add', value: 1,
    unit: 'gallon', merchant: '', category: '', source: 'alexa', synced: false};
}

async function postEvent(event, {env = process.env, fetchImpl = fetch, timeoutMs = 6000} = {}) {
  const url = new URL(env.SHEETS_WEB_APP_URL);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid web app URL');
  if (!env.VOICE_CAPTURE_TOKEN || env.VOICE_CAPTURE_TOKEN.length < 32) throw new Error('Missing token');
  // Native fetch follows Apps Script's ContentService redirect as a GET.
  // No automatic retries: a timeout can mean the row was already saved.
  const response = await fetchImpl(url.href, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({token: env.VOICE_CAPTURE_TOKEN, event}), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error('HTTP failure');
  const result = await response.json();
  if (result.ok !== true || result.event_id !== event.event_id || typeof result.duplicate !== 'boolean') throw new Error('Unconfirmed write');
  return result;
}

function createHandler({env = process.env, fetchImpl = fetch, timeoutMs = 6000} = {}) {
  return async envelope => {
    // Authenticity is enforced by the ASK Lambda trigger, restricted to this ID.
    // This additional check fails closed on missing/mismatched configuration.
    const applicationId = envelope?.context?.System?.application?.applicationId || envelope?.session?.application?.applicationId;
    if (!env.ALEXA_SKILL_ID || applicationId !== env.ALEXA_SKILL_ID) throw new Error('Unauthorized skill');
    const userId = envelope?.context?.System?.user?.userId || envelope?.session?.user?.userId;
    if (env.ALLOWED_ALEXA_USER_ID && userId !== env.ALLOWED_ALEXA_USER_ID) return speech('This voice ledger is private.');
    const request = envelope.request || {};
    if (request.type === 'SessionEndedRequest') return {version: '1.0', response: {}};
    if (request.type === 'LaunchRequest') return speech('Say add a gallon to save one gallon to your Sheet.', false);
    if (request.type !== 'IntentRequest') return speech('Say add a gallon.', false);
    const intent = request.intent?.name;
    if (['AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(intent)) return speech('Okay.');
    if (intent !== 'AddGallonIntent') return speech('You can say add a gallon, or stop.', false);
    try {
      const result = await postEvent(waterEvent(request), {env, fetchImpl, timeoutMs});
      return speech(result.duplicate ? 'That gallon is already saved to your Sheet.' : 'Saved one gallon to your Sheet.');
    } catch (_) {
      return speech("I couldn't confirm the save. Check your Sheet before adding that gallon again.");
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.waterEvent = waterEvent;
exports.postEvent = postEvent;
