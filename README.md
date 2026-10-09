# License Admin Dashboard (SMRG + USG Reporting + X-ray)

Netlify Functions backend + React admin dashboard for three desktop apps that use the same licence system:

| App | Addresses | Firestore | App repository |
|---|---|---|---|
| **SmartMed Opti Report** (SMRG, by SmartMed) | `/smrg/api/*`, `/smrg/activate` | `smrg*` | `Smart-Medical-Report-Generator-Main-code` |
| **USG Reporting** | `/usg/api/*`, `/usg/activate` | `usg*` | `usg-reporting-main-code` |
| **SmartMed X-ray Report** | `/xray/api/*`, `/xray/activate` | `xray*` | `SmartMed-X-Ray-Repoting-main-code` |

Each app has its own licence key, update-signing key, collections and GitHub releases, so a licence for one never
works in another. The dashboard's **OPTI | USG | XRAY** switch
picks the app; all of them get the same tabs: Hospitals / PCs
(renew +N months, exact end date, suspend, notes, test PC, licence code, forget PC), Reset requests, Updates
(signed releases, "Release to all", pause), Activity and Settings (trial length).

Contract with each app: `docs/LICENSE_SERVER_API.md` in that app's repository.

## Code

```
netlify/functions/
  _shared/products.js     the three apps: keys (public), issuer, code prefix, collections, GitHub env names
  _shared/licensing.js    token + activation code signing, device records, rate limits
  _shared/releases.js     reads + verifies signed releases on GitHub
  _shared/handlers.js     every endpoint, written once (activate, sync, offline-activate, update, download,
                          dev-reset-request, not-found, admin)
  smrg-*.js, usg-*.js,
  xray-*.js               one line each: <handler>(PRODUCTS.<app>)
  _shared/firebaseAdmin.js, adminAuth.js
src/
  Dashboard.jsx           SMRG | USG | XRAY switch
  usg/UsgPanel.jsx        the panel (used for every app, see usg/apps.js)
  usg/UsgActivatePage.jsx public phone page /<app>/activate (from the app's QR code)
netlify.toml              routes for /smrg/, /usg/ and /xray/
firestore.rules           only the admin account can read Firestore directly; all writes go through functions
```

## Firebase

Project `sshl-monitoring-system`. Authentication: Email/Password, one user `mdmuradsorkar26@gmail.com` (dashboard
login). Deploy `firestore.rules` (Firestore → Rules). Optional: TTL policy on `usgRateLimits.expiresAt` (all rate-limit
counters, every app, live there).

## Netlify environment variables

| Key | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | base64 of the service-account JSON |
| `ADMIN_EMAIL` | `mdmuradsorkar26@gmail.com` |
| `VITE_FIREBASE_*` | the web app's firebaseConfig (public identifiers) |
| `SMRG_LICENSE_PRIVATE_KEY` | text of `Documents\SMRG-License-Keys\license-private-key.pem` (secret) |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` / `GITHUB_TOKEN` | SMRG releases repo + fine-grained token ("Contents: Read-only" on that repo) |
| `USG_LICENSE_PRIVATE_KEY` | text of `Documents\USG-License-Keys\license-private-key.pem` (secret) |
| `USG_GITHUB_OWNER` / `USG_GITHUB_REPO` / `USG_GITHUB_TOKEN` | USG releases repo + token |
| `XRAY_LICENSE_PRIVATE_KEY` | text of `Documents\XRAY-License-Keys\license-private-key.pem` (secret) |
| `XRAY_GITHUB_OWNER` / `XRAY_GITHUB_REPO` / `XRAY_GITHUB_TOKEN` | `murad4423` / `SmartMed-X-Ray-Repoting-main-code` + token |

The server checks each licence key against the app's public key and says exactly what is wrong if a key is missing,
public, or the other app's. The **update-signing** private keys are NOT put into Netlify — they stay on the developer PC.

## Deploy

Pushing to `main` deploys to production (Netlify builds `npm run build` and the functions). If a deploy breaks the
site: Netlify → Deploys → the previous good deploy → **Publish deploy**.
