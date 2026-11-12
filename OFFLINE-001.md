# OFFLINE-001 — offline initialization diagnosis

Branch: lease-001-renewal-tracker; HEAD before work: 3c76f00. Existing uncommitted lease work preserved. No application, financial, persistence, authentication or service-worker change was needed.

## Root cause and evidence

The offline harness in `scripts/test-fin002-offline.mjs` used `context.route('**/*', ...continue...)` even for the local application origin. In the installed Chromium/Playwright combination this interception caused speculative/deferred script requests to fail when `context.setOffline(true)` was followed by reload. They did not reach the service-worker response path. This was a harness-induced initialization failure, not an exception inside Housing rendering.

Instrumented disposable runs captured console errors, page errors, rejected requests, response status/service-worker provenance, listener registrations and startup events:

- Online: all five deferred assets returned 200; UI initializers ran.
- Offline with catch-all routing: `housing-ui.js`, `lease-ui.js`, `automotive-ui.js`, `utilities-ui.js`, and `cloud-foundation.js` failed with `net::ERR_INTERNET_DISCONNECTED`. Non-deferred utility scripts and dynamically loaded app.js returned 200 through the service worker.
- `ledger-ready` fired, but Housing's start listener was never registered because its script never executed. Housing dialog count was zero; Income and Housing panels were empty. Lease, Automotive and Utilities initializers were also absent. No Housing render exception or unhandled rejection explained the failure.
- A controlled run with native local requests, using identical app/build/worker bytes, passed. Narrowing routing to external origins retained the outbound-network guard and also passed repeatedly.

`sw.js` already precaches these assets; build paths were correct. `backup-boot.js` still restores before injecting app.js; `app.js` publishes LedgerApp and fires ledger-ready; `housing-ui.js` handles either startup order. No source changes or baseline worktree were necessary to isolate the cause.

## Repair and regression proof

Only external-origin requests are intercepted and blocked. Local requests exercise real browser/SW behavior. The test requires a disabled-cloud build; it never connects to production or an existing profile.

The suite derives the cache name from sw.js and asserts the built worker is identical. Each disposable context installs a synthetic prior worker, updates to the current source, and checks old shell removal without deleting unrelated cache content. It then performs online-to-offline reload and another fresh offline document reload. Three widths (320/390/1280), two independent contexts each.

Assertions retain and extend the original failure checks:

- Actual synthetic $1,234.56 Income total and named source; Housing and Lease dialogs initialized exactly once.
- Overview, bills, beneficiary filter, utility section and fuel analytics (30 mpg).
- All five deferred assets return 200 from the service worker offline, with no failed UI requests, page exceptions or unhandled rejections.
- Complete financial state/localStorage unchanged, including an inactive-owner queue preservation fixture; IndexedDB attachment bytes and recovery record unchanged; unrelated cache bytes retained.

This queue fixture proves storage preservation, not authenticated cloud replay. Existing cloud/capability browser suites separately exercise owner/account locks, pending intent and replay using synthetic transport. Live hosted Auth and installed-phone acceptance remain outside this task.

## Validation

Run npm test, npm run check, npm run build, git diff --check; then test:housing:offline plus navigation, housing, cloud, contract and lease browser suites. Browser runs use temporary local servers and disposable profiles only. The expected failed offline request for uncached cloud-config.json is not a UI script failure; no live network fallback or production credentials are used.

No commit, push, migration, deployment, user-storage clearing or release resumption was performed. Await offline workflow review.

Recorded results: 275 unit tests passed; syntax/build/diff checks passed. Offline suite passed six fresh contexts with two offline reloads each (12 offline reloads total). Navigation, Housing, cloud, cloud capability and lease browser suites all passed. No remaining automated failures. Physical phone/PWA and live hosted Auth acceptance were not performed. Fingerprint comparison confirmed the only pre-existing file changed in this task is `scripts/test-fin002-offline.mjs`; this report is the only added file.
