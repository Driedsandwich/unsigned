# Unsigned

Unsigned is a weekly, one-question team check-in. It helps people share a concern without sending their original writing to an administrator or cloud model. A small on-device model rewrites the text neutrally and flags potentially identifying details. The respondent can edit the rewrite and must approve the current version before sending. Administrators group approved rewrites into broad themes, with small groups suppressed.

The application uses Vite and JavaScript. Its CSS and layout come from `prototype/index.html` and `DESIGN.md`: the green palette, stacked private/rewrite editors, desktop timeline, mobile reflow, theme islands, and question tray are retained. `prototype/` and the supplied reference are unchanged. All product UI is English. The full Apache-2.0 license is in `LICENSE`.

## Run locally

Use a Node version supported by the installed Vite version. This delivery was tested with Node **26.13.0** and npm **11.20.0**.

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
| Identifying-detail detection | Raw respondent text | `ONLY_ON_DEVICE` | Names, dates, weekdays, and uncommon roles must be inspected locally. |
| Theme grouping | The complete batch of approved rewrites for one check-in | `ONLY_IN_CLOUD` | Only text already approved for sending may be grouped centrally. |
| Next-question draft | Administrator's request | `PREFER_ON_DEVICE` | Prefer local inference; the SDK may use cloud inference when local inference is unavailable. |

All inference goes through **`firebase/ai` from `firebase@13.4.0`**. No direct model API or direct `LanguageModel.prompt/create` call is used. Reading `LanguageModel.availability()` is capability detection only. SDK API shapes were checked against the installed package's declarations and implementation; no web documentation was consulted.

Raw text is held in memory and opaque input tokens. Raw tokens are rejected by both cloud-capable feature boundaries before a model is constructed. Only the Firebase adapter constructs models. All potentially local calls—including administrator question drafting—share one serial queue. Unsupported devices, model failures, and invalid local risk output switch to fixed topics and templates. There is no cloud fallback for either raw-text feature.

The first local call displays **Preparing on-device model**, with structured choices available while it prepares. Choosing a template invalidates the pending result and clears the original input. The rewrite grows from SDK stream chunks; approval stays disabled until the final rewrite and risk check finish. Input versions discard stale results. Manually edited drafts remain protected until explicit regeneration. Changing source text or draft text clears approval. SDK output is trimmed, including the trailing empty lines observed in the supplied spike.

Actual results display their SDK `inferenceSource`: `on_device` becomes **Ran on device**, and `in_cloud` becomes **Ran in cloud**. A missing or contradictory source rejects the result. Simulations say **Simulated · no AI inference**; structured answers say **No AI**. No simulation is presented as an actual cloud run. Execution metadata stays out of response documents.

The supplied `reference/on_device_spike.js` reports that Chrome 158 ran `ONLY_ON_DEVICE` with placeholder Firebase settings, with an approximately 11-second first call. That is supplied evidence, not a new measurement in this delivery. Browser availability, streaming behavior, speed, model download requirements, and rewrite quality on your device are **未確認 / not verified here**.

## Demo mode

When `public/firebase-config.js` is absent, the application uses made-up Firebase values and displays:

> Demo mode — cloud steps are simulated

The local rewrite and identifying-detail check use the **real Firebase AI Logic on-device SDK**. Authentication, Firestore, App Check, cloud grouping, and the cloud-capable administrator question helper are simulated in memory. This also means the Demo question helper does not try the real `PREFER_ON_DEVICE` route: it returns a clearly labeled fixture so a cloud fallback cannot accidentally occur with placeholder configuration.

The fictional cloud fixtures are in `src/fixtures.js`. Demo grouping returns the built-in fictional theme snapshot; it does not infer themes from your submitted text. Sending adds only the approved payload to memory. Reload resets Demo responses and drafts. **Next fictional respondent** is available only in Demo. **Open Demo Admin** does not authenticate with Google.

A missing configuration file is different from a broken configuration. Malformed or incomplete present configuration stops startup; it never silently falls back to Demo. The loader also recognizes Vite's HTML fallback for a missing public file.

## Configure Firebase locally

These are the services and values required by this implementation. Exact current Firebase console labels, project eligibility, billing, model availability, and service-side setup are **未確認 / not verified**; no real Firebase project was available or accessed during this work.

1. Create or select your own Firebase project and register its Web application. Keep the real values outside version control.
2. Enable Firebase AI Logic for the Google AI backend used by this application. Select a cloud model actually enabled for your project; this repo deliberately does not invent a model name. The model identifier is supplied as `cloudModel`.
3. Register the Web app with App Check using reCAPTCHA v3. Supply the site key as `appCheckSiteKey`, configure your intended domains, and configure enforcement for the services you use. The app initializes `ReCaptchaV3Provider` and token auto-refresh before Firebase service use. Initialization alone is not proof of server-side enforcement.
4. Enable Authentication with Anonymous and Google providers, and configure the domains you will use. Respondents sign in anonymously. Administrators use Google popup sign-in in a separate Firebase app/auth context. An administrator signing in does not change the anonymous identity used for response writes.
5. Provision **`unsigned_admin: true`** as a trusted custom claim for authorized Google accounts, using your own trusted Firebase administration process. Never allow clients to grant this claim. The browser checks the claim and Google sign-in provider; Firestore rules independently enforce both. This repo contains no privileged admin credentials or self-enrollment endpoint. The exact trusted claim-provisioning procedure is **未確認** in the supplied material and must be completed in your project.
6. Create Firestore and install the supplied **`firestore.rules`**. `firebase.json` points to that file. Apply the rules using your own Firebase administration tooling; this delivery did not run a deployment. Verify them in your own Rules Emulator/project before opening the app to real users.
7. Copy the example and fill in local values:

   ```sh
   cp public/firebase-config.example.js public/firebase-config.js
   ```

   The real file is ignored. It sets `globalThis.UNSIGNED_CONFIG` with `firebase`, `appCheckSiteKey`, and `cloudModel`. Do not commit real values or include them in review screenshots, fixtures, issue text, or logs. The Web config is served to the browser at runtime; `.gitignore` protects the repository, not the runtime visibility of browser configuration.
8. Start the app, sign in as an administrator, enter an administrator request, and generate a question. **Use draft** creates a Firestore check-in with `status: draft`. In **Questions**, **Confirm and open for responses** is a separate human action. Share its generated `?checkin=...` URL. Opening a draft is never triggered by the MCP tools. If the default `check-in-001` does not exist, the respondent form stays unavailable while administrator setup remains accessible.
9. Respondents use an open check-in link. In Admin, **Group approved responses** reads the complete approved batch for that check-in and runs cloud grouping only when at least three responses exist. It saves and renders only thresholded themes. There is no automatic aggregation trigger.

For local App Check debugging only, put your own registered debug value in an ignored `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`. No value is supplied in this repo. The code reads it only behind `import.meta.env.DEV`; production builds do not enable the debug hook. Treat it as local sensitive configuration. Do not place it in the example file. Exact debug-token registration steps are **未確認** here. Real mode and App Check were not exercised against any external service.

A deployment needs the real `firebase-config.js` at the origin root. Vite copies a local public config into the local build if present; do not publish or share such a build inadvertently. The delivered source and dist were produced with **no real configuration file**.

## Data boundaries and privacy limits

The application-level approved payload contains exactly:

```json
{
  "question_id": "check-in-001",
  "approved_rewrite": "A shared checklist could help."
}
```

The Firestore adapter adds `created_at: serverTimestamp()` when storing it in `responses/{randomDocumentId}`. No respondent UID, account name, raw text, edit history, risk markers, or inference metadata is stored in response documents. The random document ID identifies the submission, not a person. The same ID is reused for a retry. Double clicks are blocked, and create-only rules prevent retry overwrites. If the server accepted a write but its acknowledgement was lost, a retry can be denied; the UI reports that uncertainty rather than pretending it succeeded.

Authentication and App Check necessarily involve service credentials outside the document body. The two-field promise describes application content, not the entire Firebase transport. The app does not claim network-level anonymity from Firebase.

Firestore collections:

- `checkins/{id}`: question, draft/open/closed status, creation timestamp. Respondents can get open check-ins; only authorized administrators list or change them.
- `responses/{id}`: the two payload fields plus timestamp. Anonymous users can only create valid responses for open questions; only administrators can read them. Updates and deletes are denied.
- `themes/{checkinId}/items/{id}`: title, summary, and band (`3–5`, `6–8`, `9+`). Only administrators can access them. No individual evidence indexes or exact counts are stored here.

Cloud output must provide supporting response indexes. The app counts unique, valid indexes and removes themes below three before saving or rendering. It does not trust a model-provided count. Read and MCP export boundaries project only title, summary, and allowed bands. Malformed results fail closed. Administrators and the local theme-export file remain trusted: Firestore rules validate the allowed band/schema, but cannot prove that an administrator-generated band reflects genuine evidence or that a model grouped correctly.

**Distinct-human counting is not implemented.** With no respondent identifier stored with a response, the app can count distinct submission records but cannot prove they came from distinct people. Reloads, new anonymous sessions, or a modified client can submit again. The UI retains the requested “Below 3 people: hidden” and respondent-band language, with a submissions clarification. The enforced threshold is three supporting submissions. An independently reviewed anonymous participation/eligibility mechanism is needed before treating that as a guarantee about three different humans. No such protocol was present in the supplied materials, and this repo does not claim to have solved it.

Rewriting and risk marking are aids to human review, not guaranteed anonymization. Respondents can still approve identifying details. Raw text exists transiently in DOM, JavaScript memory, and the local model while processing; it is not deliberately persisted, logged, placed in URLs, or passed to a cloud feature. Clearing application state cannot guarantee secure erasure of browser/model memory. Approved text is intentionally sent only after approval.

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

## Verification and manual Chrome checklist

`npm test` runs **46 Node tests**. They cover exact policy enforcement, unsafe-mode rejection, raw-token cloud rejection, SDK source validation, serial calls, stream growth and stale results, approval resets, exact submission projection, threshold/band boundaries, unavailable/preparing/failed device paths, Demo detection, MCP output boundaries, and a real SDK stdio handshake. DOM IDs and event-target references are checked statically. Firestore rules assertions are **source checks**, not emulator execution. Model responses are mocked in Node; the browser SDK's local engine is not run by these tests.

`npm run build` runs these tests before bundling. `npm run dev -- --port 5173 --strictPort` was started successfully and then stopped without opening a browser. The original prototype files were checked for changes and remain unchanged.

On your own Chrome:

1. Leave the real config absent, run `npm run dev`, and open the printed local URL. Confirm the Demo banner. Choose **Insert example**, or type fictional feedback.
2. Observe **Preparing on-device model** on the first run. While preparing, check that structured choices are available. If you choose them, the old local result must not replace your answer. No cloud retry is offered.
3. On a supported device, wait for the growing rewrite and then the risk check. Confirm **Ran on device** for both results. Look for highlighted exact names/weekdays/roles. The model may miss details or fail to return valid JSON; invalid output should switch to templates.
4. Edit the rewrite, approve it, then change either source or draft. Approval must clear. After a protected edit and source change, use **Regenerate** explicitly. Send only after a complete current draft is approved.
5. Inspect the receipt's two-field JSON and local execution label. In Demo, no real Firestore response is written. With unavailable local AI, use a topic plus a fixed short template and confirm **No AI**.
6. Open Demo Admin. Group the fictional approved responses; only fixture themes with allowed bands appear and the result says **Simulated**. Enter an administrator request, generate a fixture question, and select **Use draft**. Confirm that opening it requires a separate button. Demo links are not persistent shared links.
7. Open Settings, inspect For AI agents, and export the safe theme snapshot if desired. Run the MCP test/client independently; it must not expose individual answers.
8. Inspect 390px and 1440px widths and 200% zoom. Check stacked editors and timeline, theme list reflow, keyboard focus, tab-arrow navigation, labels, and status announcements. No screenshot or visual inspection was performed here.
9. Only after completing your Firebase setup, repeat with fictional data in real mode. Check anonymous and authorized/unauthorized Google identities, App Check enforcement, create-only response rules, denied respondent reads, and theme isolation. With fewer than three approved records, grouping must not invoke AI. Check actual `in_cloud` grouping and the SDK-reported location for administrator question drafting. Remove the test data through your trusted administration process if appropriate; the app does not expose response deletion.

## Known delivery limits

- No browser was launched, no screenshot was made, and no actual on-device inference was newly measured. UI rendering and Chrome behavior are **未確認**.
- No Firebase project was configured, no real credentials were used, and no Authentication/App Check/cloud inference/Firestore integration was run. Firestore rules were not compiled or exercised in an emulator. Those service-side checks are **未確認**.
- Distinct-human enforcement and model anonymization accuracy are not guaranteed; see the data-boundary section above.
- The MCP live path is a human-exported aggregate snapshot. Scheduling remains a local draft, by design.
- `npm install` reported **5 high-severity dependency advisories**. Their precise exploitability was not independently investigated in this restricted run. Firebase remains pinned to the required `13.4.0`; no unreviewed major upgrade was applied.
- Vite reports a JavaScript chunk above 500 kB. The build succeeds; bundle-size optimization is not included.

All statements about package APIs above come from the installed npm packages or supplied files. External setup details not established by those materials are marked unverified rather than inferred from web pages.
