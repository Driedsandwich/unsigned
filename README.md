# Unsigned

Unsigned is a weekly, one-question team check-in. It helps people share a concern without sending their original writing to an administrator or cloud model. A small on-device model rewrites the text neutrally and flags potentially identifying details. The respondent can edit the rewrite and must approve the current version before sending. Administrators group approved rewrites into broad themes, with small groups suppressed.

The application uses Vite and JavaScript. Its CSS and layout come from `prototype/index.html` and `DESIGN.md`: the green palette, stacked private/rewrite editors, desktop timeline, mobile reflow, theme islands, and question tray are retained. `prototype/` and the supplied reference are unchanged. The interface is available in English and Japanese. The full Apache-2.0 license is in `LICENSE`.

## Run locally

Use a Node version supported by the installed Vite version. This delivery was tested with Node **26.13.0** and npm **11.20.0**. The installed Firebase SDK requires Node >=24.12.0; Node 24.12+ on the 24.x line also fits the installed emulator CLI dependency engines. The current Node 26 run emitted an engine warning for `superstatic` (declares Node 20/22/24), but the commands below passed.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite in your own Chrome. Do not open `index.html` directly from the filesystem. No configuration file is needed for Demo mode.

```sh
npm test
npm run build
npm run preview
```

`build` runs the privacy tests first, then writes `dist/`. `dev` and `preview` bind to localhost. Deploying, publishing, committing, and sending to external applications were not performed for this delivery.

## Inference policy and why it exists

The single executable routing definition is **`src/policy.js`**. The following is its human-readable table. The runtime dispatcher reads that definition; callers cannot pass a different mode. Build-time tests assert the exact four routes and reject unsafe mutations.

| Feature | Allowed input | Firebase AI Logic mode | Reason |
| --- | --- | --- | --- |
| Response rewrite | Raw respondent text | `ONLY_ON_DEVICE` | The original writing must stay on the respondent's device. |
| Identifying-detail detection (before rewrite and draft review) | Private respondent text and local risk context | `ONLY_ON_DEVICE` | Names, dates, weekdays, and uncommon roles must be inspected locally. |
| Theme grouping | The complete batch of approved rewrites for one check-in | `ONLY_IN_CLOUD` | Only text already approved for sending may be grouped centrally. |
| Next-question draft | Administrator's request | `PREFER_ON_DEVICE` | Prefer local inference; the SDK may use cloud inference when local inference is unavailable. |

All inference goes through **`firebase/ai` from `firebase@13.4.0`**. No direct model API or direct `LanguageModel.prompt/create` call is used. Reading `LanguageModel.availability()` is capability detection only. SDK API shapes were checked against the installed package's declarations and implementation; no web documentation was consulted.

Raw text is held in memory and opaque input tokens. Raw tokens are rejected by both cloud-capable feature boundaries before a model is constructed. Only the Firebase adapter constructs models. All potentially local calls—including administrator question drafting—share one serial queue. Unsupported devices, initial source-risk failures, and rewrite failures switch to fixed topics and templates. Semantic draft review failures preserve the private draft and show an advisory warning. There is no cloud fallback for either raw-text feature.

The first local call displays **Preparing on-device model**, with structured choices available while it prepares. Choosing a template invalidates the pending result and clears the original input. The device first detects identifying details in the original text. The rewrite prompt receives their exact terms, categories and zero-based sourceRiskIndex values and asks for their removal, including paraphrases. The rewrite grows from SDK stream chunks. All three inference calls use `ONLY_ON_DEVICE` through Firebase AI Logic.

After generation, a deterministic local matcher checks only literal original flags (case-insensitive, with word boundaries) and the finite role/weekday alias table. Only these matches require **I explicitly choose to keep the exact original terms or fixed aliases in this version** before approval. It does not extract arbitrary words from role descriptions. Highlights cover matching terms, not surrounding sentences. An edited draft is checked synchronously against the same table; changing either source or draft clears approval and retention. Input versions discard stale results, and source changes after a manual draft edit still require explicit regeneration.

The second `identifyRisks` call is advisory. Its prompt asks for literal phrases of 1–4 words linked to an original flag by integer sourceRiskIndex. Valid links appear below the draft as **AI note: may still point to “original flag”**. Only short phrases literally present at word boundaries are highlighted; sentences, absent phrases, and invalid indexes cannot produce sentence highlights. Generic team / people / updates wording is discarded unless it was itself an original flag. Phrases made only of ordinary words (the same list the source-side marks use) are never highlighted on the draft, and an AI note is dropped only when the flag it names (or a fixed alias) is not in the draft and the note's own phrase has no specific word (or it has no phrase). A note whose phrase contains a specific word stays. These notes never enter the deterministic retention list. A completed draft can be approved during advisory checking, subject only to deterministic retention and normal version/approval requirements. Completing an advisory check does not clear an existing approval.

Semantic errors, malformed JSON, or timeouts preserve the private draft and show **AI check unavailable — review the draft yourself** plus **Semantic draft check: error/timeout**. Only failures in **Source risk check** or **Rewrite** switch to templates. Each failure emits one sanitized console warning containing only its stage and error/timeout classification; exception contents and text are never logged. SDK output is trimmed, including trailing empty lines.

`src/private-check.js` gives each respondent inference call 60 seconds, including lazy loading, queue wait, preparation and generation. This allows headroom beyond the supplied approximately 11-second first-call preparation; it is not a measured performance guarantee. The previous 1,000 ms SDK `RequestOptions.timeout` remains the Demo cloud HTTP guard, not a device inference deadline (confirmed in the installed Firebase package). Timed-out results and partial chunks are ignored. A still-running SDK call retains its shared queue slot until it settles, so no concurrent local calls are introduced. If the SDK never settles, further advisory checks can time out while deterministic review and approval remain usable; regenerating a rewrite may instead fall back to templates. The wrapper does not cancel the underlying SDK operation.

Actual results display their SDK `inferenceSource`: `on_device` becomes **Ran on device**, and `in_cloud` becomes **Ran in cloud**. A missing or contradictory source rejects the result. Simulations say **Simulated · no AI inference**; structured answers say **No AI**. Demo question fallback specifically says **Cloud fallback (simulated in demo)**. No simulation is presented as an actual cloud run. Execution metadata stays out of response documents.

The supplied `reference/on_device_spike.js` reports that Chrome 158 ran `ONLY_ON_DEVICE` with placeholder Firebase settings, with an approximately 11-second first call. That is supplied evidence, not a new measurement in this delivery. Browser availability, streaming behavior, speed, model download requirements, and rewrite quality on your device are **未確認 / not verified here**.

## Demo mode

When `public/firebase-config.js` is absent, the application uses made-up Firebase values and displays:

> Demo mode — cloud steps are simulated

The local rewrite and both identifying-detail checks use the **real Firebase AI Logic on-device SDK**. The administrator question helper also runs the real **`PREFER_ON_DEVICE`** SDK route when the device reports `available`, passes the administrator request to the model, and labels the result from `inferenceSource` as **Ran on device**. Authentication, Firestore, App Check and cloud grouping remain simulated in memory.

Only when local inference is unavailable does the Demo question helper produce a deterministic, editable question from the supplied request and label it **Cloud fallback (simulated in demo)**; that fallback is not AI inference. `downloadable` and `downloading` mean not yet available to the SDK 13.4.0 preferred route, so those states also use the simulated fallback. Availability is checked inside the shared queue with the same text/English options passed to the SDK. Unknown availability and model failures report failure instead of silently becoming a simulation. Demo models use the SDK public `RequestOptions.baseUrl` set to `http://127.0.0.1:9` with a short timeout: if availability changes between the probe and SDK dispatch, a cloud attempt cannot target an external Firebase endpoint. Such a race fails safely; retry after the device settles. No global transport interception or SDK private API is used.

The fictional cloud fixtures are in `src/fixtures.js`. Demo grouping uses fictional themes and supporting indexes, filtered against the number of matched participant markers; it does not infer topics from submitted text. The default check-in starts with ten fictional responses and ten distinct participant markers. Submission adds the approved response and its separate marker atomically in memory. The same fictional sign-in cannot answer the same question again, including retries; it may answer a different question. **Next fictional respondent** explicitly creates another fictional sign-in and is available only in Demo. Other question IDs start without participants. Reload resets Demo identities, responses and drafts. **Open Demo Admin** does not authenticate with Google.

A missing configuration file is different from a broken configuration. Malformed or incomplete present configuration stops startup; it never silently falls back to Demo. The loader also recognizes Vite's HTML fallback for a missing public file.

## Judge sandbox

1. Open the configured Firebase Hosting URL in a supported Chrome browser. Click **Try it as a judge (fictional team, nothing saved)** or open the same URL with `?sandbox=1`. No login is required.
2. In **Admin → Themes**, enter a fictional request such as “Ask what would make handoffs easier.” Click **Generate draft**, check the SDK’s execution label, then click **Use draft**.
3. In **Questions**, click **Confirm and open for responses**. The respondent form opens in the same tab, with ten fictional responses already approved for this check-in.
4. Click **Insert example** to try the private rewrite and risk checks. Check **Ran on device**, review the draft, tick **I approve this version**, then click **Send approved response**.
5. Click **See themes in Admin → Group approved responses**. Check **Ran in cloud** and the theme bands. The tab holds the fictional records and results until you reload or select **Exit sandbox and return to the respondent view**.

The sandbox allows cloud grouping up to 3 times per tab (counted in memory, so a reload resets it); the fourth attempt shows a limit message and never calls the cloud. Only configured installations show the sandbox entry. Question drafting uses the device-preferred Firebase AI Logic route, which can fall back to the cloud. Private rewriting and both risk checks require the on-device model. Grouping uses the configured cloud model with App Check and sends only the matched approved rewrites for the current question. Check-ins, individual approved submissions, participant markers, and saved themes stay in tab memory. The sandbox makes no Firebase Authentication or Firestore calls.

## Configure Firebase locally

The project record supplied for this revision reports a successful end-to-end run on **2026-11-24** with a real Firebase project. It used Firebase AI Logic via the Gemini Developer API with the cloud model `gemini-3.5-flash-lite`, App Check with reCAPTCHA Enterprise, Anonymous and Google Authentication, and Firestore with rules. In Chrome 158 the administrator drafted a question (**Ran on device**) and opened it. Three fictional respondents completed on-device rewriting, approved their rewrites, and submitted them. **Group approved responses** reported **Ran in cloud** and returned one theme in the **3–5** band.

On **2026-11-27**, the project fixed excessive flagging of common words and an administrator sign-in that was lost on reload. The current revision did not repeat the live-project run. Exact current Firebase console labels, project eligibility, billing, current model availability, and server-side App Check enforcement are **not verified** here.

1. Create or select your own Firebase project and register its Web application. Keep the real values outside version control.
2. Enable Firebase AI Logic with the Gemini Developer API backend. Set `cloudModel` to a model enabled for your project.
3. Register the Web app with App Check using reCAPTCHA Enterprise. Create a score-based Web site key in Google Cloud, list your intended domains on it, supply it as `appCheckSiteKey`, and configure enforcement for the services you use. The app initializes `ReCaptchaEnterpriseProvider` and token auto-refresh before Firebase service use. Verify enforcement separately against your project.
4. Enable Authentication with Anonymous and Google providers, and configure the domains you will use. Respondents sign in anonymously. Administrators use Google popup sign-in in a separate Firebase app/auth context. An administrator signing in does not change the anonymous identity used for response writes.
   On startup the app now waits for the administrator Auth context to restore its tab session and revalidates the Google provider and administrator claim, because previously that context was initialized only when starting a Google sign-in.
5. Provision **`unsigned_admin: true`** as a trusted custom claim for authorized Google accounts, using your own trusted Firebase administration process. Never allow clients to grant this claim. The browser checks the claim and Google sign-in provider; Firestore rules independently enforce both. This repo contains no privileged admin credentials or self-enrollment endpoint. The exact trusted claim-provisioning procedure is **未確認** in the supplied material and must be completed in your project.
6. Create Firestore and install the supplied **`firestore.rules`**. `firebase.json` points to that file. Apply the rules using your own Firebase administration tooling. A previous delivery exercised the suite below in the local Rules Emulator. Live rule enforcement for the current revision is **not verified**.
7. Copy the example and fill in local values:

   ```sh
   cp public/firebase-config.example.js public/firebase-config.js
   ```

   The real file is ignored. It sets `globalThis.UNSIGNED_CONFIG` with `firebase`, `appCheckSiteKey`, and `cloudModel`. Do not commit real values or include them in review screenshots, fixtures, issue text, or logs. The Web config is served to the browser at runtime; `.gitignore` protects the repository, not the runtime visibility of browser configuration.
8. Start the app, sign in as an administrator, enter an administrator request, and generate a question. **Use draft** creates a Firestore check-in with `status: draft`. In **Questions**, **Confirm and open for responses** is a separate human action. Share its generated `?checkin=...` URL. Opening a draft is never triggered by the MCP tools. If the default `check-in-001` does not exist, the respondent form stays unavailable while administrator setup remains accessible.
9. Respondents use an open check-in link. In Admin, **Group approved responses** reads the complete approved batch for that check-in and joins responses to the question’s participant markers and runs cloud grouping only when at least three distinct anonymous sign-ins have matching approved responses. It saves and renders only thresholded themes. There is no automatic aggregation trigger.

For local App Check debugging only, put your own registered debug value in an ignored `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`. No value is supplied in this repo. The code reads it only behind `import.meta.env.DEV`; production builds do not enable the debug hook. Treat it as local sensitive configuration. Do not place it in the example file. Exact debug-token registration steps are **not verified** here.

A deployment needs the real `firebase-config.js` at the origin root. Vite copies a local public config into the local build if present; do not publish or share such a build inadvertently. The delivered source and dist were produced with **no real configuration file**.

## Data boundaries and privacy limits

The application-level approved payload contains exactly:

```json
{
  "question_id": "check-in-001",
  "approved_rewrite": "A shared checklist could help."
}
```

The Firestore adapter adds `created_at: serverTimestamp()` when storing it in `responses/{randomDocumentId}`. No respondent UID, account name, raw text, edit history, risk markers, or inference metadata is stored in response documents. The random document ID identifies the submission. In the same `writeBatch`, the adapter also creates `checkins/{question_id}/participants/{anonymousUid}` containing only `response_id` and `created_at`. The UID is in that separate marker’s path, never in the response document. Rules use `!exists`, `existsAfter` and `getAfter` to require that each side is newly created together, belongs to the same open question, and references the matching response. The marker can be created only under the caller’s UID; markers and responses cannot be updated or deleted by clients. One marker cannot authorize multiple response documents, even in the same batch. The same ID is reused for a retry. Double clicks are blocked, and create-only rules prevent retry overwrites. If the server accepted a write but its acknowledgement was lost, a retry can be denied; the UI reports that uncertainty rather than pretending it succeeded.

Authentication and App Check necessarily involve service credentials outside the document body. The two-field promise describes the response payload, not the entire Firebase transport: the separate participant marker and its UID path are also written, along with server timestamps. The app does not claim network-level anonymity from Firebase.

Firestore collections:

- `checkins/{id}`: question, draft/open/closed status, creation timestamp. Respondents can get open check-ins; only authorized administrators list or change them.
- `responses/{id}`: the two payload fields plus timestamp. Anonymous users can only create valid responses for open questions together with their new participant marker; only administrators can read them. Updates and deletes are denied.
- `checkins/{questionId}/participants/{anonymousUid}`: `response_id` and timestamp. One create per anonymous sign-in per question, atomic with its response. Only administrators can read markers. Updates and deletes are denied.
- `themes/{checkinId}/items/{id}`: title, summary, and band (`3–5`, `6–8`, `9+`). Only administrators can access them. No individual evidence indexes or exact counts are stored here.

The administrator adapter reads responses and participant markers for the same question. The inference boundary joins them by `response_id`, rejects duplicate marker identities or reused response references, and excludes orphan responses. It requires at least three matched markers. Only the resulting approved text strings reach cloud AI; UIDs, response IDs, markers and timestamps do not. Cloud output must provide supporting indexes into this joined batch. Each valid index represents a different marker, so theme bands count distinct supporting anonymous sign-ins (3–5 / 6–8 / 9+), not total responses or total check-in participants. Duplicate/invalid indexes do not count, and themes below three are removed before saving or rendering. Stored themes are hidden on load when the question has fewer than three participant markers. It does not trust a model-provided count. Read and MCP export boundaries project only title, summary, and allowed bands. Malformed results fail closed. Administrators and the local theme-export file remain trusted: Firestore rules validate the allowed band/schema, but cannot prove that an administrator-generated band reflects genuine evidence or that a model grouped correctly.

**Counting limit: one person means one anonymous sign-in per question.** The UI’s “at least three distinct respondents” and “Below 3 people: hidden” use that definition. A second anonymous sign-in can answer again; this implementation cannot establish that different anonymous sign-ins are different humans. Reloading with the same authenticated UID does not permit a second marker; starting a different anonymous identity does. This is not human identity verification or protection against one person acquiring multiple identities.

**Linkability limit:** the separate marker links an anonymous UID to a response ID. Authorized administrators can join those records, and a UID reused across questions can be correlated. Response documents remain free of respondent identity fields, but the whole database is not unlinkable. Neither marker identity nor the linkage is exported to cloud grouping or MCP.

**Existing-data migration:** old responses have no participant evidence and are excluded from new grouping. There is no safe way to infer which old records represent different sign-ins. Use a new check-in with newly paired submissions; do not manufacture historical markers. Old saved themes may reflect the previous submission-based count; discard/recompute them before relying on them. The app cannot prove the provenance of old theme documents or imported MCP snapshots.

Rewriting and risk marking are aids to human review, not guaranteed anonymization. Respondents can explicitly retain flagged identifying details and then approve them. The deterministic alias list is deliberately finite (including QA / quality assurance / testers, release leads, designers and analysts); advisory semantic model checks can still miss unfamiliar phrasing or overflag benign wording and never require explicit retention. These checks do not guarantee anonymity or forbid a respondent’s explicit retention choice. Raw text exists transiently in DOM, JavaScript memory, and the local model while processing; it is not deliberately persisted, logged, placed in URLs, or passed to a cloud feature. Clearing application state cannot guarantee secure erasure of browser/model memory. Approved text is intentionally sent only after approval.

## MCP for AI agents

The small MCP server uses `@modelcontextprotocol/sdk` over **local stdio**. It does not open an HTTP listener, call model APIs, or connect to Firestore. It has no Firebase administrative credentials. Access is the local operating-system user's access; it is not a remotely authenticated service.

Start it after installing the repository dependencies:

```sh
npm run mcp
```

For an MCP client, configure the executable directly so npm's startup output does not interfere with protocol stdout:

```json
{
  "mcpServers": {
    "unsigned": {
      "command": "node",
      "args": ["/absolute/path/to/unsigned/mcp/server.js"],
      "env": { "UNSIGNED_MCP_MODE": "demo" }
    }
  }
}
```

The exact client configuration container above is an illustrative shape; your client's format is **未確認**. The Node command and stdio transport were exercised by the included integration test.

- `get_themes`: returns only `{themes: [{title, summary, band}]}`. Default Demo mode uses fictional themes.
- `draft_check_in_question`: accepts `{request}` and returns it as an editable question draft with `inference: none`. It does not infer anything.
- `schedule_check_in`: accepts `{question, proposed_date: "YYYY-MM-DD"}` and writes an owner-readable local JSON draft under ignored `mcp/private/`. It returns `scheduled: false` and `human_confirmation_required: true`. It never writes to Firebase, schedules a job, or publishes anything.

For real aggregate data, sign in to Admin → Settings → **Export safe themes for MCP**, then place the downloaded `themes.local.json` in `mcp/private/`. Start the server with `UNSIGNED_MCP_MODE=live`. It rereads only this safe aggregate snapshot for `get_themes`; it never opens the responses collection. Missing/invalid files fail closed. Refresh the export when you need new themes. Live snapshots are not live Firestore subscriptions. An administrator may review local scheduling drafts and enter the question into the app manually; there is no automatic draft import or calendar integration.

Raw answers, individual approved answers, evidence indexes, and below-threshold themes are excluded. Never place response exports or personal data in the MCP snapshot. `llms.txt` provides the short machine-readable contract. The same tool boundaries appear in Settings → For AI agents.

## iOS respondent app

`ios/` contains a SwiftUI respondent flow that rewrites on the phone with Apple Foundation Models via the Firebase AI Logic Apple SDK. Only the on-device model is used for the respondent's original text. Approved text is kept in memory and shown; there is no Firestore submission on iOS yet. Build steps and limits: [ios/README.md](ios/README.md).

## Verification and manual Chrome checklist

`npm test` runs Node tests covering policy enforcement, private-token routing, SDK source checks, serial execution, streamed/stale results, source-first risk detection, risk-aware prompts, deterministic and semantic draft checks, approval/retention resets, Demo device preference and request-based fallback, participant joins and thresholds, Demo one-sign-in participation, two-field response projection, configuration handling, and MCP boundaries/stdio. It also checks both supplied Chrome rewrite regressions, nonblocking semantic errors/timeouts and sentence claims, literal advisory spans, stage-only diagnostics, the 60-second deadline with fake timers, late-result rejection, source-index validation, lazy service initialization/retry, shared inference queue, Demo flows, and the production chunk graph and size budget. Sandbox tests check configuration gating, tab-memory lifecycle, and the actual Firebase AI SDK's cloud request and App Check header with intercepted transport. DOM IDs and event references across the entry and deferred admin template are checked statically. AI responses are mocked and Chrome’s local model is not exercised by these tests.

`npm run build` runs the Node suite before Vite bundling. It also emits `dist/.vite/manifest.json` for inspecting import boundaries. A local headless Chromium check used the built app and intercepted external requests. It covered Demo gating, the sandbox flow, SDK labels, the App Check header, reload, and exit. The browser's model and remote services were mocked. Current execution results and limitations are recorded in the delivery report outside the repo.

### Firestore Rules Emulator

The rules suite uses `@firebase/rules-unit-testing` and the local Firestore emulator. Java and emulator binaries are not included in the delivered source.

With Java 21 installed and `java` on PATH, run:

```sh
npm ci
java -version
npm test
npm run test:rules
npm run build
```

`test:rules` starts only the local Firestore emulator at `127.0.0.1:8080` with project ID `demo-unsigned`, loads `firestore.rules`, runs `tests/rules/*.test.js`, then stops the emulator. No Firebase login, real config, deployment or external database write is needed. The first CLI run may download the emulator. The test file refuses to run without a localhost `FIRESTORE_EMULATOR_HOST`; it never falls back to a real project. Tests clear only the demo emulator database. Run this suite separately from `npm test` so ordinary unit tests and builds do not require Java.

Coverage includes valid atomic pairs; exact response fields; rejection of UID/author/raw/risk/source fields; missing fields; response without marker and marker without response; attempts to reuse old records; second participation for the same UID; different UIDs; the same UID on a different question; mismatched references; one marker with two responses; timestamps; closed questions; immutable records; admin-only get/list access to responses, themes and markers; and theme schema/band restrictions. Rules protect storage permissions and pairing; they cannot attest that a client’s text was actually reviewed or that an administrator’s theme has valid model evidence.

On your own Chrome:

1. Leave the real config absent, run `npm run dev`, and open the printed local URL. Confirm the Demo banner. Choose **Insert example**, or type fictional feedback.
2. Observe **Preparing on-device model** on the first run. While preparing, check that structured choices are available. If you choose them, the old local result must not replace your answer. No cloud retry is offered.
3. On a supported device, wait for source risk detection and the growing rewrite; observe the subsequent advisory draft check. Confirm **Ran on device** for each result. Try the supplied Maya / Tuesday standup / only QA person example. A generic rewrite ending in “the team” must not require explicit retention. Adding “quality assurance”, “testers”, “Maya”, or “Tuesday” must require explicit retention and mark only matching terms. Other semantic paraphrases are advisory only. A semantic check error or timeout must preserve the draft with an AI-check-unavailable note. Only initial source-risk or rewrite failures switch to templates.
4. Edit retained details out (deterministic checking is immediate), or explicitly choose to keep the marked details before approving. Then change either source or draft. Approval must clear. After a protected edit and source change, use **Regenerate** explicitly. Send only after a complete current draft is approved.
5. Inspect the receipt's two-field JSON and local execution label. In Demo, no real Firestore response is written. With unavailable local AI, use a topic plus a fixed short template and confirm **No AI**.
6. Open Demo Admin. Group the fictional approved responses; only fixture themes with allowed bands appear and the result says **Simulated**. Enter “Ask how release changes could reach testers sooner”. On an available device, generate a real `PREFER_ON_DEVICE` question and confirm **Ran on device**; when unavailable, confirm **Cloud fallback (simulated in demo)** and a request-based editable question. Select **Use draft**. Confirm that opening it requires a separate button. Demo links are not persistent shared links.
7. Open Settings, inspect For AI agents, and export the safe theme snapshot if desired. Run the MCP test/client independently; it must not expose individual answers.
8. Inspect 390px and 1440px widths and 200% zoom. Check stacked editors and timeline, theme list reflow, keyboard focus, tab-arrow navigation, labels, and status announcements. Those layout and accessibility checks are **not verified** for this revision.
9. Only after completing your Firebase setup, repeat with fictional data in real mode. Check anonymous and authorized/unauthorized Google identities, App Check enforcement, create-only response rules, denied respondent reads, and theme isolation. With fewer than three matched participant markers, grouping must not invoke AI. Try a second response under the same anonymous UID and confirm the atomic write is denied; three different anonymous UIDs should reach the threshold. Check actual `in_cloud` grouping and the SDK-reported location for administrator question drafting. Remove the test data through your trusted administration process if appropriate; the app does not expose response deletion.

## Known delivery limits

- The current sandbox has not been verified on Firebase Hosting or against a live Firebase project. Live App Check enforcement and actual on-device and cloud results for this revision are **not verified**.
- Distinct-human enforcement and model anonymization accuracy are not guaranteed; see the data-boundary section above.
- The MCP live path is a human-exported aggregate snapshot. Scheduling remains a local draft, by design.
- Current dependency advisory counts and exploitability are **not verified**. Firebase remains pinned to `13.4.0`.
- Admin UI loads on first Admin access, when a live administrator session is restored, or on sandbox entry. The AI adapter loads on first inference and shares one cached device queue. Demo and sandbox load memory stores. The standard live check-in loads Authentication and Firestore. Browser latency for these paths is **not verified**.

All statements about package APIs above come from the installed npm packages or supplied files. External setup details not established by those materials are marked unverified rather than inferred from web pages.
