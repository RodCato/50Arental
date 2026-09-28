'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {waterEvent, createHandler, postEvent} = require('../alexa/index');
const token = 'test-token-'.repeat(5);
const env = {VOICE_CAPTURE_TOKEN: token, SHEETS_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec', ALEXA_SKILL_ID: 'amzn1.ask.skill.test'};
const request = {type: 'IntentRequest', requestId: 'amzn1.echo-api.request.test-001', timestamp: '2026-09-21T17:00:00Z', intent: {name: 'AddGallonIntent'}};
const envelope = r => ({context: {System: {application: {applicationId: env.ALEXA_SKILL_ID}, user: {userId: 'owner'}}}, request: r});

// Execute the actual Apps Script source with an in-memory Sheets service.
// Cloud authorization, cell coercion, redirects and real lock behavior still need live testing.
function backend({busy = false, broken = false, flushFails = false, configuredToken = token} = {}) {
  const rows = [];
  let held = false, released = 0;
  const sheet = {
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getRange(start, col, count, width) {
      return {
        getValues: () => Array.from({length: count}, (_, i) => Array.from({length: width}, (_, j) => rows[start - 1 + i]?.[col - 1 + j] ?? '')),
        setNumberFormats() {},
        setValues(values) { for (let i = 0; i < values.length; i++) rows[start - 1 + i] = [...values[i]]; }
      };
    }
  };
  const ctx = vm.createContext({
    PropertiesService: {getScriptProperties: () => ({getProperty: key => ({VOICE_CAPTURE_TOKEN: configuredToken, SPREADSHEET_ID: 'test-sheet'})[key]})},
    ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput: body => ({setMimeType: () => JSON.parse(body)})},
    SpreadsheetApp: {openById: () => {if (broken) throw new Error('unavailable'); return {getSheetByName: () => sheet};}, flush() {if (flushFails) {flushFails = false; throw new Error('ambiguous commit');}}},
    LockService: {getScriptLock: () => ({tryLock() {if (busy || held) return false; held = true; return true;}, releaseLock() {held = false; released++;}})}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  if (!broken) ctx.setupSheet();
  return {rows, ctx, released: () => released, send: (event, secret = token) => ctx.doPost({postData: {contents: JSON.stringify({token: secret, event})}})};
}

test('Alexa handler to actual doPost source appends one typed, pending event; retry is deduplicated', async () => {
  const b = backend();
  const handler = createHandler({env, fetchImpl: async (url, options) => {
    assert.equal(url, env.SHEETS_WEB_APP_URL);
    assert.equal(options.redirect, 'follow');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    return {ok: true, json: async () => b.send(body.event, body.token)};
  }});
  assert.match((await handler(envelope(request))).response.outputSpeech.text, /^Saved one gallon/);
  assert.match((await handler(envelope(request))).response.outputSpeech.text, /already saved/);
  assert.equal(b.rows.length, 2);
  assert.deepEqual(b.rows[1], Object.values(waterEvent(request)));
  assert.equal(b.rows[1][9], false);
  assert.equal(b.released(), 2);
});

test('distinct Alexa requests create distinct events', () => {
  const b = backend();
  b.send(waterEvent(request));
  b.send(waterEvent({...request, requestId: 'next-request'}));
  assert.equal(b.rows.length, 3);
});

test('same ID with changed content is rejected; synced flag is excluded from dedup comparison', () => {
  const b = backend(), event = waterEvent(request);
  b.send(event);
  assert.equal(b.send({...event, timestamp: '2026-09-21T17:01:00.000Z'}).error, 'event_id_conflict');
  b.rows[1][9] = true;
  assert.equal(b.send(event).duplicate, true);
  assert.equal(b.rows.length, 2);
});

test('authentication and malformed bodies cannot append', () => {
  const b = backend();
  assert.equal(b.send(waterEvent(request), 'wrong').error, 'unauthorized');
  assert.equal(b.ctx.doPost({postData: {contents: '{'}}).error, 'invalid_json');
  assert.equal(b.ctx.doPost({postData: {contents: 'x'.repeat(9000)}}).error, 'invalid_request');
  assert.equal(b.ctx.doPost({}).error, 'invalid_request');
  assert.equal(b.rows.length, 1);
  assert.equal(backend({configuredToken: ''}).send(waterEvent(request)).error, 'not_configured');
});

test('invalid values, dates, formula payloads, unknown fields and non-water events cannot append', () => {
  const b = backend(), event = waterEvent(request);
  for (const change of [{value: '1'}, {value: 2}, {synced: true}, {synced: 'false'}, {module: 'expense'}, {merchant: '=IMPORTXML("bad")'}, {event_id: '=1+1'}, {timestamp: '2026-02-30T00:00:00.000Z'}, {extra: 'field'}, {category: 'water'}, {source: 'browser'}]) {
    assert.equal(b.send({...event, ...change}).error, 'invalid_event', JSON.stringify(change));
  }
  assert.equal(b.rows.length, 1);
});

test('busy lock and storage failures do not report success', () => {
  assert.equal(backend({busy: true}).send(waterEvent(request)).error, 'busy');
  const b = backend({broken: true});
  assert.equal(b.send(waterEvent(request)).error, 'storage_error');
  assert.equal(b.released(), 1);
});

test('retry after an ambiguous committed write still leaves one row', () => {
  const b = backend({flushFails: true}), event = waterEvent(request);
  assert.equal(b.send(event).error, 'storage_error');
  assert.equal(b.send(event).duplicate, true);
  assert.equal(b.rows.length, 2);
});

test('setup is nondestructive and mismatched headers block append', () => {
  const b = backend();
  b.send(waterEvent(request));
  b.ctx.setupSheet();
  assert.equal(b.rows.length, 2);
  b.rows[0][0] = 'wrong';
  assert.throws(() => b.ctx.setupSheet(), /header mismatch/);
  assert.equal(b.send(waterEvent({...request, requestId: 'next'})).error, 'storage_error');
  assert.equal(b.rows.length, 2);
});

test('skill and optional user restrictions fail before network calls', async () => {
  let calls = 0;
  const handler = createHandler({env: {...env, ALLOWED_ALEXA_USER_ID: 'other'}, fetchImpl: async () => {calls++;}});
  await assert.rejects(handler({request}), /Unauthorized/);
  assert.match((await handler(envelope(request))).response.outputSpeech.text, /private/);
  assert.equal(calls, 0);
  await assert.rejects(createHandler({env: {}})(envelope(request)), /Unauthorized/);
});

test('launch, help, fallback, stop, session end and unrelated requests never write', async () => {
  let calls = 0;
  const handler = createHandler({env, fetchImpl: async () => {calls++;}});
  for (const intent of ['AMAZON.HelpIntent', 'AMAZON.FallbackIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent', 'UnknownIntent']) await handler(envelope({...request, intent: {name: intent}}));
  assert.equal((await handler(envelope({type: 'LaunchRequest'}))).response.shouldEndSession, false);
  await handler(envelope({type: 'SessionEndedRequest'}));
  await handler(envelope({type: 'UnknownRequest'}));
  assert.equal(calls, 0);
});

test('HTTP, login HTML, negative acknowledgement, wrong ID and network failures never claim success', async () => {
  for (const fetchImpl of [async () => ({ok: false}), async () => ({ok: true, json: async () => {throw new Error('HTML');}}), async () => ({ok: true, json: async () => ({ok: false})}), async () => ({ok: true, json: async () => ({ok: true, event_id: 'other', duplicate: false})}), async () => {throw new Error('offline');}]) {
    const response = await createHandler({env, fetchImpl})(envelope(request));
    assert.match(response.response.outputSpeech.text, /couldn't confirm/);
  }
});

test('slow requests are aborted and leave an uncertain-save response', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const handler = createHandler({env, timeoutMs: 10, fetchImpl: (_, {signal}) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))});
    assert.match((await handler(envelope(request))).response.outputSpeech.text, /Check your Sheet/);
  } finally {clearTimeout(keepAlive);}
});

test('invalid configuration and missing request identity cannot send writes', async () => {
  let calls = 0;
  const fetchImpl = async () => {calls++;};
  for (const url of ['http://script.google.com/macros/s/id/exec', 'https://example.com/exec', 'https://script.google.com/macros/s/id/dev', env.SHEETS_WEB_APP_URL + '?token=secret']) {
    await assert.rejects(postEvent(waterEvent(request), {env: {...env, SHEETS_WEB_APP_URL: url}, fetchImpl}));
  }
  for (const change of [{requestId: ''}, {timestamp: '2026-02-30T17:00:00Z'}, {timestamp: ''}]) assert.throws(() => waterEvent({...request, ...change}));
  assert.equal(calls, 0);
});
