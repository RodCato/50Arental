# Automotive-002 — fuel analytics

Implemented from merged main `f25d3d8` on `automotive-002-fuel-analytics`. Audit date: November 6, 2026 (America/Chicago). Existing Automotive page only; no additional route or tab.

## Existing data and contract audit

Production read-only audit found one vehicle and three full fill-ups (September 27–October 28), all with gallons, price, odometer and a linked transaction. No partial fills exist in production. Total operational fuel purchases: $206.38. No historical data was inferred or created. Stations, notes, vehicle identity, transaction identities and raw records are excluded from this report.

Existing `fuel_events` already has every required durable field: owner, vehicle, date, cost, gallons, price per gallon, odometer, full-tank flag, station, notes and optional transaction link. Existing owner-scoped foreign keys, unique transaction linkage, deferred automotive-subtotal validation, odometer checks, atomic RPC/idempotency and capability guards remain unchanged. Cloud reconstruction and Backup v3 preserve these fields. **No new schema, stored metrics, migration, capability or RPC change is needed for this upgrade.**

Read-back analytics as of November 6: two qualifying intervals, latest 15.0668 MPG, weighted average 15.1041 MPG, 588.5 known miles, 18.9839 miles/day, average full-to-full interval 15.5 days and $0.22834/mile. Last fill age: 9 days. Monthly purchases: September $72.00, October $134.38, November $0.00 as of the audit date. Values shown in the UI are rounded for display; calculations use original recorded quantities.

## Algorithm

Pure `AutomotiveUtils.metrics` filters to one vehicle and dates through today, then sorts by fill date, known odometer and stable ID. UTC calendar-day arithmetic avoids DST elapsed-hour errors. Same-day order is not treated as known simply because the deterministic sort exists.

A full fill opens an interval. The next full fill closes it. MPG is endpoint odometer difference divided by **all gallons after the opening fill through the closing fill**, including intervening partial purchases. The opening purchase is excluded because its fuel was bought before the measured consumption interval. Cost/mile uses the same closing/intervening purchases, summed in integer cents. Average MPG is total qualifying distance divided by total qualifying gallons, not an unweighted average. Aggregate cost/mile uses qualifying cents divided by qualifying miles.

Missing gallons anywhere after the opener, missing endpoint odometers, nonpositive distance, any observed odometer decrease, or duplicate-date ambiguity in the interval excludes MPG/cost-per-mile. A later full fill starts a new candidate interval. Missing intermediate odometers do not prevent full-to-full MPG when endpoints and all gallons are known. No tank capacity or unlogged purchase is inferred. Corrected existing records recalculate the derived results; existing CRUD's monotonic-odometer validation is preserved.

Mileage uses successive known, nondecreasing odometers on distinct, unambiguous dates. Missing readings may be spanned; rejected intervals are excluded. Average daily miles divides total eligible distance by total eligible calendar days. Zero-distance known intervals can contribute measured zero mileage, but never MPG. Full-to-full duration requires distinct unambiguous full-fill dates without an observed odometer decrease, independent of gallon availability. A partial fill does not close a tank. Current tank age is days since the latest full fill, even if partial top-ups follow; it remains an ongoing age, not a completed tank duration. Days between all fill-ups are labeled separately.

Monthly spending sums each actual fuel-event cost once in integer cents. It does not join/add transaction amounts. Linked transactions remain ledger expenses once; unlinked events remain operational history only. Financial semantics, receipts/OCR, Housing Coverage, Waterdrop, queue behavior and owner isolation were not changed.

## UI

Responsive cards show selected-month fuel purchases, latest/weighted MPG, aggregate cost/mile, latest fill date/cost/gallons/price, fill age, tank age, average full-fill duration, latest/total known mileage and daily miles. Unknowns say Unavailable. Selecting all vehicles combines only purchase costs, never mileage/MPG intervals.

Inline SVG charts show qualifying MPG and monthly purchases, using theme contrast, chronological date labels and accessible value disclosures. At most 12 latest qualifying points/recorded months are plotted to keep mobile labels readable; disclosures include all available values. Missing MPG intervals and months without purchases are not fabricated as zero chart points. Exclusion reasons are explained. The spending-month selector affects the spending KPI; other KPIs and charts describe available history through today.

History cards expose station, date, cost, gallons, MPG, miles and interval duration. Partial-fill count and exclusion reasons appear where relevant. Existing Edit/Delete and linked transaction/receipt controls remain. Secondary notes, odometer and price use Details; open disclosures survive rerenders.

## Validation and preservation

- 251 unit/regression tests passed, including eight new analytics cases covering one/multiple fills, partials, missing readings/gallons, same-day/out-of-order entries, decreasing/corrected odometers, cost/mile, daily mileage, month boundaries, multiple vehicles, future exclusion and linked/unlinked cost accounting.
- 49 Backup tests passed (also included in the unit total).
- Existing local PostgreSQL RLS and Automotive tests passed: owner isolation, anonymous/non-owner denial, private Storage policies, deferred links, atomic CRUD/idempotency, odometer rejection and backup.
- New disposable browser test passed: cloud reconstruction and Backup v3 analytics equivalence, KPI/chart values, partial history, disclosures, edit/receipt links, zero rendering writes, reload, unavailable states, 390px and 1280px without overflow. Screenshots visually inspected.
- Existing cloud browser and contract browser checks passed, including offline queue replay and refusal of incompatible writes.
- Mobile embedded-image backup browser test passed. Its pre-existing reload race was corrected to wait for the public app API before reading state; no restore implementation was altered.
- Real service-worker offline test passed at 360px, now including populated fuel analytics and unchanged ledger data.
- Syntax, build and diff checks passed. Prepared shell: `50a-ledger-shell-v30`.
- Final read-only fingerprints matched all 16 production business tables, all 13 Storage objects and policies. No production rows, evidence, schema or financial transactions were changed. No live OpenAI calls.

## Release gate — blocked by existing prerequisite

The existing read-only release checks failed: production reports **contract 3**, while current merged main requires **contract 4**. The already-merged `20261024000100_recurring_autopay.sql` migration is still pending, with missing `recurring_autopay_v1` and read version 4. This is not a new fuel migration. The gate is preserved; it was not bypassed and no migration was applied.

Before an automatic production deployment: separately authorize and perform the existing FIN-002B database-first rollout, verify business preservation/RLS/capabilities, rerun `check:cloud-contract` and `check:migrations`, then deploy the reviewed frontend and physically verify Mac/phone refresh to v30. Existing CLI linking was unavailable in this checkout; audit/preflight used an explicit project reference through a temporary CLI wrapper, with no credentials stored in the repo.

Implementation and local regressions pass, but **not cleared for merge-triggered production deployment** while the release gate fails. No automatic merge/deployment was performed. Physical-device verification remains a post-deployment step.

## Changed files

`automotive-utils.js`, `automotive-ui.js`, `index.html`, `styles.css`, `sw.js`, `tests/fuel-analytics.test.cjs`, `scripts/test-fuel-analytics-browser.mjs`, `scripts/test-fin002-offline.mjs`, `scripts/test-backup-browser.mjs`, `package.json`, and this report.
