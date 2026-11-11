import { createContext, useContext } from 'react';

// The desktop apps the dashboard manages (SmartMed Opti Report = key "smrg", kept for URLs and collections). They all use the same licence system (netlify/functions/_shared), each with its
// own Firestore collections (<key>Devices, <key>Events, ...), admin function (<key>-admin) and public /<key>/activate page.
export const APPS = {
  smrg: {
    key: 'smrg',
    mark: 'OPTI',
    name: 'SmartMed Opti Report',
    fullName: 'SmartMed Opti Report',
    resetFlag: '--smrg-dev-license-reset',
    licenceFileExtension: 'smrglicense',
  },
  usg: {
    key: 'usg',
    mark: 'USG',
    name: 'USG Reporting',
    fullName: 'USG Reporting',
    resetFlag: '--usg-dev-license-reset',
    licenceFileExtension: 'usglicense',
  },
  xray: {
    key: 'xray',
    mark: 'XRAY',
    name: 'SmartMed X-ray Report',
    fullName: 'SmartMed X-ray Report',
    resetFlag: '--xray-dev-license-reset',
    licenceFileExtension: 'xraylicense',
  },
  displayhub: {
    key: 'displayhub',
    mark: 'HUB',
    name: 'SmartMed Display Hub',
    fullName: 'SmartMed Display Hub',
    resetFlag: '--displayhub-dev-license-reset',
    licenceFileExtension: 'dhublicense',
  },
  // The Android TV app. It is not licensed and never activates — the Hub drives it on the hospital LAN — so this
  // panel shows only Updates and the list of TVs. Its records are created by the TVs' own update checks.
  displayhubtv: {
    key: 'displayhubtv',
    mark: 'TV',
    name: 'SmartMed Display Hub TV',
    fullName: 'SmartMed Display Hub TV (Android TV app)',
    updatesOnly: true,
  },
};

/** The app the current panel shows (set by LicencePanel). */
export const AppContext = createContext(APPS.usg);
export const useApp = () => useContext(AppContext);
