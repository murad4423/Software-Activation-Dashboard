// The desktop apps this one site serves. They all use the same licensing system (licensing.js, releases.js,
// handlers.js), but each has its own Firestore collections, URLs, GitHub repository, issuer and code prefix — so
// nothing of one works for another: a licence signed for SMRG never verifies in the USG app and the other way round.
//
//   USG Reporting                    /usg/api/*,  /usg/activate,  collections usg*
//   SMRG (Smart Medical Report Gen.) /smrg/api/*, /smrg/activate, collections smrg*
//   SmartMed X-ray Report            /xray/api/*, /xray/activate, collections xray*
//
// SMRG has its own key pair. X-ray was built from the USG app and still carries the SAME licence and update-signing
// public keys, so XRAY_LICENSE_PRIVATE_KEY is the same PEM as USG_LICENSE_PRIVATE_KEY (and the same key signs both
// update packages). The products stay apart anyway: "iss"/code prefix are inside what the licence signature covers
// (usg-license/USG1 vs xray-license/XRAY1), and so is the update prefix (USGUPD1 vs XRAYUPD1) — a USG licence or
// package is refused by the X-ray app and the other way round. Giving X-ray its own key pair means a new app build.
//
// The USG values below are exactly what the USG app was built against — do not change them.

export const PRODUCTS = {
  usg: {
    id: 'usg',
    name: 'USG Reporting',
    // Licence token "iss" claim and the typed activation code's prefix (also part of what the code's signature covers).
    issuer: 'usg-license',
    codePrefix: 'USG1',
    // Firestore: usgDevices, usgEvents, usgConfig, usgResetRequests, usgDeletedDevices.
    collectionPrefix: 'usg',
    // Rate-limit counter keys (all products share the usgRateLimits collection). Empty = USG's keys as before.
    rateLimitPrefix: '',
    licenceKeyEnv: 'USG_LICENSE_PRIVATE_KEY',
    licenceKeyHelp: 'Put the full text of license-private-key.pem (USG-License-Keys folder) into USG_LICENSE_PRIVATE_KEY, then redeploy.',
    /** Same as LicenseToken.PublicKeySpki in the USG app: the licence private key must belong to it. */
    licencePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEitG5I1SHusf8B5On58jF45CY5EMVPZAq1dRww3qg3WSJivyCc5/TrIp7J4iETiWXlZyc/yg2beQtVFFsJszQEg==',
    /** Same as UpdateSignature.PublicKeySpki in the USG app. */
    updatePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErcZN7PxFoA8+U+tSb98Ff9EPIc+RuJULYu0gBvDRDeGDnAXTlW+IvGGz60CNiWUm0i1eF0GRR782f8VLPUOIqQ==',
    updateMessagePrefix: 'USGUPD1',
    updateManifestFormat: 'usg-update-1',
    // The update package attached to each GitHub release (with "<name>.sig" next to it).
    packageExtension: '.zip',
    signTool: 'tools/sign-update.mjs',
    github: { ownerEnv: 'USG_GITHUB_OWNER', repoEnv: 'USG_GITHUB_REPO', tokenEnv: 'USG_GITHUB_TOKEN' },
    userAgent: 'usg-update-server',
  },

  smrg: {
    id: 'smrg',
    name: 'SmartMed Opti Report',
    issuer: 'smrg-license',
    codePrefix: 'SMRG1',
    collectionPrefix: 'smrg',
    rateLimitPrefix: 'smrg:',
    licenceKeyEnv: 'SMRG_LICENSE_PRIVATE_KEY',
    licenceKeyHelp: 'Put the full text of license-private-key.pem (SMRG-License-Keys folder) into SMRG_LICENSE_PRIVATE_KEY, then redeploy.',
    /** Same as LicenseToken.PublicKeySpki in the SMRG app. */
    licencePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAjKj9syL8Ts6tEncfGbo/gW8J1fZuBrIXaVFVK6J7S/LLnOHMJ0Ubp5vPzaxrrtrSngXwst2NQPWlYbjoLx/vg==',
    /** Same as UpdateSignature.PublicKeySpki in the SMRG app. */
    updatePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJtRs9O5UiycpklcZCTGKCPIJGkILDrASHYnRBRqp1qhW4eq1i4/iX6aVC6oZk0XDMu16S5noJKVDGNeHU6/zTQ==',
    updateMessagePrefix: 'SMRGUPD1',
    updateManifestFormat: 'smrg-update-1',
    // SMRG updates by running its installer (SMRG_Setup_v<version>.exe + .exe.sig).
    packageExtension: '.exe',
    signTool: 'scripts/sign-update.mjs',
    github: { ownerEnv: 'GITHUB_REPO_OWNER', repoEnv: 'GITHUB_REPO_NAME', tokenEnv: 'GITHUB_TOKEN' },
    userAgent: 'smrg-update-server',
  },
  xray: {
    id: 'xray',
    name: 'SmartMed X-ray Report',
    issuer: 'xray-license',
    codePrefix: 'XRAY1',
    // Firestore: xrayDevices, xrayEvents, xrayConfig, xrayResetRequests, xrayDeletedDevices.
    collectionPrefix: 'xray',
    rateLimitPrefix: 'xray:',
    licenceKeyEnv: 'XRAY_LICENSE_PRIVATE_KEY',
    licenceKeyHelp: 'Put the full text of license-private-key.pem (USG-License-Keys folder — the X-ray app uses the same licence key) into XRAY_LICENSE_PRIVATE_KEY, then redeploy.',
    /** Same as LicenseToken.PublicKeySpki in the X-ray app (today the same key pair as USG — see the note above). */
    licencePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEitG5I1SHusf8B5On58jF45CY5EMVPZAq1dRww3qg3WSJivyCc5/TrIp7J4iETiWXlZyc/yg2beQtVFFsJszQEg==',
    /** Same as UpdateSignature.PublicKeySpki in the X-ray app. */
    updatePublicKey:
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErcZN7PxFoA8+U+tSb98Ff9EPIc+RuJULYu0gBvDRDeGDnAXTlW+IvGGz60CNiWUm0i1eF0GRR782f8VLPUOIqQ==',
    updateMessagePrefix: 'XRAYUPD1',
    updateManifestFormat: 'xray-update-1',
    // SmartMed-XRay-Report-<version>.zip + .zip.sig on each release.
    packageExtension: '.zip',
    signTool: 'tools/sign-update.mjs',
    github: { ownerEnv: 'XRAY_GITHUB_OWNER', repoEnv: 'XRAY_GITHUB_REPO', tokenEnv: 'XRAY_GITHUB_TOKEN' },
    userAgent: 'xray-update-server',
  },
};

/** Firestore collection of a product, e.g. collection(PRODUCTS.smrg, 'Devices') -> "smrgDevices". */
export const collectionName = (product, name) => `${product.collectionPrefix}${name}`;
