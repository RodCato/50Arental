# 50A Ledger — MVP prototype

A local-first prototype for tracking the true cost of 50A.

## Included
- Move-in budget dashboard
- Transactions with multiple receipt line items
- Per-item statuses: kept, returned, refunded, cancelled, avoided/denied
- Refund adjustments without deleting original purchase history
- Receipt/order screenshot attachment
- Move-in and move-out photo evidence, room-by-room
- Purchase Police avoided-spend total
- JSON export/import backup
- Reconciled 50A dataset seed with estimated-amount markers
- Reused/owned-at-$0 and avoided/returned decision records
- Waterdrop payback metadata (starting at 1 gallon; break-even at gallon 59)

## Run
Open `index.html` in a modern browser. Data is stored locally in browser localStorage.

## Important MVP limitation
Images are currently stored as data URLs in localStorage. That is intentionally simple for the prototype, but move-in/move-out photo libraries will eventually exceed browser storage limits. The production build should move attachment storage to IndexedDB or native SQLite/filesystem storage (Capacitor is a good fit for Android), while keeping metadata in SQLite.

## Suggested next build slice
1. Replace localStorage with SQLite/IndexedDB repository layer.
2. Add transaction edit screen and explicit return/refund event timeline.
3. Add receipt OCR/import review flow.
4. Add before/after room comparison.
5. Add explicit recurring-instance history and a fuller savings/payback event timeline.
