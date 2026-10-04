import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import UsgActivatePage from './usg/UsgActivatePage.jsx';
import { APPS } from './usg/apps.js';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  // Public, no-login routes: open when a customer scans an Offline-Activation QR code with their phone. Must be
  // checked BEFORE the auth gate below, since the person scanning this has no admin account.
  //   /smrg/activate?r=...   SMRG app
  //   /usg/activate?r=...    USG Reporting app
  const activateApp = Object.values(APPS).find((app) => window.location.pathname.startsWith(`/${app.key}/activate`));

  useEffect(() => {
    if (!activateApp) return onAuthStateChanged(auth, setUser);
  }, [activateApp]);

  if (activateApp) return <UsgActivatePage app={activateApp} />;

  if (user === undefined) return <div className="loading">Loading…</div>;
  return user ? <Dashboard /> : <Login />;
}
