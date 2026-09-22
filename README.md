# 50A Ledger — MVP prototype

A local-first prototype for tracking the true cost of 50A.

## Included
- Move-in budget dashboard
- Transactions with multiple receipt line items
- Per-item statuses: kept, returned, refunded, cancelled, avoided/denied
- Refund adjustments without deleting original purchase history
- Receipt/order screenshot attachment
- Move-in and move-out photo evidence, room-by-room
- JSON export/import backup
- Reconciled 50A dataset seed with estimated-amount markers
- Reused/owned-at-$0 and avoided/returned decision records
- Waterdrop payback challenge with dated completion history, consumption pace, and break-even projection

## Run locally

Serve the repository root so the service worker can run:

```bash
cd /Users/crod/Desktop/50Arental
python3 -m http.server 8000
```

Open <http://localhost:8000>. The static site can also be deployed directly to Vercel without a build step.

## PWA and device-local storage

`manifest.webmanifest`, `icon-192.png`, `icon-512.png`, and `sw.js` provide the installable shell. The service worker uses a versioned, network-first shell strategy with an offline cache fallback; it does not store ledger data in Cache Storage.

Ledger metadata, settings, Waterdrop history, and attachment references remain on the current device in localStorage. Receipt screenshots and move-in/move-out photos are stored as compressed Blobs in IndexedDB. There is no automatic Mac ↔ Android synchronization unless Google sync is explicitly configured in Settings.

Use **Export 50A Backup** regularly to protect or move the ledger. The backup includes structured data, Waterdrop history, attachment metadata, and the referenced receipt/property images. Import is an explicit replace-local-data workflow and requires confirmation.

## Google sync (SYNC-001)

Google sync is an explicit, private, local-first backup and merge path. It stores one structured `50a-ledger-sync.json` file in the signed-in Google Drive `appDataFolder`; it does not create a public link, use a backend, or support multi-user sharing. The OAuth scopes are `https://www.googleapis.com/auth/drive.appdata openid email profile`: private app-data storage plus the minimum identity scopes needed to show the connected account.

Configure a Google OAuth web client ID in Settings and add the local or production origin to that OAuth client in Google Cloud. Access tokens are held only in memory/session storage and are never written to localStorage; no refresh token is retained. Disconnecting removes the session token while leaving local ledger data intact.

Ledger records, settings, stable IDs, timestamps, tombstones, and attachment references are synchronized as structured data. Receipt and property image blobs remain in local IndexedDB in this phase, so binary upload is intentionally deferred. The app remains usable offline: local writes continue, offline sync is queued, and **Sync now** performs an explicit merge when connectivity returns. Newer record timestamps win deterministically; equal-time divergent records preserve the local record and surface a conflict count. An empty device never overwrites a populated remote file: initial sync downloads/merges populated remote data, while an empty remote is initialized from local data.

Google sync does not replace **Export 50A Backup**. Manual export/import remains the complete recovery path, including binary attachments.

## PWA development / cache troubleshooting

- Confirm the terminal serving the app is in `/Users/crod/Desktop/50Arental` and that the browser URL uses the expected port.
- Check for another local server on port 8000 before starting one; stop only the server for this app.
- If UI changes appear stale, hard-refresh, open browser site settings, unregister the service worker, and clear this site’s cache/storage only after exporting a backup.
- The cache name is visible near the top of `sw.js` (`50a-ledger-shell-v9`). Increment it when shell assets change, then reload once to install the new worker.
- On Android, use the browser’s **Add to Home screen** or **Install app** action after the site is served over HTTPS in production. Localhost is suitable for development; production installability should be checked on the deployed Vercel URL.

## Known limitations

- Data is device-local; backups are manual and there is no cloud sync or cross-device merge.
- Browser storage quotas and persistent-storage permission vary by device. The app requests persistent storage when the browser exposes that API, but continues working if permission is denied.
- Camera capture depends on browser/device support; the same controls continue to allow gallery and file selection.


## Monthly bills / recurring charges (MVP-002)

Use **Monthly bills** to add, edit, deactivate, or reactivate expected monthly housing obligations. Categories are free text; fixed/estimated amounts and an optional utility type control the explanation shown on the dashboard. Rent is now edited here. Bills do not create payments.

Actual spending still comes only from dated transaction line items. For a $123 electric payment that includes a $30 connection fee, keep $123 under Utilities (either one total or separate $93 service and $30 fee lines), and select the Electricity variable bill in the transaction form, enter $30 as its one-time portion, and select Update monthly estimate. Saving records the payment and updates the estimate to $93. The connection fee remains in actual housing costs; it is not also counted as a Household purchase or included in projections.

`recurring-utils.js` provides pure migration, upsert, deactivation, total, and status functions. Records have stable `id`, `name`, `amount`, `category`, `kind`, `utilityType`, `active`, `createdAt`, and `updatedAt` fields. The existing `fiftyA-ledger-v1` localStorage object gains `recurringCharges` and `recurringChargesVersion: 1`. The transaction schema and image storage are unchanged.

On first load (or import of an older backup), the migration converts the saved rent setting and explicitly recurring service lines into bills. Repeated service names use the latest dated amount, not the sum of historical payments. The original $40 internet value comes from the reconciled seed's Spectrum monthly service line; no internet bill is invented if that line is absent. Existing transactions are retained, and an existing bills array—including an empty one—is authoritative. Deactivation persists and migration does not recreate inactive bills. Normal JSON backups include the collection; the already-existing Drive backup/merge path carries these records using their timestamps. No Sheets or voice integration is added.

The known run-rate is the sum of active monthly bills, rounded in cents. Projected monthly savings equal Josh's unchanged effective benchmark minus that run-rate; annual savings multiply that by 12. The existing cumulative projection multiplies current savings by the number of months with transactions; its label now explicitly calls it a projection across recorded months. It is not historical realized savings. Overview actuals use the current calendar month; the Monthly screen uses the selected month.

Migration cannot infer the recurring service portion of an unsplit utility payment: associate the payment with a variable bill and enter its one-time portion explicitly. Estimates have no effective-date history yet, and utility completeness text uses the optional utility-type field. Before using existing Drive sync across devices, update all devices to this app version; older clients do not know the bills collection.

### Validation

```bash
TZ=America/Chicago node --test tests/*.test.js
node --check app.js
node --check recurring-utils.js
node --check sw.js
git diff --check
```

This vanilla JavaScript static PWA has no package manifest, build step, lint script, or TypeScript check. The Node regression suite covers legacy loading, idempotent migration, bill edits/deactivation, dynamic text, and the $93 + $30 electricity example. The audit with active Rent $965, Internet $40, and Electricity $93 totals $1,098; actual utilities are $123 and the fee contributes $0 to projections. Josh's benchmark is $1,771.38 and projected savings are $673.38/month.


### Updating variable estimates from a payment

In Add transaction, select an existing active monthly bill. For variable/estimated bills, **Update monthly estimate from this payment** defaults on for new payments. Enter the total paid in the line items and the **One-time / non-recurring portion** (default $0); the preview shows payment minus one-time portion before saving. Use one transaction per bill, with kept housing/utility line items. The payment uses the net line-item amount after refund adjustments. The one-time portion is metadata within the total, not another expense line: do not add it to the total a second time.

Transactions optionally store `recurringChargeId` (stable bill ID) and `oneTimeAmount`. Existing records need no migration. `RecurringUtils.saveTransaction(state, transaction, {updateMonthlyEstimate})` returns a new state containing both the transaction upsert and any requested variable-estimate update. It validates before mutation, uses cent arithmetic, retains transaction IDs on edits, and never creates a duplicate bill. Fixed bills reject estimate-update requests; ordinary associated payments never change their configured amount.

Opening any existing transaction defaults the update checkbox **off**, even if that payment originally updated an estimate. Checking it explicitly applies that payment's service amount as today's estimate when saved, regardless of payment date. Unchecking it saves only the transaction. Inactive or unavailable bills cannot update estimates. Deleting/removing a transaction has no estimate side effect: no historical recalculation or rollback is introduced (there is no dedicated transaction-delete control in the current app). Manual changes in Monthly bills also remain independent. These rules prevent routine historical corrections from replacing today's estimate.

The transaction save button explicitly says **Save payment only** or **Save payment + update estimate** for variable bills. A status beside it names the bill and shows the retained amount or the old → new estimate, so an edit cannot look like it will update an estimate when the checkbox is off.
