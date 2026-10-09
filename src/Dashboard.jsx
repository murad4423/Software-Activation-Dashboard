import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import { APPS } from './usg/apps.js';
import LicencePanel from './usg/UsgPanel.jsx';

// All three desktop apps (SMRG, USG Reporting and X-ray) use the same licence system; the switch picks the one shown.
const PRODUCTS = [APPS.smrg, APPS.usg, APPS.xray];

function readProduct() {
  try {
    const saved = localStorage.getItem('dashboard.product');
    return APPS[saved] ? saved : 'smrg';
  } catch {
    return 'smrg';
  }
}

export default function Dashboard() {
  const [product, setProduct] = useState(readProduct);
  const current = APPS[product];

  function choose(key) {
    setProduct(key);
    try {
      localStorage.setItem('dashboard.product', key);
    } catch {
      // only a convenience
    }
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{current.mark}</span>
          <div>
            <h1>License Admin</h1>
            <span className="muted small">{current.fullName} · licensing, activation &amp; updates</span>
          </div>
        </div>
        <div className="topbar-right">
          <div className="product-switch" role="tablist" aria-label="Software">
            {PRODUCTS.map((p) => (
              <button key={p.key} role="tab" aria-selected={product === p.key} className={product === p.key ? 'active' : ''} onClick={() => choose(p.key)}>
                {p.mark}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>
      <LicencePanel key={product} app={current} />
    </div>
  );
}
