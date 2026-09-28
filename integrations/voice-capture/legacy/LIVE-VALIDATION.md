# Live validation — September 22, 2026

The integration is deployed. Capture and duplicate prevention are proven; reliable spoken confirmation is not yet proven.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Launch | Passed | Simulator returns the add-a-gallon prompt after correcting `index.mjs` to `index.js` and using the Alexa account ID rather than an email. |
| Same-payload replay | Passed for duplicate protection | Copied the original simulator request into Lambda. Two successive acknowledged replays said “That gallon is already saved to your Sheet.” They took 2,653.14 ms and 2,119.54 ms. The Sheet stayed at one event row. Other replays timed out without creating duplicates. |
| Help | Passed | Typed “ask fifty a ledger for help”; response “You can say add a gallon, or stop.” |
| Stop | Passed | Typed “stop”; response “Okay.” The Sheet still had one event row after help/stop. |
| Fresh commands | Writes passed; acknowledgement failed | Two separate typed gallon commands each appended one new row. Both returned the uncertain-save response instead of confirming. |
| App source preservation | Passed | App source files have no integration diff. `app.js` matches the Desktop checkout byte for byte. No importer is implemented. |
| User's device-local gallon count | Not directly verified | Requested confirmation from the user; no app data was read or modified. |
| Physical-device launch | Failed in user report; investigating | User reports Fire Stick routes the gallon command to the shopping list and Echo says it does not know how to help. The built invocation is verified as `fifty a ledger`, with English (US) and Development testing enabled. User subsequently confirmed the skill is enabled in the Alexa app. Device account and spoken launch recognition remain to verify. |

## Sheet at the end of the automated checks

Three event rows, all `water/add/1/gallon/alexa`, blank merchant/category, `synced=FALSE`:

- Row 2, existing user simulator request: `alexa:amzn1.echo-api.request.a9b68e60-0fd6-4a66-9575-5c27bc02f469`.
- Row 3, first new simulator test in this session: `alexa:amzn1.echo-api.request.9511e16e-d2fb-4374-afcf-43809c79c6e8`.
- Row 4, second new simulator test in this session: `alexa:amzn1.echo-api.request.79529934-8d83-476d-a313-bcc95fc1c7c9`.

Rows 3–4 are deliberate test gallons, not reported consumption. They were left intact for inspection and should be excluded or removed before enabling app import. No rows were deleted by this session. The original request was replayed repeatedly; it still has only one row.

## Unresolved latency

The original five-second HTTP timeout expired on some calls despite a successful Sheet write. Increasing Lambda memory from 128 MB to 256 MB and extending the HTTP deadline from five to six seconds did **not** resolve the issue: one cold invocation took 6,034.75 ms and a subsequent warm invocation took 6,006.32 ms, both returning the uncertain-save response. This is not exclusively a cold-start failure. No automatic retry or optimistic success message was introduced.

Current deployed configuration: Node.js 24, `index.js` / `index.handler`, 256 MB, Lambda timeout seven seconds, HTTP timeout six seconds. Local handler and setup guide match. All 13 local voice tests pass; the two existing app test files also passed earlier in this validation session. Those tests do not establish real cloud latency.

Next engineering investigation should instrument the initial Apps Script POST and ContentService redirect separately, recording only stage names, elapsed times and status codes, never bodies, credentials or redirect URLs. If the Google round trip cannot reliably fit Alexa's response window, revisit the synchronous transport before connecting local app sync. Do not keep extending the deadline beyond Alexa's response budget or claim a save before an acknowledgement.

## Template listing investigation

The user reports that the enabled skill looks like a Hello World template. The developer console Distribution page for the same skill contains `Sample Short Description`, `Sample Full Description`, an example `hello`, and the Games & Trivia category. This establishes leftover listing metadata; it does not establish that a physical device is running the template handler. Earlier simulator launch/help/stop and Sheet writes exercised the custom handler.

Replacement descriptions and invocation examples were entered in the Distribution form, but saving could not be confirmed. The browser editor exhibited stale validation errors and unreliable input. Treat these as unsaved draft edits. A reload was blocked by automatic approval review because it might discard the draft; the page was left open. No certification or publication was requested.

## Physical launch clarification

The user confirmed that “open fifty A ledger” opens the skill on the Echo. The one-sentence “tell fifty A ledger to add a gallon” instead gets Alexa's “I don't know how to help with that.” This is distinct from the handler's uncertain-save response; one-shot routing remains unverified on the device. The local interaction model invocation was aligned with the already verified live invocation `fifty a ledger`. No cloud model change was made in this step.

The skill-info save error was finally visible: the submitted example phrase contained leftover simulator request JSON rather than only its displayed text. The save was rejected. Attempts to replace the field through native automation were unreliable. Intended non-secret listing text is preserved in `alexa/store-listing.json`. Automatic review blocked resetting the unsaved draft, and explicit approval to reload was requested. Do not treat the listing edits as saved or published.

## Listing recovery and device routing follow-up

After explicit user approval, the corrupted draft was discarded. Both descriptions had persisted earlier; the examples had remained `hello` and `help`. Replaced examples through native editing and saved. A separate browser tab loaded the listing from the server and confirmed all three examples: `Alexa, open fifty a ledger`, `Alexa, ask fifty a ledger to log a gallon`, and `Alexa, ask fifty a ledger for help`. The earlier request-JSON length/punctuation save error is resolved. No certification/publication was performed.

The user reports that `open fifty A ledger and add a gallon` also goes to the shopping list. The live AddGallonIntent editor confirms `add a gallon`, `add one gallon`, `add another gallon`, `log a gallon`, and `log one gallon` among six samples. A development rebuild was started to rule out a stale model; the console subsequently reported “Build Completed” and “Build was successful for skill 50-A.” The alternative `ask fifty a ledger to log a gallon` still needs physical-device verification.

## Spoken-name change completed

At the user's request, changed the development invocation from `fifty a ledger` to `apartment ledger`, keeping the display name 50-A. The user reported that their app transcribes the old spoken name as “58.” The console confirmed save success; a fresh page confirmed the new invocation and last successful build `9/22/2026 @ 11:58 AM`, with zero errors and warnings. A fresh Distribution page confirmed the description and all three examples use apartment ledger. Local model, store-listing.json and setup guide match. Physical-device recognition under the new name remains to be tested; no gallon was added by this rename operation.
