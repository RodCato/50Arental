# Certified Supabase import (Phase 2A)

This is an explicit administrator tool. It creates a verified cloud **copy**; the phone ledger and its certified backup remain authoritative. No application startup, sign-in, PWA, local-storage, sync or cloud-client behavior is changed. Phase 2B is a separate task.

## Prerequisites and authorized source

Use Node 22+ and an authenticated official Supabase CLI with `db query --linked --project-ref` support. The operator must have administrative access to the existing `50a-ledger` project. No service-role key or database password belongs in this repository. The CLI uses its existing credential store; SQL and query results are captured privately, not logged.

The production entry point accepts only the exact 19,243-byte certified source with raw SHA-256:

`17d5d9ba7500b74f8064431dfbb5aac7a46712560adf8e7df211e575e9e25400`

It also checks both certified embedded hashes, invokes the standalone v3 validator, checks expected counts/financials and rejects evidence for this zero-attachment source. There is no command-line hash override. Any future source/evidence adapter requires separate authorization and review. Keep the original file outside Git and unchanged.

## Dry run and apply

Set `MIGRATION_OWNER_EMAIL` locally to the intended account's email (do not commit it). This is an administrative migration, not a browser session migration: the CLI resolves exactly one active, email-confirmed `auth.users` record. Its UUID is not hard-coded. Inserts run under `authenticated` with that owner's Auth claim, so owner policies and foreign keys apply. Hosted policy probes use the same role/claim mechanism; they do not represent a new end-to-end email login test.

```sh
npm run migrate:certified -- --source /absolute/path/backup.json --report /outside/repository/migration.json
# Inspect DRY RUN PASS, project, counts and finances first.
npm run migrate:certified -- --source /absolute/path/backup.json --report /outside/repository/migration.json --apply
```

Use `--cli /absolute/path/to/supabase` if the executable is not on PATH. Without `--apply`, only database reads occur. A sanitized local manifest is written with mode 0600; this is not a database write. The report must be outside the repository and cannot replace the source.

The tool checks the fixed project ref/name, verified owner, Phase 1 schema metadata, global business-table emptiness and a private empty evidence bucket. Metadata comparisons ignore collation-dependent row ordering, but not changed definitions. The schema reference is generated from the committed Phase 1 migration in a disposable database; never regenerate it from production to bypass a mismatch.

Initial planned counts are 9 transactions, 48 items, 4 active bills, 27 water events, 1 settings row and 2 benchmark adjustments; property records, attachments and Storage objects remain zero.

## Atomicity and retries

All inserts run in one transaction. Before inserts, the tool takes an advisory lock and table locks, rechecks emptiness/Storage/owner, and inserts recurring parents before transactions/items. Any SQL failure rolls back the entire dataset. It never deletes/truncates destination data or upserts over existing records.

UUIDv8 IDs derive from SHA-256 of `[namespace, certified source hash, table, source identity]`. Namespace is `50a-certified-import-v1`; items use `[transaction source ID, position]` and benchmark adjustments use position. The manifest records source-key digests and cloud IDs, without record contents. Settings have the owner's primary key. Server audit timestamps are intentionally new; business dates are retained. Unknown legacy water dates stay null. Date-only completion values are rejected rather than converted to invented timestamps. Rent lives in recurring bills, and gallon count derives from events.

The manifest is saved before apply. If a connection drops around commit, do not delete rows or assume failure means nothing committed. Retry explicitly with the same source, owner and manifest:

```sh
npm run migrate:certified -- --source /absolute/path/backup.json --report /outside/repository/migration.json --resume --apply
```

Resume accepts only an empty destination or a complete, semantically identical dataset. The latter is a no-op followed by fresh reconciliation. Partial, unknown or changed rows stop the tool for review. A second ordinary initial import always refuses nonempty tables. No cloud provenance table or schema migration is added; preserve the local manifest alongside the certified artifact.

## Independent reconciliation and security

After commit, fresh global SELECTs fetch cloud rows into process memory. All mapped business columns, IDs, relationships, item/adjustment positions, dates, settings, bill states and event markers are compared, excluding server audit timestamps. Shared `finance-utils.js` recomputes all checkpoints from read-back rows only. No source amounts feed that computation.

Hosted probes check owner counts, zero non-owner visibility, zero affected rows for non-owner no-op updates, and anonymous permission denial. Probes roll back; no production insert/delete policy tests are run. Full impersonated INSERT, owner transfer, DELETE and Storage attacks use populated synthetic owners in the disposable local RLS suite. Storage must remain private and empty before and after probes. Query failures suppress raw database errors, which may contain financial record values.

The manifest contains owner UUID, hashes, timestamps, counts, source-ID digests/cloud IDs, status and aggregate reconciliation—not emails, merchants, notes, images, credentials or raw query results. It is intentionally outside Git. `failedStage` distinguishes apply uncertainty from post-commit reconciliation failure; failures never trigger automatic cleanup. No PWA or service-worker cache changes are needed because no shipped application files change.

## Tests

```sh
npm test
npm run test:backup
npm run check
npm run test:rls
npm run test:migration
npm run build
git diff --check
```

`test:migration` requires PostgreSQL binaries on PATH. It creates a socket-only temporary cluster and never accepts a production connection string. It covers atomic rollback after parent inserts, repeat-apply rejection, exact-resume no-op, cloud financial/structural read-back, populated policies and zero Storage objects. Unit fixtures are synthetic. To refresh the schema reference after an explicitly reviewed schema change only: `node scripts/test-migration-db.mjs --record-schema`.
