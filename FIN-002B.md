# FIN-002B — Automatic recurring monthly expenses

Implemented on `fin-002-housing-income-reconciliation`, starting at `ceb98f12fbda3047d18442202b4c867ab4a8130d`. PR #36 was already merged. Changes remain uncommitted. No push, merge, deployment or production mutation was performed.

This approved policy supersedes FIN-002/FIN-002A statements that monthly expenses contain only manually recorded transactions. Their net-paycheck and income-eligibility policies remain unchanged.

## Model and behavior

`RecurringUtils.monthly` derives one reporting occurrence per bill/month, identified by `recurring:<billId>:<YYYY-MM>`. Occurrences are not database transactions or separately persisted records. Recalculation and reload cannot create additional expenses.

The most recent effective revision supplies amount, kind, activity and scheduling terms. An eligible fixed bill contributes once to expense, housing and category totals. It displays Scheduled / Autopay (or Scheduled when autopay is explicitly disabled); this is not bank verification. Existing null autopay metadata follows the user's confirmation that these bills use autopay. Automatic recognition requires a confirmed effective revision, never precedes its start date and never recognizes future months as actual expenses.

Explicit `recurringChargeId` links suppress the automatic fixed occurrence for that month. Actual transaction items continue through the existing finance calculation exactly once. Multiple legitimate linked payments are preserved. Matching merchant names or amounts never cause deduplication; an unlinked legacy payment must be explicitly linked to suppress an automatic bill.

Variable estimates remain projections. Record actual amount opens the normal transaction draft with the bill already linked and the amount blank. Save creates the normal payment; its service portion replaces that month's estimate in projected reporting. One-time portions remain actual expenses, but are excluded from recurring service projections. Updating the ongoing estimate is optional and initially off in this action. Refundable deposits remain excluded; groceries count in expenses but not housing comparison.

Effective revisions preserve prior months when a future amount changes. Due days clamp to month end. Deactivation uses a month boundary (the shortcut defaults to next month); there is no daily proration. A same-month revision is an explicit correction, not an immutable payment confirmation. Bills without confirmed revision history are not retrospectively invented. The existing generic transaction editor's estimate controls follow current bill configuration.

## Read-only production reconciliation

Before/after SHA-256 fingerprints match for all 16 business tables. Counts, Storage count (12), policies, recorded financial totals and income coverage are unchanged. The existing production bills have first confirmed revisions in October 2026; September's recorded expenses remain $139.93.

October, calculated in memory from cloud read-back using the new reporting logic:

| Measure | Amount |
| --- | ---: |
| Automatically recognized fixed bills | $1,026.00 |
| Recorded variable actuals | $0.00 |
| Outstanding variable estimates | $128.53 |
| Expected recurring obligations | $1,154.53 |
| Other recorded spending (automotive) | $53.00 |
| Total recognized expenses | $1,079.00 |
| Recognized housing | $1,026.00 |
| Recognized utilities (included in housing) | $40.00 |
| Current Josh effective benchmark | $1,771.38 |
| Benchmark less recognized housing | $745.38 |
| Projected recurring monthly savings | $616.85 |
| Projected annual savings | $7,402.20 |
| Eligible net paychecks | $1,040.41 |
| Housing coverage | 90.1% |
| Remaining housing target | $114.12 |

The benchmark difference is not labeled bank-verified or realized savings. Production's current benchmark is $1,771.38. The earlier $1,787.02 reference is not used to overwrite current settings. Recording the synthetic $75 electricity payment produces $1,101 fixed-plus-variable recognized housing, $35.53 outstanding estimates and $1,136.53 projected obligations; the configured income coverage target is unchanged unless the user explicitly updates its estimate.

## Migration and release boundary

Prepared **but NOT applied to production**: `supabase/migrations/20261024000100_recurring_autopay.sql`.

It adds nullable `effective_date`, `due_day` and `autopay` to existing recurring-charge revisions, with date/month and due-day constraints. There is no business-data backfill, seed, rewrite or policy change. Contract/read version 4 and `recurring_autopay_v1` gate scheduling writes. Readers below v4 fail safely once scheduling metadata is populated; legacy null fields are omitted from read-back so an additive migration does not itself change existing row representations or revision fingerprints. The frontend can still read the existing v3 backend, but scheduling writes require the new capability.

A separate authorized rollout must review/dry-run and apply this migration, verify production rows/policies, and only then deploy the frontend (prepared shell `50a-ledger-shell-v29`). Local rollback and populated migration tests passed. Once non-null scheduling metadata exists, do not drop its columns or deploy a writer that discards it; prefer a forward fix with v4 reads and preserved queues. No new Alexa permissions or Alexa implementation changes were made.

## Validation

- 243 unit/regression tests passed, including seven new recurring-occurrence tests.
- 14 populated local PostgreSQL groups passed: migration dry-run/rollback, apply with unchanged existing rows, constraints, capabilities, owner/non-owner/anonymous security, atomic writes and idempotency, old-client guards, and the existing narrow service bridge.
- Browser flow passed: automatic fixed bills, linked $75 actual, reload without duplicates, future revision/history, paycheck behavior and offline queue.
- Layout checks passed at 360, 390, 412 and 1280 px, including monthly expenses and configuration dialogs.
- Real service-worker offline reload passed with the synthetic ledger.
- Mobile Backup v3 browser round-trip passed with embedded image bytes and scheduling metadata; unit backup checks passed.
- Build, syntax checks and `git diff --check` passed.

Browser/DB mutation tests used disposable synthetic data and a local database. Production access was read-only. Real Android physical validation and deployed cross-device validation remain release checks; neither deployment nor phone activation occurred.

## Files changed

- `recurring-utils.js`: pure monthly occurrence recognition and month enumeration.
- `housing-utils.js`: scheduling terms and effective revision handling independent of income setup.
- `app.js`, `index.html`: monthly recurring section, Overview/category totals, linked actual draft, configuration controls and dependency order.
- `cloud/contract.mjs`, `cloud/ledger-model.mjs`, `cloud/repository.mjs`: v4 capability gating, optional scheduling fields and read fallback.
- `supabase/migrations/20261024000100_recurring_autopay.sql`: additive schema/read contract.
- `sw.js`: prepared v29 cache.
- `tests/recurring-occurrences.test.mjs`, `tests/recurring.test.js`: recognition/history/backup/income regressions and harness dependency.
- `scripts/test-housing-db.mjs`, `scripts/test-housing-browser.mjs`, `scripts/test-fin002-offline.mjs`, `scripts/test-backup-browser.mjs`: local DB, responsive workflow, offline and backup coverage.
- `FIN-002B.md`: this handoff.
