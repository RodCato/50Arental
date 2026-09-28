// LEGACY LIVE GOOGLE SHEET WRITER. Never run for Alexa-001 validation.
if (process.env.ALLOW_LEGACY_SHEET_WRITE !== 'I_UNDERSTAND_THIS_WRITES_A_LIVE_SHEET') throw Error('Legacy live writer disabled');
'use strict';
// Real writes: adds one test gallon, then resends the same event to test deduplication.
const {randomUUID} = require('node:crypto');
const {postEvent} = require('./alexa/index');
const event = {event_id: `test:${randomUUID()}`, timestamp: new Date().toISOString(), module: 'water', action: 'add', value: 1, unit: 'gallon', merchant: '', category: '', source: 'alexa', synced: false};
(async () => {
  console.log(`Test event ID: ${event.event_id}`);
  const first = await postEvent(event);
  if (first.duplicate) throw new Error('Expected a new event');
  const retry = await postEvent(event);
  if (!retry.duplicate) throw new Error('Expected duplicate acknowledgement');
  console.log('PASS: new write acknowledged; retry recognized. Verify exactly one row in Events.');
})().catch(() => {console.error('Not confirmed. Check the Sheet for the printed event ID before running again.'); process.exitCode = 1;});
