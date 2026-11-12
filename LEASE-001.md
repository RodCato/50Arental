# LEASE-001 — review and deployment notes

Baseline: utilities-001-monthly-cost-analytics `3c76f00fe9693b35f288409ad9fd87772825358a`. Feature branch: lease-001-renewal-tracker. No signed lease was supplied; no dates are seeded or inferred.

## Data and behavior

Optional `settings.leaseTracker`, version 1, is stored under the existing local ledger key. Absent metadata is unknown/unverified at read time, without rewriting history. Save changes preserves verification only when signed-term fields are unchanged. Verify & save requires an explicit confirmation, end date, usable notice rule/date and source reference. Amendments reset verification; proposal edits alone do not.

Calendar dates use UTC day arithmetic without parsing local midnight. In-app reminders begin 45 days before the verified notice deadline and continue when overdue/expired. Fixed dates support user-confirmed contractual rules; no business-day inference is made. No OS notification, scheduled push, email or background delivery is promised.

Current monthly housing charge is derived from the selected fixed housing-charge bill, or a unique bill named Rent, using revisions effective on the current date. Future mid-month revisions are not applied early. Unknown, missing, inactive, variable or utility bills produce unavailable comparisons. The approved $965 Rent bill includes $950 contractual rent plus $15 trash/pest fees. Preserve this bill; the proposal must include comparable applicable fees, not base rent alone. No separate authoritative rent amount is stored. Proposed cents affect only comparisons, never financial totals, bills or transactions; accept actual rent changes through the existing Monthly bills workflow.

## Persistence and release order

Backup format remains v3 with one strictly validated optional settings field. Old valid v3 artifacts remain importable with identical re-export state hashes. New metadata participates in the existing state hash; attachment manifests/bytes and staged restore protections are unchanged. Older strict validators will reject the new field, so use this version or newer to restore such backups. Legacy Google sync and the certified Phase 2A one-off importer reject lease metadata rather than dropping it.

1. Apply all prior migrations in order, including beneficiary contract v5.
2. Dry-run and review `20261111000200_lease_tracker.sql`, then apply only after the approved release preflight verifies recovery and production compatibility. It adds nullable `user_settings.lease_tracker` with a strict JSON check, no default/backfill. Read/apply/capabilities RPC definitions retain prior authorization, finance and evidence protections.
3. Verify unchanged business snapshots/revisions, RLS and Storage, plus contract v6, read version 6 and `lease_tracker_v1`.
4. Deploy shell v34 and refresh devices before entering lease terms. New lease writes fail closed on unsupported contracts. Old client reads fail closed once lease metadata exists; trusted server bridges keep their complete snapshots.

The existing device queue serializes the metadata; global revision conflicts retain pending intent and require explicit review, without silent field merging. Lost-ack replay uses existing idempotency receipts. No queue schema change is needed.

Rollback: do not drop the column, rewrite rows or remove metadata. Keep additive schema/data, forward-fix the client. Reverting to an old shell while metadata exists blocks reads by design. A proposal can be removed in the form without clearing verified terms. No remote migration or rollout was performed during implementation.

## Validation and manual acceptance

Run `npm test`, `npm run check`, `npm run build`, `git diff --check`, `npm run test:lease:db`, `npm run test:lease:browser`, and `npm run test:backup:browser`. DB suites require local PostgreSQL binaries; browser suites require Playwright and Chrome. All use disposable synthetic fixtures. Also run existing navigation, beneficiary, utilities, housing, cloud and backup regressions.

Manual acceptance on Mac and phone after an authorized future rollout:
- Open Overview/Housing; absent terms are visibly unverified, with no contractual alert.
- Enter actual signed lease/addendum dates, delivery requirements and reference; Save alone stays unverified. Confirm signed terms and Verify & save.
- Confirm distinct lease end, notice deadline and reminder-start date (45 days earlier).
- Select the housing-charge bill, compare a proposed amount and remove it. Confirm bills and financial totals stay unchanged.
- Amend a signed term; verification and alerts reset until verified again.
- Check keyboard focus, dialog scrolling and touch controls. Confirm offline replay and cross-device read-back on a compatible backend.

Physical-device testing and live migration/deployment are intentionally deferred; no user browser storage or real backup files are used by automated validation.

## Recorded implementation validation

- `npm test`: 275 passed; no failures or skips.
- `npm run check`, `npm run build`, `git diff --check`: passed.
- Disposable database suites: lease (8 groups), beneficiary (8 groups), housing (14 groups), cloud RPC/security: passed.
- Isolated browser suites: lease (320/390/1280px), navigation, beneficiary, utilities, housing, cloud, compatibility: passed.
- Portable Backup browser suite: legacy v2/v3 import, embedded image decode, IDB stage/abort, lease restore/reload/export hashes, interrupted activation, render-failure recovery: passed.
- Pending production migration remains unapplied; physical phone/Mac acceptance and live cross-device synchronization are not exercised.

## Changed files

- UI/calculations: `lease-utils.js`, `lease-ui.js`, `index.html`, `styles.css`, `app.js` (validation/legacy-sync protection only).
- Persistence: `backup-utils.js`, `cloud/ledger-model.mjs`, `cloud/contract.mjs`, `cloud/repository.mjs`, `scripts/migration/model.mjs`.
- Migration: `supabase/migrations/20261111000200_lease_tracker.sql`.
- Build/cache: `package.json`, `scripts/build.mjs`, `sw.js` (v34).
- Tests: `tests/lease.test.mjs`, `scripts/test-lease-db.mjs`, `scripts/test-lease-browser.mjs`, `scripts/test-backup-browser.mjs`, `scripts/test-beneficiary-db.mjs`, `scripts/test-housing-db.mjs`, `tests/recurring.test.js`.
- Documentation: `LEASE-001.md`.

No edits to finance-utils.js, recurring-utils.js, housing-utils.js, utilities-utils.js or automotive-utils.js. Existing transaction and projection arithmetic remains in those unchanged modules.
