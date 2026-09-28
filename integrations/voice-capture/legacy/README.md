# LEGACY / INACTIVE — historical Sheets integration

Not used by the new handler. Original exact files are preserved in commit 7e5156c70b6271ab126c761b2fc8cc68d73941f7 in the old clone. Do not import historical test rows. The following documentation describes the old deployment only.

# 50-A voice capture — first milestone

Status: deployed to the user’s Google Sheet and development Alexa skill. Live simulator/replay checks completed on September 22, 2026. Writes and deduplication work, but acknowledgement latency is not yet reliable. The Echo test and device-local app-count check remain open. See [live validation results](LIVE-VALIDATION.md).

Target: **“Alexa, tell apartment ledger to add a gallon” → one pending row in Google Sheets.**

```text
Alexa Custom Skill / AddGallonIntent
  → AWS Lambda (Node.js 24, Alexa Skills Kit trigger)
  → Apps Script doPost (shared server-side token)
  → private Google Sheet / Events tab
```

The Lambda adapter is necessary: do not paste the Apps Script URL into Alexa's HTTPS endpoint field. Apps Script is the authenticated write target for Lambda, not the Alexa request-verification service.

## Existing app inspection

The active source was found at `/Users/crod/Desktop/50Arental`, commit `b3f1c2d`. The saved “50A First Rental!!” project under Documents/ChatGPT contains an empty `50Arental` checkout. This implementation is in a separate clone on branch `feature/alexa-sheet-capture`.

- `app.js:1,29–30`: state is persisted in localStorage under `fiftyA-ledger-v1`; `save()` marks sync dirty, stores state and renders.
- `app.js:7,14–19`: image blobs live in IndexedDB database `50a-ledger`, object store `attachments`.
- `index.html:64`: `addGallonBtn` is the dashboard **+1 GALLON** button.
- `app.js:98`: clicking adds `{id: crypto.randomUUID(), completedAt: ISO timestamp, gallon: sequence number, legacy: false}` to `state.settings.waterdropPayback.waterdropCompletions`, updates `gallonsLogged`, and saves locally. Undo removes the most recent completion.
- `app.js:21`: normalization migrates legacy counts and dates into completions. `waterdrop-utils.js` derives history and pace.
- `app.js:111–130`: optional Google Drive OAuth backup/merge already exists. It stores `50a-ledger-sync.json` in private `appDataFolder`; it is **not a Sheets integration**. Settings, including Waterdrop history, currently merge as a settings snapshot.

No browser code, local data, service-worker assets, existing backups, or Drive merge behavior were changed. The voice Sheet does not update the app yet and Alexa cannot report the app's gallon total.

## Files

| File | Purpose |
| --- | --- |
| `event.schema.json` | Generic ten-column contract for future water/expense capture |
| `apps-script/Code.gs` | Sheet initialization, authenticated append, validation, locked deduplication |
| `alexa/index.js` | Dependency-free Lambda handler |
| `alexa/en-US.json` | Importable interaction model with `AddGallonIntent` |
| `smoke-test.js` | Live endpoint check: one test event submitted twice |
| `tests/voice-capture.test.js` | Handler and actual Apps Script source exercised with mocked cloud services |

## 1. Create the Google Sheet

1. In your Google account, create a spreadsheet called **50-A Sync Ledger**. Keep its sharing private.
2. Rename the first tab **Events**, with exactly that capitalization.
3. Copy the spreadsheet ID: the part between `/d/` and `/edit` in its URL.
4. Select **Extensions → Apps Script**. Replace the default `Code.gs` contents with `apps-script/Code.gs` from this folder, then save.
5. In **Project Settings → Script properties**, add:

   | Property | Value |
   | --- | --- |
   | `SPREADSHEET_ID` | ID copied in step 3 |
   | `VOICE_CAPTURE_TOKEN` | A new random secret, at least 32 characters |

   To generate a secret locally, run `openssl rand -hex 32`. Copy it into Script properties and later Lambda environment variables. Do not put it into the Sheet, source files, browser app, URLs, screenshots, or chat.
6. In the editor, select **setupSheet** and click **Run**. Authorize the script using the account that owns the Sheet. It writes the header row only if the tab is empty and freezes it. An existing mismatched header causes an error instead of overwriting data.
7. Verify row 1 is exactly:

   ```text
   event_id | timestamp | module | action | value | unit | merchant | category | source | synced
   ```

   Timestamps are UTC text; `value` is numeric and `synced` is a boolean. Merchant and category are blank for gallons. `synced=false` means pending future app import, not a failed Sheet write.
8. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Deploy and copy the URL ending in `/exec`, not `/dev`.

The public web-app address uses the secret to authorize writes; it does not make the Sheet public. There is no read endpoint. If your Workspace administrator disallows anonymous web apps, this deployment path is blocked until that policy allows it or a different backend is selected. The app's Google OAuth client ID is not used here.

After editing script code, use **Deploy → Manage deployments → Edit → New version → Deploy** so the `/exec` endpoint runs the new version. Script properties are configuration and should remain outside code.

## 2. Prove the Sheet endpoint before Alexa

In a terminal, from this repository root, set `SHEETS_WEB_APP_URL` to your `/exec` URL and enter the same secret without saving it to shell history. For macOS zsh:

```sh
export SHEETS_WEB_APP_URL='https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
read -rs 'VOICE_CAPTURE_TOKEN?Paste the capture token: '
export VOICE_CAPTURE_TOKEN
node integrations/voice-capture/smoke-test.js
unset VOICE_CAPTURE_TOKEN
```

Requires Node.js 24. This deliberately writes **one test gallon** with a `test:` ID and sends that identical event twice. Expected: PASS and exactly one new Sheet row. Delete that specific test row after inspecting it so it is not imported as a real gallon later. If it fails or times out, check the printed ID in the Sheet before running again; each fresh run creates a new ID.

The request body is `{ "token": "<secret>", "event": { ... } }`. An example event is:

```json
{
  "event_id": "alexa:amzn1.echo-api.request.example-unique-id",
  "timestamp": "2026-09-21T17:00:00.000Z",
  "module": "water",
  "action": "add",
  "value": 1,
  "unit": "gallon",
  "merchant": "",
  "category": "",
  "source": "alexa",
  "synced": false
}
```

Success is `{ "ok": true, "event_id": "...", "duplicate": false }`; an identical retry returns `duplicate:true`. Apps Script can return HTTP 200 for an application error, so the adapter checks the JSON acknowledgement and exact ID. It also follows Google's ContentService redirect. Wrong secrets, malformed events, incompatible headers and lock contention are not acknowledged as successful saves.

## 3. Create the Alexa skill and Lambda

1. Sign in to the [Alexa developer console](https://developer.amazon.com/alexa/console/ask) with the same Amazon account used by your Echo.
2. Create a skill named **50-A**, primary locale **English (US)**, model **Custom**, hosting **Provision your own**, starting from scratch. Keep this as a development skill for your own use.
3. Under **Build → Interaction Model → JSON Editor**, import `alexa/en-US.json`. Save and build the model.
4. Use `apartment ledger` as the invocation name. Say **“Alexa, tell apartment ledger to add a gallon.”** The display name remains 50-A. The earlier spoken name was transcribed as “58” on the user's device, so it was replaced.
5. Copy the skill ID (starts with `amzn1.ask.skill.`) from the skill's Endpoint page.
6. In the [AWS Lambda console](https://console.aws.amazon.com/lambda/), select **US East (N. Virginia) / us-east-1**, then **Create function → Author from scratch**. Name it `fifty-a-voice-capture`, runtime **Node.js 24.x**, with a basic Lambda execution role. Leave it outside a VPC so it has outbound HTTPS access. AWS usage may incur account charges.
7. Replace the generated handler with `alexa/index.js`, keeping the file name **index.js** (CommonJS, not `index.mjs`). Remove the starter `index.mjs` if present. Set runtime handler **index.handler**, then **Deploy**. There are no packages to install.
8. Set the Lambda timeout to **7 seconds**, memory **256 MB**, and add environment variables:

   | Variable | Value |
   | --- | --- |
   | `ALEXA_SKILL_ID` | Exact skill ID from step 5 |
   | `SHEETS_WEB_APP_URL` | Apps Script `/exec` URL |
   | `VOICE_CAPTURE_TOKEN` | Same random secret as Script properties |
   | `ALLOWED_ALEXA_USER_ID` | Recommended: your Alexa user ID; see next section |

9. Add a Lambda trigger of type **Alexa Skills Kit**. Enable **Skill ID verification** and enter your exact skill ID. Do not enable a public Function URL or API Gateway endpoint. The restricted trigger verifies the caller; the handler also rejects a missing or mismatched skill ID.
10. Copy the Lambda ARN. In Alexa **Build → Endpoint**, choose **AWS Lambda ARN**, paste it into **Default Region**, and save. Do not use the Apps Script URL here.
11. In **Test**, enable skill testing for **Development**. Ensure the simulator and Echo use the skill's English (US) locale.

## Enable the development skill on physical devices

Simulator success does not establish that your Echo or Fire TV can open the development skill.

1. Sign in to the Alexa phone app with the same Amazon account used for the Alexa developer console. The Echo or Fire TV must also be registered to that account for this development test.
2. In the standard Alexa app, open **More → Skills & Games → Your Skills → Dev**. With Alexa+, use **More → Alexa+ Store → Browse Alexa Skills and Games → Your Skills → Dev**.
3. Find **50-A**, open it, and tap **Enable to Use** if offered. It is a development skill, so use the Dev list rather than searching the public store.
4. Verify the device language is **English (United States)**, matching the built skill locale.
5. First say only **“Alexa, open apartment ledger.”** On a Fire TV remote, hold the voice button and say **“Open apartment ledger.”** Wait for our prompt before saying **“add a gallon.”** Opening the skill alone does not write a row.
6. If the device still cannot open it, check the Alexa app's recorded interpretation of that launch phrase and whether the skill appears under Dev. Do not keep saying “add a gallon” outside the skill; Alexa may interpret it as a shopping-list request.

If the skill is absent from Dev, account/enablement must be resolved before changing the backend. Do not reset devices, switch accounts, disable owner checks, publish the skill, or rename the invocation as a speculative fix. A different-account device can use an explicitly configured beta-test path later.

[Amazon's device-testing and development-skill enablement instructions](https://developer.amazon.com/en-US/docs/alexa/test/test-your-skill-overview.html)

## 4. Test voice capture and restrict the account

1. In the simulator type **“open apartment ledger”** (microphone input is optional). The skill should prompt you to say “add a gallon,” without writing anything.
2. In the simulator's request JSON, copy `context.System.user.userId` (or `session.user.userId`) into Lambda's `ALLOWED_ALEXA_USER_ID`. Use the full ID starting with `amzn1.ask.account.`, not your email address. This restricts writes to your Amazon account. Keep the skill in Development; do not publish a shared single-user ledger. No account-linking flow is implemented.
3. Say **“Alexa, tell apartment ledger to add a gallon.”** Expected reply: **“Saved one gallon to your Sheet.”**
4. Verify exactly one new row: `water / add / 1 / gallon / alexa / FALSE`, blank merchant/category, UTC timestamp, and `event_id` equal to `alexa:` plus the request's `requestId`.
5. Copy that request JSON to a Lambda console test and invoke the **same payload** twice. The reply should say it was already saved and the row count must not increase. A newly spoken command has a new request ID and should add a new gallon.
6. Try “help” and “stop”; neither should add rows. Repeat the gallon command on your actual Echo once; verify its new row and response time.
7. Check the 50-A app: its existing gallon count remains unchanged. That is expected until the second milestone.

If Alexa says it could not confirm the save, inspect the Sheet before repeating the spoken command. A six-second HTTP timeout can occur after Google saved the row; saying the command again creates a new event. Deduplication protects redelivery of the same request, not two separately spoken requests. Apps Script cold starts can exceed Alexa's response budget; real latency is an acceptance check, not something the local tests prove.

## Acceptance checklist

- [ ] Live smoke test: one event submitted twice produces one row.
- [ ] Simulator and Echo: one spoken command produces one uniquely identified row.
- [ ] Replayed identical Alexa request does not produce another row.
- [ ] Wrong secret cannot append; missing/mismatched skill ID is rejected.
- [ ] Help, launch and stop do not write.
- [ ] Failure or timeout never claims an acknowledged success.
- [ ] App's local gallon count and existing Drive sync are unchanged.

Latest live results: [LIVE-VALIDATION.md](LIVE-VALIDATION.md). Do not treat this checklist as fully passed while acknowledgements time out.

Local validation:

```sh
node --test integrations/voice-capture/tests/*.test.js tests/*.test.js
```

Thirteen voice tests and both existing app test files pass. These run the actual Lambda handler and Apps Script source with mocked Sheets, locks and HTTP. They cover authentication, retries, an ambiguous committed write, ID conflicts, bad headers, invalid events, timeouts and error responses. They do not verify Google authorization, native cell formatting, simultaneous cloud invocations, speech recognition or deployed latency. The Echo and latency acceptance checks remain open.

## Boundary for the next milestone

Do not point the existing Drive backup at this Sheet or replace local state with Sheet rows. A future importer should deduplicate by `event_id` in durable local storage, apply the timestamp to `completedAt`, and add a completion through the existing local save path. Preserve the source event identity and commit the completion plus imported-ID record together before acknowledging import. Derive the sequence number locally; never treat the Sheet's `value:1` as a cumulative gallon total.

The existing Drive merge treats Waterdrop history as settings, so cross-device event union and undo semantics need explicit design before enabling import. The single `synced` field is only a reserved first-milestone flag; it cannot by itself represent multiple devices' acknowledgements. All captured rows stay false for now. Expenses have schema space but no accepted endpoint operation or Alexa intent yet. No scheduled job, background sync, cloud deployment or public skill publication is included.

## Official setup references

- [Apps Script web-app deployment and execution identity](https://developers.google.com/apps-script/guides/web)
- [ContentService redirects](https://developers.google.com/apps-script/guides/content)
- [Apps Script script locks](https://developers.google.com/apps-script/reference/lock/lock-service)
- [Host an Alexa skill on Lambda and restrict its skill ID](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-an-aws-lambda-function.html)
- [Invocation-name spelling and testing](https://developer.amazon.com/en-US/docs/alexa/interaction-model-design/design-the-invocation-name-for-your-skill.html)
- [Alexa response time budget](https://developer.amazon.com/en-US/docs/alexa/custom-skills/send-the-user-a-progressive-response.html)
- [Supported Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
