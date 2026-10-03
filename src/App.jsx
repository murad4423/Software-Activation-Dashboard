import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import ActivatePage from './ActivatePage.jsx';
import UsgActivatePage from './usg/UsgActivatePage.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  // Public, no-login routes: open when a customer scans an Offline-Activation QR
  // code with their phone. Must be checked BEFORE the auth gate below, since the
  // person scanning this has no admin account and should never see the Login screen.
  //   /activate?req=...     SMRG app (old software)
  //   /usg/activate?r=...   USG Reporting app (new software)
  const isUsgActivateRoute = window.location.pathname.startsWith('/usg/activate');
  const isActivateRoute = window.location.pathname.startsWith('/activate');

  useEffect(() => {
    if (!isActivateRoute && !isUsgActivateRoute) return onAuthStateChanged(auth, setUser);
  }, [isActivateRoute, isUsgActivateRoute]);

  if (isUsgActivateRoute) return <UsgActivatePage />;
  if (isActivateRoute) return <ActivatePage />;

  if (user === undefined) return <div className="loading">Loading…</div>;
  return user ? <Dashboard /> : <Login />;
}
