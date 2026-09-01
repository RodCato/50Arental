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
- Waterdrop payback metadata (starting at 1 gallon; break-even at gallon 59)

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
- The cache name is visible near the top of `sw.js` (`50a-ledger-shell-v4`). Increment it when shell assets change, then reload once to install the new worker.
- On Android, use the browser’s **Add to Home screen** or **Install app** action after the site is served over HTTPS in production. Localhost is suitable for development; production installability should be checked on the deployed Vercel URL.

## Known limitations

- Data is device-local; backups are manual and there is no cloud sync or cross-device merge.
- Browser storage quotas and persistent-storage permission vary by device. The app requests persistent storage when the browser exposes that API, but continues working if permission is denied.
- Camera capture depends on browser/device support; the same controls continue to allow gallery and file selection.
