# SMRG License Admin Dashboard

Netlify Functions backend + React admin dashboard for the SMRG trial/final licensing
system. Matches the contract already compiled into `SMRG.Security.Licensing`
(`ActivationApiClient.cs`, `LicenseValidator.cs`, `QrCodeHelper.cs`) exactly — you
should not need to touch the C# app except to set the server URL once (Step 6).

## What's in here

```
netlify/functions/
  activate-trial.js            -> /activateTrial            (client, public)
  request-final-activation.js  -> /requestFinalActivation    (client, public)
  check-final-activation.js    -> /checkFinalActivation      (client, public)
  admin-approve-final.js       (dashboard only, requires admin login)
  admin-reject.js              (dashboard only)
  admin-issue-offline.js       (dashboard only - the "paste QR JSON" flow)
  _shared/license.js           RSA signing, byte-exact match to LicenseValidator.cs
  _shared/firebaseAdmin.js     Firebase Admin SDK init from env var
  _shared/adminAuth.js         verifies dashboard login before admin actions
src/                           React dashboard (Vite)
firestore.rules                only your admin account can read Firestore directly
netlify.toml                   redirects + build config
```

## 1. The one thing I could not do for you: the RSA private key

`LicenseValidator.cs` already ships with a **public** key hardcoded in the compiled
app. For signatures to verify, the server must sign with the **exact matching
private key** — I can't generate a new one, because that would make every license
this backend issues fail validation in the app you already built.

**Do you still have that private key PEM file** (generated earlier when the public
key was created)? If yes: don't paste it into this chat — go straight to step 4
below and put it into Netlify's environment variables yourself.

If it's lost, the only fix is generating a new key pair and updating
`PublicKeyPem` in `LicenseValidator.cs`, then rebuilding/redistributing the app. Let
me know if that's the situation and I'll generate a fresh pair + give you the exact
one-line code change.

## 2. Firebase setup

Project ID (from the service-account filename you shared earlier):
**`sshl-monitoring-system`** — confirm this is still the right project.

In the Firebase Console for that project:

1. **Authentication → Sign-in method** → enable **Email/Password**.
2. **Authentication → Users** → add a user with email
   `mdmuradsorkar26@gmail.com` and a password you choose (this is your dashboard
   login).
3. **Project settings → General → Your apps** → if there's no Web app yet, add one
   (</> icon). Copy the `firebaseConfig` object shown — you'll need these values in
   step 4 (`VITE_FIREBASE_*`). These are public identifiers, not secrets.
4. **Project settings → Service accounts** → if you don't already have the service
   account JSON saved somewhere safe, click **Generate new private key** to get a
   fresh one (the old one you showed me earlier is fine to reuse if you still have
   the file — treat it as compromised if it was ever pasted anywhere outside a
   secrets manager, and regenerate if unsure).
5. Deploy `firestore.rules` from this repo (Firebase Console → Firestore →
   Rules → paste the contents of `firestore.rules` → Publish). This is what
   restricts direct dashboard reads to your one admin email.

## 3. Netlify site

You said you'll add this as a subdomain on your existing Netlify account — that
works fine as long as it's a **separate site** (separate `netlify.toml`/build),
which this project already is. Point that new site at this project's folder/repo.

## 4. Netlify environment variables

Site settings → Environment variables → add:

| Key | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | base64 of the full service-account JSON file |
| `LICENSE_PRIVATE_KEY` | base64 of the RSA private key PEM (matching the public key in `LicenseValidator.cs`) |
| `ADMIN_EMAIL` | `mdmuradsorkar26@gmail.com` |
| `FINAL_LICENSE_VALIDITY_DAYS` | optional, defaults to `3650` (~10 years) if unset — set this to whatever your actual paid-license term is |
| `VITE_FIREBASE_API_KEY` | from step 2.3 |
| `VITE_FIREBASE_AUTH_DOMAIN` | from step 2.3 |
| `VITE_FIREBASE_PROJECT_ID` | from step 2.3 |
| `VITE_FIREBASE_STORAGE_BUCKET` | from step 2.3 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from step 2.3 |
| `VITE_FIREBASE_APP_ID` | from step 2.3 |

To base64-encode a file:

```bash
# Linux/macOS
base64 -w0 service-account.json

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
```

Same for the private key `.pem` file. Never commit either raw file, and never paste
their contents into a chat — only into Netlify's env var fields.

## 5. Deploy

```bash
npm install
npm run build   # sanity-check the frontend builds locally
```

Then push to the repo Netlify is watching (or connect this folder directly). Netlify
runs `npm run build`, publishes `dist/`, and deploys everything under
`netlify/functions/` automatically per `netlify.toml`.

## 6. Point the C# app at the deployed URL

In `ActivationApiClient.cs`:

```csharp
private const string BaseUrl = "https://REPLACE_WITH_CLOUD_FUNCTIONS_URL";
```

Change it to your deployed site's base URL, e.g.
`https://smrg-license.yourdomain.com` (no trailing slash) — the redirects in
`netlify.toml` make `/activateTrial`, `/requestFinalActivation`, and
`/checkFinalActivation` resolve correctly from there. Rebuild the app once with this
change.

## 7. Test it

- Online trial: run the app, "Apply for Activate" on the Online tab → should get a
  license key back immediately.
- Same machine again: should be rejected ("already used its trial").
- Offline: generate the QR/JSON on the app's Offline tab, paste that JSON string into
  the dashboard's **Offline Entry** tab, issue a license, paste it back into the app.
- Final/paid: request final activation → shows up under **Pending Activations** in
  the dashboard → Approve → app's "Check Activation Status" picks up the license.

## Design notes / things you may want to change

- **Final license validity** defaults to 10 years (`FINAL_LICENSE_VALIDITY_DAYS`).
  If your paid license is meant to be a yearly subscription rather than
  effectively-perpetual, lower this (e.g. `365`) or set it per-approval from the
  dashboard's "validity (days)" field.
- **Trial duration** is 30 days, matching `LicenseManager.TrialDurationDays` in the
  C# app — kept as a constant in `activate-trial.js` and
  `admin-issue-offline.js`, change both if you ever change the client constant.
- Abuse prevention is keyed purely on machine fingerprint (`devices/{machineId}`
  doc existing with a `trialLicenseId`). Institution/email/phone duplicate-checking
  (mentioned as a "could also do this" in the original plan) isn't implemented —
  say the word if you want one hospital blocked from requesting multiple trials
  under different machines too.
