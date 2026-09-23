# Phase 2B: controlled cloud ledger

The deployed code does **not** activate any device automatically. Each browser defaults to local mode. The certified phone backup remains immutable recovery material. Do not enable the phone until the Mac/disposable production check below passes.

## Architecture and operations

`cloud/repository.mjs` centralizes authenticated publishable-client RPC access. `ledger-model.mjs` reconstructs the existing runtime and translates business mutations, reusing the shared backup validator, finance utilities and recurring-payment logic. No startup seeds or legacy migrations run against cloud rows. Transaction/item IDs remain stable through queued retries. New item IDs are generated once when intent is persisted.

`20260923000200_cloud_ledger_rpc.sql` adds owner-scoped `ledger_read()` and `ledger_apply(operation_id, expected_revision, changes)`, plus `ledger_operations` receipts. This is idempotency metadata in the existing Supabase database, not another synchronization database. Receipts contain owner, operation ID, payload digest and result revision, not a second ledger. All APIs are security-invoker with RLS; anonymous execution is revoked.

One logical save runs in one Postgres transaction, including the parent, all changed items and an explicitly requested variable estimate. A per-owner advisory lock serializes RPC writes. A ledger-wide revision rejects stale saves (including edits to otherwise unrelated records); this intentionally favors visible conflicts over silent merging. Invalid child rows roll back the parent. Payment-driven fixed-bill changes are rejected server-side, and variable estimates must equal the associated actual payment minus the one-time portion. Standalone fixed-bill edits remain supported.

`ledger_read()` uses a stable statement snapshot. Its revision includes server audit timestamps. Same-operation retries return the original receipt before revision comparison; a different payload with that operation ID is rejected. The app never makes independent parent/child REST writes. Do not introduce direct REST business writes that bypass this concurrency contract.

## Device storage, offline behavior and privacy

`50a-data-mode` binds cloud mode to one owner. `50a-cloud:<owner>` stores the last confirmed snapshot, projected local draft, durable ordered operation queue and recovery reference as one localStorage value. This is a cache and pending intent, not an independently merging ledger. The old `fiftyA-ledger-v1` value and its IndexedDB evidence are left untouched.

A browser Web Lock allows one cloud-editing tab per origin. Other tabs require closing the editing tab and reloading before mutation. Focus/open/online/manual refreshes load cloud state; no realtime subscription is used. Refresh does not replace the revision behind an open transaction/bill dialog or unsaved settings. Editing is paused while a cloud request is in progress.

Offline saves keep UUID operation keys and queue order across reload. Successfully acknowledged operations leave the queue atomically with assigning the next expected revision. A lost response is safe to retry. A conflict or rejected save stops replay, retains the full local intent and fetches current cloud data. Network failures retain the queue without inventing a conflict.

Settings offers export of pending intent (explicitly **not Backup v3**). After review, “Use cloud version; archive pending intent” requires confirmation and preserves the queued intent in the owner cache while selecting current cloud data. No force-overwrite option is provided. Archived intent remains exportable. Rollback is blocked while active pending operations remain; resolve or archive them explicitly first.

Sign-out clears the visible runtime and locks the page, but does not delete cache or recovery material. A different account cannot display or upload the bound owner's cache. A temporarily offline tab with its existing Auth session can display its owner-bound cache. If no session is available (for example a new browser session), authentication is required before private cached data is displayed. Auth tokens remain separate in the existing sessionStorage configuration.

## Activation and rollback

Activation requires authenticated access and the initial certified counts and financial checkpoints. It reads the full cloud ledger, validates relationships, creates and reads back a verified v3 recovery backup of the **current local device**, checks rendered run-rate/savings/water values, verifies local state did not change during preparation, then commits the device-local mode flag. Preparation failure leaves local mode usable. Recovery backups live in the existing IndexedDB recovery store under `cloud-before:<UUID>`.

“Return to local ledger” requires confirmation and returns to the preserved original local value. It does not copy the cloud draft over local state, delete cloud rows, remove archived pending intent, or erase recovery backups. Export the pre-cutover backup from Settings before rollback if desired. The original certified download also remains unchanged.

Initial activation remains deliberately gated to the certified baseline. Activate the second device before conducting temporary CRUD tests, or clean up tests back to that baseline first. If real cloud business data has changed since certification, do not alter the gate to force a match; review and authorize a newer cutover baseline separately.

## Existing features and limitations

Manual Backup v3 remains available. Online export refreshes confirmed cloud data first. Pending mutations block v3 export until reconciled or explicitly archived. Offline export requires confirmation and reports the timestamp of the cached confirmed ledger. Pending/archived intent export is a separate review artifact.

Google sync code remains available for local rollback, but its controls and background merge path are disabled in cloud mode. Imports, demo reload and clear-local controls are also disabled there. New receipt/property photo capture is visibly disabled until the cloud-photo phase; no new IndexedDB-only evidence is stranded. No OCR, Alexa, image migration or Google retirement is included.

The service worker caches only allowlisted same-origin shell assets (v13). Supabase/Auth URLs, cloud configuration and private RPC responses are excluded. A cache upgrade does not activate cloud mode.

## Mac/disposable production verification

1. Merge/deploy only after PR review. Open the updated hosted app in a disposable Mac browser profile, or a Mac profile whose current local ledger can be backed up. Do not start on the authoritative phone.
2. In Settings → Cloud ledger, send a Magic Link and open it in that browser/profile. Confirm the receiving tab is signed in. Use the deployed production origin; a preview needs its exact callback URL explicitly allowlisted in Supabase.
3. Click **Check cloud ledger**. Require 9 transactions, 48 items, 4 monthly bills, 27 water events and reconciliation PASS. Stop on a mismatch.
4. Click **Use cloud ledger on this device** and confirm. Require Cloud mode/Connected, pending changes 0 and conflicts 0. Export the pre-cutover recovery backup and retain it.
5. Select September 2026 and verify expenses $139.93, housing/utilities $123, groceries $16.93; recurring run-rate $1,119, monthly savings $652.38, annual savings $7,828.56. All-period expenses are $1,524.52; Waterdrop has 27 events.
6. Reload; confirm Cloud mode persists. Sign out; confirm the ledger is hidden. Sign in again as the same owner; confirm it reloads correctly. A different account must remain locked out of the bound cache.
7. Test offline display/queue in the disposable environment first. Reconnect, require pending count zero, and verify no duplicate rows. To test rollback, choose Return to local ledger; the preserved prior local generation must reappear.

Hosted Magic Link delivery and installed phone behavior require this manual verification. Automated browser tests use isolated profiles and synthetic Auth/transport, not the production user's tokens.

## Later phone activation — not authorized automatically

After the Mac production checks pass and the user explicitly approves phone cutover:

1. Keep the certified backup and export a fresh backup of the phone's current local ledger. Open the updated production PWA and sign in as the same owner.
2. Check the cloud ledger and require the certified initial reconciliation. If phone/local data changed after certification, stop to review those differences; activation does not upload them.
3. Choose Use cloud ledger on this device, read the confirmation and activate. Export the phone's pre-cutover recovery backup.
4. Verify the same values, reload persistence and privacy behavior. Only then perform the cross-device tests below.

## Phone + Mac test plan and cleanup

Use only visibly named temporary records; never edit certified payments for a test.

- Mac: create `Cloud Sync Test` with one item, $1.23, category Other / bucket Housing one-time. Phone: refresh and verify it.
- Phone: edit that item to $2.34. Mac: refresh and verify. Then edit the temporary transaction and choose **Delete transaction**, confirm, and refresh both devices. Require return to 9 transactions and 48 items.
- Phone: add one gallon. Mac: refresh and verify 28. Undo the **new test event** on the device showing it as the latest event; refresh both to 27. Do not undo a certified historical gallon.
- Use a temporary recurring bill for an offline/conflict exercise in an isolated synthetic environment. On production, if testing a bill change, record its exact prior amount, change only with explicit user approval, then restore that amount and verify the $1,119 run-rate. Deactivation does not delete a test bill, so do not create production test bills merely to exercise cleanup.
- Conflict: in synthetic/disposable testing, keep an edit open on Mac, commit a change from another client, then save the stale Mac edit. Require visible conflict and preserved pending intent, not silent replacement. Export intent before explicitly selecting/archiving to the cloud version.

## Validation commands

```sh
npm test
npm run test:backup
npm run check
npm run test:rls
npm run test:cloud
npm run build
npm run test:cloud:browser
git diff --check
```

Database tests create their own socket-only PostgreSQL clusters and synthetic owners. Browser tests create disposable Chromium profiles; `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` may select installed tooling. `MOBILE_TEST=1` uses a 390×844 touch viewport and enables the service worker. This tests the mobile shell and cache behavior, not installation on a physical iPhone. Production validation uses only baseline/RPC reads and rolled-back policy probes; no test business records are inserted there.
