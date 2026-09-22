# Dzeline SMS Listener

Android companion app for the POS. It reads M-Pesa **notifications** (not SMS — no
`READ_SMS` permission, which keeps it Play Store compliant) and forwards confirmations to
the backend, so a till can reconcile a manually entered code against a payment that
actually arrived.

Used only for payments the STK Push flow cannot confirm on its own: Pochi la Biashara, and
till payments where the Daraja callback never lands.

## Requirements

- **JDK 17.** The Android Gradle Plugin 8.2 runs on 17 and publishes no Java 8 variant, so
  an older JDK fails with `No matching variant of com.android.tools.build:gradle:8.2.2`.
  Gradle 8.2 also does not support JDK 21+, so a *newer* JDK fails too — it must be 17.
- Android SDK with platform 34.

## Build

```bash
./gradlew assembleDebug      # signed with the debug key — installable directly
./gradlew assembleRelease    # unsigned; needs apksigner before it will install
```

CI builds both on every push touching this directory and attaches them to the run
(Actions → Build APK → Artifacts). The debug APK is the one to hand to a shop.

There is no `gradlew.bat`, so this cannot be built from Windows as it stands. Generate one
with `gradle wrapper` on a machine with a supported JDK.

**Do not open this project with VS Code's Java extension.** It cannot configure an Android
project and reports a spurious workspace error; `.vscode/settings.json` at the repo root
excludes it for that reason. Use Android Studio.

## Setup on the shop phone

The phone that holds the M-Pesa SIM:

1. Install the APK.
2. Open the app → **Open Notification Access Settings** → enable "Dzeline SMS Listener".
3. Fill in:
   - **Backend Webhook URL** — `https://<host>/sms/webhook`, no query string
   - **Shop API Key** — the shop's API key; the app appends it as `?key=` itself
   - **Webhook Secret** — the server's `SMS_WEBHOOK_SECRET`, if one is set
4. **Save Settings**, then **Send Test Webhook**. A 2xx means the pipeline works end to
   end; 401 means the API key or the secret is wrong.

The API key is required. Without it the backend cannot tell which shop a payment belongs
to, and it rejects the webhook rather than storing a code every shop could read.

## How it decides what to forward

A notification counts as M-Pesa if its title is "MPESA"/"M-PESA", or its body starts with
the 10-character confirmation code pattern. The body is then POSTed to `/sms/webhook`,
where it is parsed and stored per tenant.

Two limits worth knowing:

- **It cannot verify the sender.** Any app that posts a notification titled "MPESA" is
  forwarded. Reconciliation on the POS side therefore requires the amount to match too, and
  flags anything else for a person instead of clearing the sale.
- **A failed POST is not retried.** The notification fires once, so if the phone has no
  connection at that moment the confirmation is lost. For Pochi that SMS is the only
  confirmation that exists. An on-device retry queue is the open fix; see Known Issues in
  [../HANDOFF.md](../HANDOFF.md).
