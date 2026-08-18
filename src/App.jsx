import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';
import ActivatePage from './ActivatePage.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  // Public, no-login route: opens when a customer scans the Offline-Activation QR
  // code with their phone. Must be checked BEFORE the auth gate below, since the
  // person scanning this has no admin account and should never see the Login screen.
  const isActivateRoute = window.location.pathname.startsWith('/activate');

  useEffect(() => {
    if (!isActivateRoute) return onAuthStateChanged(auth, setUser);
  }, [isActivateRoute]);

  if (isActivateRoute) return <ActivatePage />;

  if (user === undefined) return <div className="loading">Loading…</div>;
  return user ? <Dashboard /> : <Login />;
}
