# Unsigned for iPhone (respondent flow)

A SwiftUI respondent screen that runs the rewrite on the phone with Apple Foundation Models through the Firebase AI Logic Apple SDK. Requires iOS 26+ and a device with Apple Intelligence.

## Build

1. Copy your own `GoogleService-Info.plist` to `ios/Sources/` (git-ignored).
2. `xcodegen generate --spec ios/project.yml --project ios`
3. `xcodebuild -project ios/UnsignediOS.xcodeproj -scheme UnsignediOS -destination 'id=<device>' -allowProvisioningUpdates DEVELOPMENT_TEAM=<your team> build`
4. Debug runs read an App Check debug value from the launch environment (`FIRAAppCheckDebugToken`); no value is stored in this repo. `-autorunDemo` runs the whole flow without touching the screen and writes `Documents/shots/*.png` and `Documents/result.json`.
5. `ios/tools/parity.sh` compares `Domain.swift` with `src/domain.js` on fixed cases (needs `swiftc` and `node`).

## What runs where

- On device: the risk-marking call and the rewrite call. Each uses a fresh session holding only `FirebaseAI.SystemLanguageModel.default`. No cloud Gemini model and no hybrid model is created in this app. If the on-device model is unavailable the app shows "On-device model unavailable" and stops.
- On device, no AI: fixed checks ported from `src/domain.js` (names, weekdays, dates, sole roles, role aliases). A marked detail left in the rewrite blocks approval; unlike the web app there is no "keep it anyway" override, and the third AI review call is not ported.
- Not running: nothing is uploaded. "Send approved response" keeps `{question_id, approved_rewrite}` in memory and shows it. Firestore submission is not implemented here.
- Not verified: network traffic was not measured; the claim rests on how the sessions are built. The app still initialises Firebase and App Check, which talk to Google services on their own.
