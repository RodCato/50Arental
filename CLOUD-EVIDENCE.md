# Phase 3 cloud evidence (including Phase 3.2 multi-photo properties)

Cloud receipts and property-condition photos use private Supabase Storage bucket `50a-evidence`. No OCR, receipt parsing, Alexa, public URLs or automatic legacy-image migration is included.

## Existing local behavior

The transaction file input accepts multiple JPEG/PNG/WebP files; receipt associations use `attachmentIds[]`. Property capture now creates one room/phase/date/notes record with an ordered attachmentIds array, including an empty array for metadata-only records. Existing singular attachmentId records remain readable. Local mode compresses with createImageBitmap/canvas to at most 1600px, never upscaling, requesting WebP quality 0.82; it historically falls back to the input on conversion failure. Binary records live in IndexedDB, with object-URL previews and separate attachment deletion. Backup v3 embeds exact referenced image bytes and verifies hashes. These local/rollback and recovery mechanisms remain available.

## Cloud paths and metadata

New cloud photos use `{owner UUID}/receipts/{attachment UUID}.{webp|jpg|png}` or `{owner UUID}/property/{attachment UUID}.{webp|jpg|png}`. Stable IDs are suitable for a future authenticated/server OCR handoff. No OCR fields are introduced. The private 20 MiB bucket, allowed image MIME types, owner-path RLS and composite owner/parent foreign keys remain unchanged.

The existing attachments table holds parent, bucket/path, actual MIME/byte size and a normalized filename (`photo.webp`, etc.). It contains no image bytes or signed URLs. Property records use the existing room, phase, date and notes columns. Each property record may have zero or many attachment rows referencing the same property_condition_id. The composite owner/parent foreign key is unchanged. attachments.property_position is a nonnegative integer, default zero for existing rows; new property images append after the maximum position in selection order. Reconstruction sorts by position then ID. Receipt ordering/semantics are unchanged.

## Save, interruption and cleanup

1. Require the verified owner, a network connection, the device's editor lease and an empty structured mutation queue.
2. Validate JPEG/PNG/WebP and a nonzero input size no greater than 20 MiB; decode orientation, resize to at most 1600px without upscaling and request WebP 0.82. Canvas PNG fallback is accepted with matching MIME/extension. Invalid images or conversion failures fail before upload.
3. Generate parent/attachment UUIDs. Persist a separate owner-bound `50a-evidence-operation:{owner}` recovery journal containing intent and paths, never image bytes or Auth tokens.
4. Upload without overwriting an existing path. Download and compare the uploaded bytes before finalization.
5. The extended, security-invoker `ledger_apply` finalizes parent/items/property/attachment metadata atomically using the existing optimistic revision and operation-ID receipt. It verifies each new attachment's Storage object exists with matching size/MIME. No half-parent is needed before upload.
6. Failed upload or definitive RPC rejection compensates newly uploaded paths. Cleanup checks current metadata before deleting a path. Failed cleanup remains visible through **Resolve photo operation** in Cloud settings.
7. If RPC completion is uncertain, preserve the exact operation ID and intent. Resolve retries that same operation, so a committed operation returns its existing receipt instead of duplicating or undoing good evidence. Interrupted pre-finalization work is cleaned up and can then be submitted again.

Keep browser/site storage until pending photo work is resolved. The recovery journal is device-local; another device cannot resolve that journal automatically. It does not silently become a permanent IndexedDB image queue. New photo uploads and evidence deletion require a connection. Ordinary no-photo structured changes keep the existing offline queue.

Replacement uploads/finalizes new evidence before deleting old objects. Metadata failure retains the old evidence. Removing a photo or deleting a parent removes metadata atomically, then cleans up only its former objects. Failed binary cleanup is explicitly reported and remains recoverable. Direct administrative parent deletion is outside the application cleanup workflow; database cascade alone does not remove Storage objects.

## Viewing, sessions and cross-device refresh

Private SDK downloads use the authenticated owner and no-store fetching; uploads request zero cache lifetime. IntersectionObserver delays downloads until the view is visible. Object URLs are temporary and revoked on view rebuild/sign-out, and failed views offer retry. Signing out closes the full-size viewer, clears its source and locks the cached ledger. Owner B cannot view owner A's cache. No signed-URL expiration handling is needed because signed URLs are not used.

Existing refresh behavior is manual refresh, window focus, reconnect and reload—not a realtime subscription. Attachments/property metadata now participate in the same full ledger read/revision. No additional subscriptions are created. Refresh the other device or refocus it to see changes.

## Portable backup and restore

Cloud export refreshes confirmed structured data and downloads every referenced object using its frozen metadata. Backup v3 embeds the exact bytes and verifies completeness/hashes. Missing/inaccessible objects, MIME/size disagreement or unresolved photo operations fail export; there is no path-only backup. The service worker caches shell assets only, excluding private Storage/Auth/API responses and image blobs.

Portable v3 restore remains a local recovery operation. Import into cloud-authoritative Supabase is a separate controlled process; importing a local backup does not automatically upload restored photos. No arbitrary historical IndexedDB images are migrated.

## Validation and limits

`npm run test:evidence:browser` runs two isolated browser contexts, the real supabase-js client, real disposable PostgreSQL migrations/RPC/RLS, and a local binary HTTP Storage test service. It exercises file inputs, Blob/FormData/canvas/object URLs, desktop/mobile cross-device receipt/property viewing, complete backup, deletion and owner isolation. It does not run the hosted Supabase Storage service. Docker is unavailable in this development environment; hosted Storage transport and physical camera behavior must be verified after deployment using the manual test below. Unit failure tests cover upload/RPC/view failures, compensation failures, duplicate retries, replacements, deletes, offline/locked access and incomplete backup. Existing local IDB and rollback browser regressions remain mandatory.

## Manual production verification after merge/deploy

1. Confirm both devices load shell v18, use the same cloud owner, and show zero pending structured mutations/conflicts/photo operations. Export a complete Backup v3 before testing.
2. On phone, create one clearly named temporary transaction (for example `Photo verification`, $0.01) and attach a harmless photo of a blank note. Save online. Verify no pending photo recovery remains.
3. On Mac, Refresh cloud ledger. Open the same transaction and image. Verify the image is readable and matches the phone.
4. On Mac, edit that temporary transaction and add a second harmless image. Refresh phone and open both images. Remove one image through Edit → remove thumbnail → Save; confirm the other remains.
5. On phone, add one temporary property photo with a clearly marked test room, move-in/out phase, date and notes. Refresh Mac and open it.
6. Export Backup v3 in cloud mode and require integrity PASS with all test evidence included. Keep this file private.
7. Remove the temporary property photo and delete the temporary transaction through the app. If cleanup is reported pending, use Resolve photo operation on the device that performed it while online.
8. Verify read-only that only these temporary parent/attachment records and objects were removed; evidence counts return to zero unless legitimate evidence was independently added. Preserve legitimate ledger/Waterdrop activity.
9. Sign out/in and close/reopen on one device to verify private views lock and authentication persists as expected. Do not repeat email requests unnecessarily.

Phase 4 OCR may be planned only after this physical phone/Mac evidence check passes; no OCR implementation is part of Phase 3.


## Phase 3.2 create/edit and compatibility

Create one property record with optional photos. Select multiple gallery files or repeatedly take/select single photos; selections accumulate in the draft, with individual Remove actions. Nothing uploads before Save. Cancel revokes draft preview URLs and abandons unuploaded files. Each record card groups its metadata and lazy authenticated thumbnails, with Add photos, Edit, and Delete record actions. The responsive editor scrolls vertically at 390px.

Edit retains existing photos, adds new ones, removes selected existing ones, and changes metadata in one logical save. All new files are compressed before uploads start. For a mixed remove/add edit, old objects remain intact until the new metadata set commits atomically. If an upload or definitive finalization fails, only new objects are compensated; failed compensation remains in the existing recovery journal. An uncertain acknowledgement retries the same operation ID. Failed post-commit cleanup is explicitly pending and recoverable. A stale binary edit fails the revision check and cannot resurrect a removed photo; its draft remains open for review. Metadata-only edits use the structured offline queue and make no Storage calls. Binary changes require a connection and an empty queue. Delete record cleans every former object, including zero/one/many-photo records, after metadata commit.

The additive migration 20260924000100_property_multi_photo adds only property_position and removes the RPC's exactly-one-property-photo check. It rebuilds no tables, changes no owners/paths/IDs or MIME/RLS policies, and preserves uploaded-object verification and financial validation. Deploy the migration before the v18 app; both devices must load the updated app before using multi-photo records. Old clients/validators do not understand new attachmentIds property arrays.

Backup remains v3: new property records use ordered attachmentIds[], while old singular attachmentId snapshots are validated/restored without rewriting their state or hashes. Both representations cannot be specified simultaneously with a non-null singular reference. Duplicate property references and conflicting parents are rejected. All child metadata and actual image bytes are manifested against the same property ID; one missing/unreadable object fails the entire backup. Real IndexedDB restore/re-export preserves metadata, order, manifest and byte hashes. No PDF MIME types, OCR or document ingestion are added. Future reviewed document support must extend validation, preview, backup and extraction handling; extraction results must remain user-reviewed suggestions.

### Phase 3.2 physical test after merge/deployment (manual only)

1. On phone and Mac confirm shell v18, same owner, and no pending/conflicting/photo-recovery operation. Preserve legitimate evidence; note current counts.
2. Phone: create **Multi Photo Test**, Move-in, notes **temporary**, and add three harmless photos (test both multi-selection and repeated camera-style additions). Save.
3. Mac: refresh cloud ledger; verify one record, three photos, and open all three.
4. Mac: Edit, change notes, remove photo #2, add photo #4, Save.
5. Phone: refresh; verify one record with edited notes and expected photos #1/#3/#4.
6. Export Backup v3 and run standalone validation. Require integrity PASS, all references/hashes passing, and all three test property images embedded as real bytes (plus any legitimate evidence).
7. Delete only the temporary record through the app. Verify its parent, all child metadata and Storage objects are gone with no orphans. Other legitimate records/objects must remain unchanged. Confirm pending/conflicts/photo recovery are clear on both devices.

Automated development tests use disposable PostgreSQL/RLS and a local binary Storage HTTP service with real SDK/browser Blob/File/FileReader/object-URL flows. They do not replace this physical installed-PWA test or run it automatically.

### Contract audit and validation record

Previous one-photo enforcement lived in ledger_apply's final exactly-one count check; cloud/ledger-model.mjs fromCloud (exactly one row and singular attachmentId) and toCloud (one reference); cloud/evidence.mjs (overwriting the singular reference); app.js (one parent per selected file and one gallery photo); and backup-utils.js (singular conditionFields/references). The base property/attachment schema already had one-to-many composite owner/parent foreign keys. The repository reads the full attachment collection, BackupStorage stages every manifested attachment, and the evidence deletion diff already handled arbitrary removed attachments; those mechanisms required no redesign. Shared lifecycle/recovery and cloud refresh/queue infrastructure are reused.

Development results: 88 unit tests, 49 backup tests, syntax/build/diff checks, disposable RLS tests, cloud RPC database tests, expanded evidence browser tests and desktop/mobile local backup browser regressions passed. The tests include zero/one/four-photo unit cases; partial upload failure; rejected finalization; failed cleanup/recovery; receipt multi-image regression; same-parent owner isolation; metadata-only preservation; mixed edits; stale binary conflict; real multi-photo IndexedDB restore; and missing-one-of-N backup failure. A 390px editor screenshot was visually inspected.

Production preflight was 0 property_condition, 0 attachments, 0 evidence Storage objects. Migration 20260924000100 was dry-run, compared to the deployed RPC, tested locally, and applied. Before/after business-data, Storage, policy and bucket fingerprints are checked; no test evidence is created in production. Physical phone/Mac validation is deliberately left to the manual procedure above after merge/deployment.

## Camera/gallery picker fix (shell v19)

Both property and receipt pickers previously combined capture="environment" with multiple on one input, which forced camera capture in the installed Android PWA. Both now expose native, keyboard-accessible **Take photo** and **Choose photos** buttons. Camera uses a separate rear-camera capture input; Gallery has multiple and no capture attribute. Both retain the supported JPEG/PNG/WebP accept list and feed the same existing draft collection. Inputs reset after each selection so repeated captures append. Draft removal and Cancel remain local; existing photos are not re-uploaded. No Storage, schema, RPC, Backup v3 or evidence-lifecycle change is involved.

Automated browser checks verify input attributes, keyboard file-chooser activation, camera A + gallery B/C order using distinct image hashes, zero uploads before Save/on Cancel, normal saved photo counts, edit-mode combinations, receipt shared drafts, and the 390px layout. Shell v19 delivers the new markup/JS; private responses remain uncached. Physical Android picker behavior must be checked after deployment:

1. Open Add property evidence on the installed Android PWA (updated shell v19).
2. Tap Take photo; verify rear camera opens, capture one harmless photo and confirm its preview.
3. Tap Choose photos; verify gallery/files appears without immediately forcing the camera. Select two existing harmless images.
4. Verify three draft thumbnails, remove one, fill temporary room/phase/date/notes, and Save.
5. Verify one property record with the remaining two photos. Refresh Mac and open both.
6. Delete only the temporary record through the normal app UI. Verify its metadata/Storage cleanup and no pending photo recovery/conflicts; preserve any legitimate evidence.
7. Smoke-test the same Take photo/Choose photos actions in a receipt transaction, including Cancel before Save.
