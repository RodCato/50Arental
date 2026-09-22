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

Use Node.js 22 or newer and Python 3:

```bash
npm ci
# Optional: copy .env.example to .env and fill only public URL/key.
# Node does not automatically load .env; use the explicit command when configured:
node --env-file=.env scripts/build.mjs
# Or: npm run build   (uses environment variables; no config = local-only app)
python3 -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. Vercel runs `npm ci` and `npm run build`, publishing only `dist/` via `vercel.json`. This small build bundles the Supabase SDK locally and generates a public config JSON; vanilla JavaScript cannot consume Vercel's environment variables directly. Serving the repository root still runs the original local ledger, but its cloud script is intentionally an unbuilt placeholder.

## PWA and device-local storage

`manifest.webmanifest`, `icon-192.png`, `icon-512.png`, and `sw.js` provide the installable shell. The service worker uses a versioned, network-first shell strategy with an offline cache fallback; it does not store ledger data in Cache Storage.

Ledger metadata, settings, Waterdrop history, and attachment references remain on the current device in localStorage. Receipt screenshots and move-in/move-out photos are stored as compressed Blobs in IndexedDB. There is no automatic Mac ↔ Android synchronization unless Google sync is explicitly configured in Settings.

Use **Export 50A Backup** to create a verified portable v3 artifact. Export freezes state, requires all supported referenced images, and verifies SHA-256 integrity before download. Import validates before writes, requires confirmation, retains a verified recovery snapshot, stages evidence in a new generation, and verifies on reopen. Explicit legacy-v2 imports remain supported with a warning and validation. See [Portable Backup v3](BACKUP.md) for the schema, offline validator, recovery protocol, limitations, test commands, and authoritative phone procedure.

```sh
node scripts/validate-backup.mjs /path/to/50a-ledger-backup-v3.json
```

## LEGACY / pending retirement — Google sync (SYNC-001)

Google sync is an explicit, private, local-first backup and merge path. It stores one structured `50a-ledger-sync.json` file in the signed-in Google Drive `appDataFolder`; it does not create a public link, use a backend, or support multi-user sharing. The OAuth scopes are `https://www.googleapis.com/auth/drive.appdata openid email profile`: private app-data storage plus the minimum identity scopes needed to show the connected account.

Configure a Google OAuth web client ID in Settings and add the local or production origin to that OAuth client in Google Cloud. Access tokens are held only in memory/session storage and are never written to localStorage; no refresh token is retained. Disconnecting removes the session token while leaving local ledger data intact.

Ledger records, settings, stable IDs, timestamps, tombstones, and attachment references are synchronized as structured data. Receipt and property image blobs remain in local IndexedDB in this phase, so binary upload is intentionally deferred. The app remains usable offline: local writes continue, offline sync is queued, and **Sync now** performs an explicit merge when connectivity returns. Newer record timestamps win deterministically; equal-time divergent records preserve the local record and surface a conflict count. An empty device never overwrites a populated remote file: initial sync downloads/merges populated remote data, while an empty remote is initialized from local data.

Google sync does not replace **Export 50A Backup**. Verified portable v3 export/import is the recovery path for supported binary attachments. Missing or nonportable evidence blocks certification.

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

On first legacy local load, the migration converts the saved rent setting and explicitly recurring service lines into bills. Repeated service names use the latest dated amount, not the sum of historical payments. The original $40 internet value comes from the reconciled seed's Spectrum monthly service line; no internet bill is invented if that line is absent. Existing transactions are retained, and an existing bills array—including an empty one—is authoritative. Deactivation persists and migration does not recreate inactive bills. Normal JSON backups include the collection; the already-existing Drive backup/merge path carries these records using their timestamps. No Sheets or voice integration is added.

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

## Supabase Phase 1: foundation only

**Supabase is NOT YET the authoritative data store. Local storage remains authoritative until the migration phase is explicitly completed.** Nothing uploads on sign-in. All existing transaction/recurring/dashboard code (`app.js`, `recurring-utils.js`), IndexedDB images, local import/export and Google controls remain active and unchanged. Google Drive sync is **LEGACY / pending retirement**; do not treat it as the new multi-device architecture.

Architecture: static PWA → separate Supabase Auth/client boundary → owner-protected Postgres tables and private evidence Storage. `cloud/client.mjs` owns client/session/Auth; `cloud/data.mjs` only reads connectivity metadata; `cloud/ui.mjs` connects the small Settings panel. No financial repository, sync, OCR, Alexa endpoint or migration importer exists yet.

### Public configuration and Vercel

The existing Marketplace integration supplies `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (confirmed in its Vercel quickstart; connected to `50-arental` for Preview and Production). The build accepts URL aliases `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, and key aliases `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, in that priority order.

Only these two values enter `dist/cloud-config.json`. Publishable keys and legacy JWTs with role `anon` are accepted; unknown/secret/service-role keys fail the build without logging their values. No configuration yields a working local-only build; a partial configuration fails to avoid a misleading deployment. The build copies an explicit static-file allowlist. It never copies `.env`, migrations, tests, package metadata, database URLs or any other environment variables.

In Vercel, confirm this repo/root and Node 22+ are selected and the integration variables apply to the desired Preview/Production environments. The repo's framework setting is `null` (static), build is `npm run build`, output `dist`. Remove any dashboard override that contradicts these settings. Rebuild/redeploy after environment changes. No real key is committed; `.env*`, `.vercel`, `dist`, and CLI temp credentials are ignored. Do not paste a full Marketplace environment dump into source or a public issue.

### Authentication setup

Use the Supabase email provider's **default Magic Link template**. No email-template customization, custom SMTP or paid plan is required by this implementation. The browser calls `signInWithOtp({email, options: {emailRedirectTo}})` with the current app origin/path; despite the SDK method's name, its default email contains a Sign in link.

In **Authentication → URL Configuration**, set Site URL to the production app origin and add the exact local/preview callback URLs to Redirect URLs (for the supplied development preview, `http://127.0.0.1:8767/`; for the documented local server, `http://localhost:8000/`). Add the actual Vercel preview URL when testing there. Supabase falls back to Site URL when a requested redirect is not allowed, so configure this before the live click test. Restrict allowlisted hosts to your own app. Keep email verification enabled. See [Supabase passwordless email Auth](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Settings → Supabase foundation → enter email → Send sign-in link → open the email's Sign in link → Settings. The SDK handles its normal implicit callback, consumes the URL-fragment session and clears those tokens from the URL. Implicit flow is intentional for this static SPA: an email link may open a new tab without a PKCE verifier stored in the original tab. Expired/invalid links show a retry message. Identity, sign out and Check cloud access are available once signed in. Do not share sign-in links or copy their tokens into issues.

Sessions use the separate `50a-supabase-auth` sessionStorage key, survive reload in the receiving tab, and are not part of portable or Google backups. Closing the tab normally ends persistence. The requesting tab may remain signed out if the email opens another tab; inspect Settings in the tab opened by the link. Sign out has local scope, so other devices remain signed in. No sign-in callback uploads local data or images.

### Migrations and safe policy tests

`supabase/migrations/20260922000100_initial_50a_schema.sql` is the source of truth, wrapped in a transaction. No migration is applied automatically during Vercel builds. Use the official Supabase CLI with your own local login; never commit CLI tokens or database passwords:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --linked --dry-run
supabase db push --linked
```

Check the linked project and dry-run before applying. If a database already contains conflicting tables or the bucket, reconcile its migration history rather than resetting it. The migration creates empty tables and the private bucket; it does not insert personal/financial records. Local `supabase start` requires the CLI and Docker; `supabase/config.toml` provides a normal local project configuration. It uses Supabase’s default email templates.

```bash
npm test
npm run check
npm run test:rls
```

`test:rls` requires PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`) on PATH. It creates its own disposable cluster/socket under `/tmp`, applies a mock of Supabase's Auth claims/Storage tables, runs the real migration and policy tests, then removes the cluster. It never accepts a production database URL. It tests all eight personal tables, owner A/B isolation, impersonated inserts, owner transfer, anonymous denial, cross-owner parent references, timestamps, cascades and Storage paths. These are real PostgreSQL/RLS tests, **not** an end-to-end test of hosted Auth email delivery or Storage HTTP download/upload behavior.

### Schema mapping

All personal rows use UUIDs (default `gen_random_uuid()`; explicit browser `crypto.randomUUID()` IDs will also work), `owner_id → auth.users`, and server-maintained `created_at`/`updated_at`. Client-supplied timestamp changes are overridden; created_at is preserved on update. Historical event dates remain separate. No local IDs have been converted yet.

| Local model | Future cloud home / mapping |
| --- | --- |
| `transactions[]` | `transactions`: merchant, date → transaction_date, notes, recurringChargeId, oneTimeAmount, systemKey/sampleKey. Totals/status remain derived from items. |
| Transaction `items[]` | `transaction_items`: name → description, position, amount/category, all six buckets/five setup classes, status, adjustment, deposit status/refunds, moveIn/prorated/estimated/recurring/giftCardOffset. No existing subcategory to preserve. |
| `recurringCharges[]` | `recurring_charges`: name, amount, category, kind `fixed`/`estimated`, utilityType, active. Fixed/variable arithmetic still lives in existing code. |
| `condition[]` | `property_condition`: room, phase `move-in`/`move-out`, date → condition_date, notes. |
| Transaction attachmentIds / condition photo refs / legacy inline images | `attachments`: metadata only, exactly one appropriate parent, original filename, MIME, bytes, Storage path. Actual binary stays out of Postgres. Existing blobs/data URLs remain local. |
| `settings.waterdropPayback.waterdropCompletions` | `water_events`: each completion is one gallon; gallon ordinal/count is derived, not a mutable counter. Unknown legacy dates may be null only with `legacy=true`; preserve known event time. |
| Budget + user settings | `user_settings`: budget, forgotten essentials budget, Josh rent/stay days, lease move-in/deposit inputs, Waterdrop name/baseline/system cost/break-even. `rent50a` is a legacy recurring-bill fallback, not a second cloud source of rent. |
| `settings.joshAdjustments[]` | `benchmark_adjustments`: ordered label/amount rows, preserving the existing benchmark methodology. |
| Google connection/status, tokens, selected tabs/month/filter, UI state | Device-local only; no cloud settings dump. |

Composite owner+parent foreign keys prevent cross-owner links even when UUIDs are known. Transaction deletion cascades items and attachment metadata; property deletion cascades evidence metadata. Referenced recurring charges are restricted from hard deletion (use active=false). Storage binary cleanup is a separate future operation: deleting metadata does **not** delete Storage objects. Account deletion likewise needs an explicit Storage cleanup workflow before any future account-management UI.

The current cloud schema deliberately does not encode transaction totals, dashboard values, OCR fields or device-specific cache state. A later OCR migration can introduce staged jobs referencing uploaded attachments and finalize multiple reviewed line items; Phase 1 requires an attachment parent, so a draft transaction or separate staging model must be designed then.

### RLS, Storage and diagnostics

Each of the eight tables has explicit authenticated SELECT/INSERT/UPDATE/DELETE policies using `owner_id = auth.uid()`, with UPDATE checks preventing owner changes. Anonymous roles have no personal-table privileges. Child tables have their own RLS and owner-constrained parent keys. Supabase administrative/service roles can bypass RLS by design and must never enter the browser.

The migration creates private bucket `50a-evidence`, limited to WebP/JPEG/PNG and 20 MiB per file. Paths are `{owner_uuid}/receipts/{attachment_uuid}.webp` or `{owner_uuid}/property/{attachment_uuid}.webp` (JPEG/PNG extensions also accepted). Four Storage object policies allow access only under the authenticated owner's first path component; writes also validate folder/filename shape. No public URLs, uploads, signed URL generator, or existing-image migration is added. Future reads should use authenticated downloads or short-lived signed URLs. Review any pre-existing Storage policies before applying: permissive policies on the same bucket combine with OR, so unrelated broad policies can undermine isolation.

Check cloud access authenticates the session, reads table access without fetching financial content, calls a restricted metadata-only `ledger_foundation_health()` RPC, and lists one entry under the user's own receipt path. The RPC is SECURITY DEFINER with an empty search path, an explicit authenticated check and no anonymous execute permission. It only returns schema version/private-bucket/policy presence, never ledger rows. Policy presence is not proof of effective isolation; the SQL tests cover that separately. Health writes no sample records and uploads no images.

The service-worker shell version is bumped to v10 to deliver the added bundle and sign-in markup. It caches only allowlisted same-origin shell assets; `cloud-config.json`, Auth and Storage requests are not intercepted/cached. The cloud config has `Cache-Control: no-store`; the worker script has `no-cache`. Offline/cloud failures leave the local ledger usable.

### Proposed Phase 2 (not implemented)

1. Back up **each device** with the existing portable export, including actual IndexedDB blobs; inventory counts, legacy inline images, date formats and per-device differences. Keep immutable recovery copies.
2. Select a signed-in owner and explicitly choose/merge the authoritative source dataset. Resolve desktop/phone conflicts in a dry-run preview; never let last-writer silently overwrite the other device.
3. Build a resumable, idempotent importer with a persisted old-ID → UUID map/import manifest, including transaction items, conditions, recurring links and water events. Reject invalid values for review. Preserve Josh inputs and reconcile actual/recurring/deposit/refund arithmetic exactly.
4. Import parent rows and children with owner-constrained transactional operations. Upload actual image bytes to private owner paths; verify byte counts/checksums and authenticated download, then commit attachment metadata. Resume safely; track orphan cleanup. Keep historical event dates separate from cloud creation times.
5. Compare every record count, monthly/category total, recurring run-rate, water completion count and receipt/property photo against the local snapshot. Produce an exception report and require explicit acceptance before switching stores.
6. Introduce reusable cloud operations and deliberately design offline queues, concurrency/conflict detection and deletion semantics. Test two devices and two users, including retries, partial uploads, sign-out, offline editing and reconnect. Cut over only after that contract is tested.
7. Keep local originals and portable recovery available through a rollback window. Retire legacy Google sync in a separate reviewed change after cloud backup/restore and phone/desktop parity are verified. No Sheets, OCR or Alexa in this migration phase.
