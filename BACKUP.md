# Portable Backup v3 (BACKUP-002)

Local storage remains authoritative. This implementation does not upload, map, or migrate data to Supabase. A verified phone artifact is the prerequisite for a later migration.

## Format and hashes

The JSON wrapper is `format: "50a-ledger-backup"`, `version: 3`, with:

- `exportedAt`: UTC timestamp.
- `application`: `{name: "50A Ledger", schemaVersion: 3}`.
- `state`: portable business data, including original numeric strings, classifications, transaction and bill IDs, dates, inactive bills, associations, one-time portions, lease/Josh settings, budget, property records, Waterdrop history, and dataset/migration markers. `portableSchemaVersion: 3` selects the current-state startup path.
- `provenance`: source version, original transaction/property `_sync` timestamps, and deletion tombstones. A restored artifact carries its source provenance forward. Recurring-charge timestamps remain in business state. This is source provenance, not a cloned synchronization identity.
- `attachments`: one record per unique referenced ID; parent type/ID, original filename, MIME, createdAt, byte size, SHA-256 and base64 data URL.
- `manifest`: attachment count, ordered attachment metadata (everything except data), and inline receipt evidence metadata/hashes.
- `integrity.stateSha256`: SHA-256 of UTF-8 canonical JSON for `state`.
- `integrity.manifestSha256`: SHA-256 of canonical JSON for `{format,version,exportedAt,application,provenance,manifest,stateSha256}`.

Canonical JSON recursively sorts object keys using JavaScript `Object.keys().sort()` (UTF-16 ordering), retains array order, and uses JSON string/number encoding without whitespace. Finite numbers only. Each evidence hash covers the exact decoded bytes, without image re-encoding. The independent CLI additionally hashes the exact original file bytes; whitespace and exportedAt changes affect that whole-file hash. Hashes detect alteration/inconsistency, not the identity of the file's author.

Images currently supported are PNG, JPEG and WebP, up to 20 MiB each. Backups are bounded to 128 MiB. Magic-byte validation is a sanity check, not a full image-decoder proof; browser integration tests exercise decoding separately. Unknown schema fields are rejected rather than silently discarded or certified.

## Snapshot and evidence completeness

Export deep-clones business state and provenance synchronously, before its first asynchronous read. Attachment references and serialized state both use that same snapshot. The caller captures the active attachment generation at export start. Concurrent edits cannot alter that snapshot; evidence removed during export makes export fail. No arbitrary remote URL is fetched.

Transaction `attachmentIds` and condition `attachmentId` references are deduplicated. One ID shared by incompatible parents is rejected. Every reference must resolve to a blob with matching parent metadata. Missing or unreadable evidence blocks the download and success message. Repeated references within one transaction are allowed.

Legacy transaction `receipt` data URLs remain inline so the original business representation is preserved; decoded byte hashes, MIME and size are listed in `manifest.inlineEvidence`. IndexedDB references are in the normal attachments manifest. Blob URLs, HTTP(S) URLs, relative paths, invalid references, unsupported image MIME and corrupt base64 block certification. They are never silently omitted.

## Read-only validator

Use Node 22+:

```sh
node scripts/validate-backup.mjs /path/to/50a-ledger-backup-v3.json
# equivalent:
npm run validate:backup -- /path/to/50a-ledger-backup-v3.json
```

The CLI does not initialize the app, access browser storage, write to the input, access the network, or execute embedded content. It prints whole-file SHA-256, supported format/schema, counts, missing/duplicate/dangling checks, state/evidence integrity, restore-equivalence preflight, all-period expenses, recorded-month aggregates, active recurring run-rate, Josh benchmark and projected savings. It does not print merchants, notes, filenames, images, emails or client IDs. Validation errors identify safe paths/indexes and stop on the first failure; zero-error counts are printed only after successful complete validation. Exit 0 = PASS, 1 = FAIL/read failure, 2 = usage or legacy-v2 REVIEW.

The library in `backup-utils.js` is the same pure validator used in the browser. `validate()` yields validated business state, decoded bytes and aggregate summary suitable for a future importer. No cloud mapper exists here. Preflight checks portable→runtime→portable equivalence; separate tests prove actual app startup/reload behavior.

`finance-utils.js` is shared with the dashboard. Expenses retain the app's exact semantics: excluded-category items still count; avoided/cancelled are skipped; reused contributes zero; refunds use adjustments; held/refunded deposits contribute zero, forfeited deposits contribute their amount, partially refunded deposits contribute amount less clamped returned amount. Gift-card offsets are not subtracted a second time. One-time portions do not reduce actual spending; recurring estimates are independent. Monthly savings are cent-rounded; annual is displayed monthly cents × 12. These totals are not gross cash outflow.

## Current-state restore and legacy v2

Validated v3 is restored without normalizing names, categories, dates, Josh history, lease records or Waterdrop events. `load()` returns marked current state directly; startup skips historical dataset/demo cleanup, Josh correction, sample-date advancement/deduplication, Router/Spectrum overrides, Waterdrop normalization and lease regeneration. Explicit user actions (such as editing lease settings) retain their intended behavior. The first startup of an existing unmarked local ledger runs its existing legacy path once and marks it current; imported v3 never runs that path.

Only explicit `{format:"50a-ledger-backup",version:2,state,attachments}` is supported as legacy import. Raw unversioned/future files are rejected. Legacy v2 is visibly identified and never claimed to have original-file v3 integrity guarantees. Conversion clones the source, fills documented missing optional fields (notes/receipt/attachment arrays, adjustments/status/category, bill active/utility type, one-time zero, settings defaults and version markers), and materializes legacy count/date Waterdrop events with stable legacy IDs only if no event history exists. It does not advance sample dates, rewrite benchmark values/classifications, or regenerate lease data. Reapplying conversion produces the same business state. Missing/malformed recurring or condition collections, conflicting or orphan evidence, unsupported/nonportable images and unverifiable required metadata block import for review. It never mutates the original file.

After legacy conversion, the full v3 validator runs before replacement. The destination still requires a verified v3 pre-import recovery snapshot and follows the identical staged restore path. The user must confirm a sanitized summary, with an explicit v2 warning. The CLI identifies v2 as REVIEW; it does not silently convert or certify it.

## Destination identity and security

Portable business state excludes `syncMeta`, attachment generation, Google client/account/status/error fields and per-record active `_sync`. Original per-record timestamps and tombstones are retained in provenance, not installed into live sync state. Runtime generates a new device identity when needed; Google controls start disconnected with no copied client ID/email/pending flag/hash. No automatic Google reconnect is triggered for a disconnected restored ledger. Supabase/Google Auth tokens remain separate session storage; they are not exported or copied from the source. Existing destination Supabase Auth remains its own session.

Known credential-shaped properties and token/connection-string patterns are rejected without printing their values. This does not make arbitrary user-written notes non-sensitive: the backup remains private financial data. Keep original artifacts in protected storage. Public Supabase configuration remains separate from the portable ledger.

## Durable restore protocol

IndexedDB `50a-ledger` upgrades from version 1 to 2, retaining the original `attachments` store and adding `recovery`. Existing attachment keys continue to work. New generation attachment keys are `generation:<UUID>:<original ID>`; logical IDs exposed to the app and portable backup do not change. Newly captured images still use capture compression; staged restore writes verified bytes directly and never invokes that compression path.

1. Validate all incoming structured data and evidence with no storage writes.
2. Confirm the summary; block editing during restore. Web Locks prevents simultaneous restore operations when available. A storage-event blocker prevents stale other tabs from continuing to edit; optimistic raw-ledger comparisons reject concurrent replacement. Close other app tabs for restore.
3. Create and validate a snapshot of the current in-memory ledger and its reachable evidence. Failure blocks replacement. The previous persisted localStorage string is retained exactly for rollback; any unsaved settings in the in-memory snapshot remain available in the recovery artifact.
4. In one IDB transaction, durably store the verified pre-import snapshot, incoming artifact, and `prepared` journal with old/target localStorage strings and generation IDs.
5. In one IDB transaction, write every new-generation blob and change the journal to `staged`. Any transaction abort keeps old evidence untouched.
6. Compare the old localStorage string, activate the target string with its generation pointer, then mark the journal `activated`. If localStorage or journal writing fails, restore the old pointer. If rollback cannot finish, block editing and require startup recovery.
7. Reload. `backup-boot.js` runs recovery before loading app.js. An unactivated prepared/staged journal keeps the previous state. An activated (or staged-after-pointer-switch) generation is independently reconstructed and hash-checked; failure restores the old pointer. Unexpected third-party state causes a blocked recovery conflict, never a blind overwrite.
8. After the real application renders successfully, verify again and mark `verified`. A render/startup failure rolls back the prior pointer and blocks editing until reload. No premature success message is shown.

This explicitly coordinates two stores; it does not claim localStorage and IDB are one transaction. IDB staging/snapshot transactions are atomic; journal checks bridge interruption windows around localStorage activation. All previous generations and recovery artifacts are retained, including after successful reopen. No automatic pruning is implemented; growing storage can therefore block later imports with an explicit failure instead of deleting recovery data. Browser/OS eviction of an entire origin is outside this journal's protection—keep the portable file outside browser storage.

“Export pre-import recovery snapshot” downloads the latest verified before-import artifact. It uses the same v3 validator before download. Import errors distinguish validation, snapshot, staged-write, activation and post-restore verification. Recovery failures block further editing rather than leave an apparently usable partial state.

## Tests

```sh
npm test
npm run test:backup
npm run check
npm run test:rls
npm run build
git diff --check
```

The backup suite runs synthetic current/v2 round trips, actual `load()` entry, strict schema/reference/hash/security failures, financial comparisons, snapshot mutation races, write/quota failures, interrupted staging/activation, corrupt staged bytes, render failure, next-startup recovery, concurrent changes and read-only CLI behavior. Original transaction/variable-bill, Waterdrop, date and cloud tests still run. `test:rls` creates only an isolated temporary local Postgres cluster.

The separate browser test needs Playwright and Chromium/Chrome (no runtime app dependency):

```sh
# With Playwright available through normal Node resolution:
npm run test:backup:browser
# Or point to an existing installation and browser executable:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROME_EXECUTABLE=/absolute/path/to/chrome npm run test:backup:browser
```

It creates a new isolated browser context and random loopback origin, blocks remote requests, and never opens the user's profile. It tests fresh-app export, the actual confirmation/import UI, real IndexedDB/FileReader/Blob paths, synthetic PNG display, reload/re-export identical byte hashes, a real IDB transaction abort and interrupted activation recovery. Browser process/OS termination at every individual disk-flush boundary is not exhaustively simulated; deterministic fault injection covers the protocol boundaries.

## Authoritative phone procedure after deployment

1. Keep the existing v2 file unchanged. Merge/deploy only after review; load the new PWA version on the phone, close/reopen and confirm v3 controls are present. Do not import over the authoritative phone for testing.
2. With phone edits paused, use **Export 50A Backup**. Require **Backup verified / Integrity: PASS** and expected counts. Any missing/nonportable evidence failure must be resolved; do not treat a failure as permission to omit it.
3. Copy the exact downloaded JSON off the phone to two protected locations. Do not edit/reformat it. Run the standalone validator on one copy; save its sanitized report and file SHA-256 alongside the immutable original. Verify the second copy has the same SHA-256.
4. Compare counts, recorded-month utilities/housing, recurring bills, Josh benchmark, monthly savings and Waterdrop event count with the phone UI. Do not substitute synthetic fixture totals for real totals.
5. In a separate disposable local origin/profile, import a copy. Confirm counts, inactive bills, associations/one-time portions, Waterdrop dates, condition/receipt display, then close/reopen and re-export. Compare business-state hash and attachment hashes; whole-file hashes may differ due to exportedAt. Download the pre-import recovery snapshot to verify that control too.
6. Record this artifact's SHA-256 and PASS as the proposed Phase 2A source. Phase 2A remains a separate task requiring authorization. No real phone file has been certified by the synthetic suite.
