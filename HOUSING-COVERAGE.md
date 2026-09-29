# Housing Coverage / Freedom Meter — Finance 001

Implementation on `finance-001-housing-coverage`; shell `50a-ledger-shell-v27`.
No production migration, personal seeding, merge or deployment is authorized by this implementation. Alexa files and its already-merged work are preserved.

## Source model and historical policy

`20260930000100_housing_coverage.sql` adds six owner-scoped tables, all with UUID identity and audit timestamps:

| Table | Durable source fields |
| --- | --- |
| `income_sources` | name, employment/other type, active, optional default hourly rate in cents, optional typical shift length in hundredths of an hour |
| `work_sessions` | source, work date, hundredths of hours, recorded hourly rate in cents, notes |
| `paychecks` | source, pay date, optional confirmed period start/end, optional gross cents, actual net cents, notes |
| `financial_goals` | name, debt/investment/other type, target cents, active/completed flags |
| `coverage_settings` | effective month, selected source, optional next goal; earliest confirmed row establishes the baseline |
| `recurring_charge_revisions` | existing bill ID, effective month, amount cents, active, included, fixed/estimated kind, category, utility type |

No second editable bill list, monthly financial snapshots, stored percentages, or expense records for income. Classification/inclusion is explicit, never inferred from names. Normal bill management stays in **Monthly bills**. Baseline confirmation is a one-time setup, not another ongoing bill editor.

The migration creates no personal rows and does not update existing business rows. Owner-only CRUD RLS, same-owner foreign keys, unique owner/month configuration and unique owner/bill/month revision constraints apply. Bill/source/goal references use RESTRICT to protect linked history. Existing Monthly bills uses deactivation; no hard-delete action is introduced.

For a selected month, use the latest revision per bill whose effective month is at or before that month. Only active, explicitly included revisions contribute to the Housing target. Before the earliest configuration: **Housing target not established**, with no percentage or fake zero. A confirmed zero target is separately labeled, with no division by zero.

Bill amount, inclusion, classification and active-state edits take an explicit effective month, defaulting to the current local month. Changing the month in the bill editor loads the state applicable to that month; enter changes afterward. An existing bill/month is corrected using the same revision identity; later revisions are not rewritten. New bills do not enter earlier targets. Deactivate/reactivate through the existing bill editor. Scheduled future revisions are supported. Current Monthly bills/run-rate display projects applicable revisions, so scheduled values do not appear early. No background database writes are required when the month rolls over. The pre-existing bill row remains a compatibility record, updated by explicit edits; the effective revision is authoritative for the applicable bill state once established.

A variable payment's explicitly enabled estimate update creates a current-local-month revision with payment minus one-time amount, retaining the current inclusion flag. This is a save-time update, not continuous recomputation from old transactions. Fixed bills cannot be rewritten by payments. Transactions, tax, groceries, Automotive, Josh's methodology and Waterdrop calculations are otherwise unchanged.

## Earned-month income policy

This first version uses **one earned-month view**, visibly labeled. It does not silently mix pay-date cash flow into work-date earnings:

- A shift contributes rounded estimated gross cents to its local work-date month: hundredths of hours × hourly-rate cents / 100, rounded once to cents.
- A shift preserves its recorded rate even after the source's default rate changes. No withholding rate is invented.
- A paycheck with a confirmed period replaces **all** shift estimates for that source in that inclusive period. Underlying hours remain saved and editable.
- Actual net is distributed evenly across the period's calendar days using integer cents; remainder cents go to the earliest dates. For a four-day cross-month period, $200.01 assigns $50.01 to day one and $50.00 to each remaining day. This is an explicit analytical convention, not a claim about actual daily wages.
- Same-source paycheck periods cannot overlap. Different sources are independent. Invalid/reversed dates and periods longer than 367 inclusive days are rejected.
- A paycheck without a known period remains saved, visibly unreconciled and excluded until its period is corrected. It is never silently added on top of estimates.
- Labels distinguish estimated gross, actual net, and a mixture; zero-net confirmed pay remains labeled actual.
- Inactive sources cannot receive new shifts/paychecks through the normal add form, but retain historical earnings. Editing an existing record remains possible.

Coverage configuration selects one income source and at most one next goal, effective by month. The initial source form suggests Publix and $16/hour; only explicit Save creates a record. No source, shift, paycheck, goal or $22,000 debt is seeded.

## Calculations and language

All money inputs use decimal-to-integer cents validation. Source totals check safe integer range.

- Coverage = min(eligible earnings, housing target).
- Progress = min(earnings / positive target, 1); the bar caps at 100%.
- Remaining = max(target − earnings, 0).
- Surplus = max(earnings − target, 0).
- Income freed from housing = coverage amount, an analytical reduction in what other income must cover.
- Remaining hours = remaining / the selected source's **current gross hourly rate**; labeled approximate because actual take-home may require more hours. Typical shifts appear only if their length was explicitly configured.
- Surplus is available toward the selected active, incomplete goal. Goal target/debt does not decrease. No payment or transfer is claimed. Completed/inactive goals receive no suggested allocation.

Monthly history is recomputed from durable source data and shows actual/estimated labeling. Corrections to source records intentionally recalculate results. Nothing is finalized or snapshotted in this phase. Current goal status and current-rate hour approximations are advisory, not historical payment facts.

## Cloud, queue and backup

The existing `ledger_read` / `ledger_apply`, revision hash, operation receipts, offline queue and refresh infrastructure carry all six domains. No separate CRUD or subscription subsystem exists. Edits include bill revision changes atomically. A bill mutation after baseline that lacks a required effective revision is rejected. Duplicate operation replay does not repeat writes; stale revisions preserve conflict behavior.

Contract version **3**, feature **`housing_coverage_v1`**, six additional domains, and read version **3** are required. New-domain puts AND deletes require verified support. Previously verified support permits queued offline source records; an unknown/incompatible backend cannot admit them. Check cloud compatibility preserves the form; it does not silently resubmit it.

Older browser read contracts fail closed once finance records exist, preventing incomplete export from an old shell. The pre-existing service-only Alexa bridge retains its API and receives the complete revision snapshot; this preserves compatibility without changing Alexa code, Lambda, or its deployment.

Backup remains **v3**. `state.housingFinance` contains all six source collections and their audit/owner fields. Validation covers unique IDs, owners, source/goal/bill references, effective-month uniqueness, period overlap, dates, flags and bounded integer amounts. State hashes cover these collections. Summary reports sanitized collection counts. Reconstructed history matches after restore and cloud read-back. Older v3 backups without these collections remain valid. New backups require **v27 or newer validator/client**; older strict validators reject unknown fields rather than drop them. The Phase 2A certified import tool explicitly rejects populated Housing Coverage, just as it rejects Automotive; it is not a general restore tool. Existing cloud-mode import restrictions remain unchanged.

## Manual setup after controlled deployment

1. Update both devices to v27 after migration/security gates pass; keep pending/conflict queues settled.
2. In Income, create/confirm the income source and its $16 rate; optionally configure typical shift hours.
3. Establish the baseline: choose a starting month, confirm every existing bill's amount/state, explicitly select inclusion, and check the confirmation box. No boxes are preselected.
4. Choose the coverage source effective from the desired month (at or after baseline).
5. Optionally create a goal, enter your own target and select it as the next goal.
6. Log work hours. Enter actual pay with its confirmed period when available; inspect the replacement preview.
7. Verify coverage/history on the other device using normal cloud refresh. Continue bill edits only in Monthly bills.

## Validation and release gate

Implementation validation uses synthetic data and disposable PostgreSQL/browser profiles. Required unit/backup/syntax/build checks, populated old/new RLS, migration rollback/apply preservation, idempotency/conflicts, cross-device reconstruction, offline admission/replay, complete backup restore, and 390px/desktop UI tests are covered. Hosted Auth, two physical devices and actual user baseline setup are not claimed as tested before deployment.

Read-only production preflight on this branch finds exactly the expected pending migration, hosted contract 2, missing six domains / `housing_coverage_v1` / read 3. Both deployment gates intentionally FAIL until rollout. They have not been weakened. Production business writes during implementation: **ZERO**.

Database-first rollout (a later controlled task):

1. Review the migration/PR, settle both devices' queues, and take a verified portable backup and read-only production baseline (business rows, timestamps, receipts, Storage, policies).
2. Run linked production migration dry-run. It must contain ONLY the reviewed Housing migration; stop on anything unexpected. This implementation's dry-run was disposable local PostgreSQL, not a production apply.
3. Apply that reviewed migration, without seeding personal finance/baseline records.
4. Immediately verify existing rows, timestamps, evidence/Storage and existing policies are unchanged; six new tables are empty; run populated owner/anonymous/non-owner security and capability sanity checks using the established controlled procedure.
5. Require `npm run check:migrations` PASS and `npm run check:cloud-contract` PASS. Inspect queues/revisions; do not discard pending intent to make a gate green.
6. Only then merge the dependent frontend, verify Vercel Production and shell `50a-ledger-shell-v27`, and update both devices.
7. Perform explicit manual setup and a controlled physical hours/paycheck/history/backup test. No automatic personal seeding.

The implementation is suitable for controlled migration review/deployment after PR review. It is **not** cleared for frontend-first merge or unattended production rollout.
