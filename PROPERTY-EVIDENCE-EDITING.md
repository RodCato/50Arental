# Phase 3.1 — editable property evidence

Each Property card now has Edit. The existing dialog prefills room/area, move-in or move-out phase, evidence date, and complete multiline notes, and displays the current private photo. Save changes updates metadata; Cancel/close/Escape discard form changes. Gallery notes retain line breaks and wrap long text.

Metadata saves use the existing structured DeviceLedger queue and ledger_apply RPC. The property ID, owner, created_at, attachment row/ID/path and image bytes remain unchanged. The server updates updated_at and ledger revision. There are no upload/delete calls for metadata edits. Offline metadata changes queue and replay normally. A stale ledger revision preserves the attempted edit as a conflict; the existing Cloud controls let the user review/export pending intent or use the cloud version. Existing focus/online/manual refresh reconstructs the other device; no new realtime subscription is introduced. Open dialogs suppress automatic refresh to retain the editor's base revision.

Photo upload and removal still require connectivity and use the tested Phase 3 lifecycle. Whole-record removal deletes its attachment metadata and object as before. Closing the editor releases its private image object URL and cancels pending preview display.

## Relationship audit and scope

The SQL attachment foreign key permits multiple rows per property in isolation. However, ledger_apply explicitly enforces exactly one image per property, cloud reconstruction requires exactly one, and the portable Backup v3/app model uses singular attachmentId. Thus multiple property photos are not safely supported end to end today. Receipts already support multiple images. This change preserves the existing property model; photo-set editing is a follow-up requiring coordinated RPC, model, backup-validator, recovery, UI and regression changes. Add/remove/replace-photo controls are not added to the metadata editor. No database migration or policy change is needed.

## Backup and future documents

Backup v3 exports edited metadata with the same associated bytes/hash. Regression coverage restores the actual edited cloud export into a disposable local IndexedDB ledger and compares metadata and the complete manifest after re-export. Production restore remains separate from cloud import.

Private Storage currently accepts JPEG/PNG/WebP only (20 MiB input limit); the browser pipeline decodes/compresses images, and the database, cloud model and portable validator validate image formats. Lease/inspection PDFs will need a separately reviewed attachment/document model, MIME/size policy and validator changes, document preview, byte-complete backup handling, and secure extraction processing. A multiple-document relationship should be designed with the property photo-set follow-up. OCR results must be suggestions reviewed by the user before metadata edits. No OCR, document parsing, PDF policy broadening, or lease ingestion is implemented here.

## Validation

- npm test; npm run test:backup; npm run check; npm run test:rls; npm run build; git diff --check.
- Evidence browser regression uses the real SDK and disposable PostgreSQL migrations/RLS with a local binary Storage HTTP test service, never production. It covers create; all metadata fields; long multiline notes; cancel; unchanged attachment rows, bytes and object counts; preserved ID/owner/created_at; updated_at; stale two-device conflict; offline queue/replay; both-direction reconstruction; owner editing; anonymous/non-owner denial; Backup v3 validation and actual local restore; and subsequent normal deletion with no orphans.
- Edit form checked at 390px with no horizontal overflow. Separate local backup browser regressions run at desktop and mobile widths; existing cloud browser regression also runs.
- PWA shell cache advances from v16 to v17. Private Storage/Auth/API responses remain uncached.
- No production reads/writes or hosted migration are required for development tests. Synthetic contexts contain all test records/images.

After merge/deploy, verify the v17 editor on the installed phone and Mac using a harmless temporary property record: edit each field, refresh the other device, cancel an edit, export/validate, then remove through the normal UI. Automated mobile testing is not a claim of a new physical installed-PWA test. Phase 3 physical verification already passed; Phase 4 document/OCR planning can proceed separately, with implementation requiring its own reviewed scope.
