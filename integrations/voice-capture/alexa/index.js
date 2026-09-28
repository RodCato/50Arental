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
  return {request_id: request.requestId, request_timestamp: timestamp};
}

async function postEvent(event, {env = process.env, fetchImpl = fetch, timeoutMs = 6000} = {}) {
  const url = new URL(env.FIFTY_A_VOICE_ENDPOINT);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/api/alexa/water' || url.search || url.hash) throw new Error('Invalid endpoint');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(env.FIFTY_A_VOICE_TOKEN || '')) throw new Error('Missing token');
  // No redirect or automatic retry. A lost acknowledgement may follow a commit.
  const response = await fetchImpl(url.href, {method: 'POST', headers: {'Content-Type': 'application/json',
    Authorization: `Bearer ${env.FIFTY_A_VOICE_TOKEN}`}, body: JSON.stringify(event),
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error('HTTP failure');
  const result = await response.json();
  if (result.ok !== true || result.request_id !== event.request_id || typeof result.duplicate !== 'boolean') throw new Error('Unconfirmed write');
  return result;
}

function createHandler({env = process.env, fetchImpl = fetch, timeoutMs = 6000} = {}) {
  return async envelope => {
    // Authenticity is enforced by the ASK Lambda trigger, restricted to this ID.
    // This additional check fails closed on missing/mismatched configuration.
    const applicationId = envelope?.context?.System?.application?.applicationId || envelope?.session?.application?.applicationId;
    if (!env.ALEXA_SKILL_ID || applicationId !== env.ALEXA_SKILL_ID) throw new Error('Unauthorized skill');
    const userId = envelope?.context?.System?.user?.userId || envelope?.session?.user?.userId;
    if (!env.ALLOWED_ALEXA_USER_ID || userId !== env.ALLOWED_ALEXA_USER_ID) return speech('This voice ledger is private.');
    const request = envelope.request || {};
    if (request.type === 'SessionEndedRequest') return {version: '1.0', response: {}};
    if (request.type === 'LaunchRequest') return speech('Say add a gallon to record one gallon with 50-A.', false);
    if (request.type !== 'IntentRequest') return speech('Say add a gallon.', false);
    const intent = request.intent?.name;
    if (['AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(intent)) return speech('Okay.');
    if (intent !== 'AddGallonIntent') return speech('You can say add a gallon, or stop.', false);
    try {
      await postEvent(waterEvent(request), {env, fetchImpl, timeoutMs});
      return speech('Added one gallon to 50-A.');
    } catch (_) {
      return speech("I couldn't confirm the gallon with 50-A.");
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.waterEvent = waterEvent;
exports.postEvent = postEvent;
