// The desktop apps this one site serves. Both use the same licensing system (licensing.js, releases.js,
// handlers.js), but each has its OWN keys, Firestore collections, URLs and GitHub repository — so nothing of one
// works for the other: a licence signed for SMRG never verifies in the USG app and the other way round.
//
//   USG Reporting                    /usg/api/*,  /usg/activate,  collections usg*
//   SMRG (Smart Medical Report Gen.) /smrg/api/*, /smrg/activate, collections smrg*
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
};

/** Firestore collection of a product, e.g. collection(PRODUCTS.smrg, 'Devices') -> "smrgDevices". */
export const collectionName = (product, name) => `${product.collectionPrefix}${name}`;
