import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login.jsx';
import Dashboard from './Dashboard.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) return <div className="loading">Loading…</div>;
  return user ? <Dashboard /> : <Login />;
}
