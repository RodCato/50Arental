# Phase 3 cloud evidence

Cloud receipts and property-condition photos use private Supabase Storage bucket `50a-evidence`. No OCR, receipt parsing, Alexa, public URLs or automatic legacy-image migration is included.

## Existing local behavior

The transaction file input accepts multiple JPEG/PNG/WebP files; receipt associations use `attachmentIds[]`. Property capture accepts multiple files and creates one room/phase/date/notes record per image. Local mode compresses with createImageBitmap/canvas to at most 1600px, never upscaling, requesting WebP quality 0.82; it historically falls back to the input on conversion failure. Binary records live in IndexedDB, with object-URL previews and separate attachment deletion. Backup v3 embeds exact referenced image bytes and verifies hashes. These local/rollback and recovery mechanisms remain available.

## Cloud paths and metadata

New cloud photos use `{owner UUID}/receipts/{attachment UUID}.{webp|jpg|png}` or `{owner UUID}/property/{attachment UUID}.{webp|jpg|png}`. Stable IDs are suitable for a future authenticated/server OCR handoff. No OCR fields are introduced. The private 20 MiB bucket, allowed image MIME types, owner-path RLS and composite owner/parent foreign keys remain unchanged.

The existing attachments table holds parent, bucket/path, actual MIME/byte size and a normalized filename (`photo.webp`, etc.). It contains no image bytes or signed URLs. Property records use the existing room, phase, date and notes columns. Each property photo has one attachment; transactions may have multiple images.

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

1. Confirm both devices load shell v16, use the same cloud owner, and show zero pending structured mutations/conflicts/photo operations. Export a complete Backup v3 before testing.
2. On phone, create one clearly named temporary transaction (for example `Photo verification`, $0.01) and attach a harmless photo of a blank note. Save online. Verify no pending photo recovery remains.
3. On Mac, Refresh cloud ledger. Open the same transaction and image. Verify the image is readable and matches the phone.
4. On Mac, edit that temporary transaction and add a second harmless image. Refresh phone and open both images. Remove one image through Edit → remove thumbnail → Save; confirm the other remains.
5. On phone, add one temporary property photo with a clearly marked test room, move-in/out phase, date and notes. Refresh Mac and open it.
6. Export Backup v3 in cloud mode and require integrity PASS with all test evidence included. Keep this file private.
7. Remove the temporary property photo and delete the temporary transaction through the app. If cleanup is reported pending, use Resolve photo operation on the device that performed it while online.
8. Verify read-only that only these temporary parent/attachment records and objects were removed; evidence counts return to zero unless legitimate evidence was independently added. Preserve legitimate ledger/Waterdrop activity.
9. Sign out/in and close/reopen on one device to verify private views lock and authentication persists as expected. Do not repeat email requests unnecessarily.

Phase 4 OCR may be planned only after this physical phone/Mac evidence check passes; no OCR implementation is part of Phase 3.
