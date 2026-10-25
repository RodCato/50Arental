# FIN-002A — Actual net paycheck workflow

Implemented on existing `fin-002-housing-income-reconciliation`, on top of FIN-002. The user subsequently authorized committing, pushing, and opening a PR. No new branch, merge, production deployment, or production mutation is authorized. No schema migration required. Shell remains the already-prepared, undeployed v28.

## Approved policy

Paycheck entry requires only **pay date** and **actual net amount**. No work hours, gross estimate, period dates, source dropdown, or reconciliation step. New records retain the current schema's optional period/gross fields as null. Editing an existing record preserves its ID, source, legacy periods, gross amount, notes and creation timestamp unless an explicitly editable value changes.

Coverage sums actual net paychecks in the calendar month of their pay date, from the explicitly configured coverage income source. Legacy earning periods never split or exclude net pay. Work-hour estimates contribute zero. Historical work rows, source rate settings and period metadata remain stored and included in Backup v3; only the calculation policy and primary UI change. Historical coverage is now recomputed by pay date, not by the old period allocation.

The existing effective-month, active/included bill target policy is retained. Expected bills remain separate from recorded expenses. FIN-002 Overview/Josh clarity, cloud queue, idempotency, security, and image/backup mechanisms remain intact.

## Source and goals

New paychecks automatically use the pay-date month's configured source, otherwise an existing active source, otherwise the first existing source. Existing paycheck associations are never reassigned. The source is displayed as explanatory text, not a required selection. An empty ledger needs an income source created once; no source or financial records are fabricated. An established target and coverage source must still be configured explicitly. The Income page distinguishes all-source monthly net income from selected-source housing coverage.

Housing uses min(net income, target). Remaining is max(target − net income, 0); surplus is max(net income − target, 0). An active selected goal can use only that surplus. No goal payment, debt reduction, or transfer is recorded, and the same money is not counted as both housing coverage and available goal income. Existing configuration and goal records are unchanged.

## October production read-back, calculated locally

Both existing paychecks remain valid and associated with the selected source:

| Metric | New policy result |
|---|---:|
| Actual net received | $1,040.41 |
| Expected housing target | $1,154.53 |
| Coverage | 90.1% |
| Remaining | $114.12 |
| Surplus | $0.00 |

These results were calculated from production read-back in memory, without saving or reconciling anything. Before/after fingerprints match across all 16 business tables, including the two paycheck records. Public/storage policies and Storage count are unchanged. No production transaction was created. Existing benchmark inputs still produce $1,771.38, as documented in FIN-002; this task does not change that comparison.

## Files changed for FIN-002A

- `housing-utils.js`: received-net calculation, pay-date eligibility explanations and default-source lookup; no persistence/schema change.
- `housing-ui.js`: two-field paycheck form, net-only coverage, monthly income and surplus, hidden work-hour workflow, source settings preserving legacy values.
- `tests/housing.test.mjs`: updated policy tests, exact October amounts, source rules, metadata preservation, goal conservation, restart/lost-acknowledgment net-pay retry, backup evidence.
- `scripts/test-housing-browser.mjs`: two-field saves, correct months, unchanged original records, offline retry, requested layouts.
- `scripts/test-housing-db.mjs`: null-period paycheck save and duplicate-safe replay through actual RPC on disposable PostgreSQL.
- `scripts/test-fin002-offline.mjs`: simplified Income page offline assertion.
- `FIN-002.md`: historical report marked as superseded for income policy.
- `FIN-002A.md`: this report.

The earlier FIN-002 changes in app/index/cloud status/package scripts/service worker are retained.

## Validation

- `npm test`: **236 passed**, zero failures.
- `npm run check`, `npm run build`, `git diff --check`: pass.
- `npm run test:housing:db`: **11 groups passed**, isolated socket-only PostgreSQL, including RLS, exact read-back, metadata preservation, null-period paycheck save, idempotency and existing bill/backup guards.
- `npm run test:housing:browser`: **360/390/412/1280px** Overview, bills, Income and paycheck dialog; date and net alone save; automatic existing source; month switching; existing paychecks unchanged; offline save/retry without duplicates; no runtime or console errors.
- `npm run test:housing:offline`: real v28 offline shell reload with identical local ledger data.
- `MOBILE_TEST=1 npm run test:backup:browser`: receipt/property PNG bytes, real IndexedDB staging/recovery, Housing data and history, reload/re-export state hashes preserved.

Browser writes and database write tests use synthetic disposable data only. Physical Android testing and production deployment are not performed. The deployed old shell will continue showing its old policy until a separately authorized deployment/update. No work-hour entry is needed for the verified October result under this implementation.
