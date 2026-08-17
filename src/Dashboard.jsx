import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { approveFinal, rejectRequest, issueOffline } from './api';

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString();
}

function PendingTab() {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [validityDays, setValidityDays] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'activationRequests'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status === 'pending'));
    });
  }, []);

  async function handleApprove(id) {
    setError('');
    setBusyId(id);
    try {
      await approveFinal(id, validityDays[id] ? Number(validityDays[id]) : undefined);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    setError('');
    setBusyId(id);
    try {
      await rejectRequest(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2>Pending Final Activations</h2>
      {error && <div className="error">{error}</div>}
      {requests.length === 0 && <p className="muted">No pending requests.</p>}
      <div className="card-list">
        {requests.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-row">
              <strong>{r.institutionName || '(no institution name)'}</strong>
              <span className="badge">{r.channel}</span>
            </div>
            <div className="card-grid">
              <div>Contact: {r.userName} · {r.phoneNumber} · {r.email}</div>
              <div>Address: {r.address}</div>
              <div>Machine ID: <code>{r.machineId}</code></div>
              <div>Requested: {fmtDate(r.createdAt)}</div>
              <div>App version: {r.appVersion}</div>
            </div>
            <div className="card-actions">
              <input
                type="number"
                placeholder="validity (days, optional)"
                value={validityDays[r.id] || ''}
                onChange={(e) => setValidityDays({ ...validityDays, [r.id]: e.target.value })}
              />
              <button disabled={busyId === r.id} onClick={() => handleApprove(r.id)}>
                {busyId === r.id ? 'Working…' : 'Approve (payment confirmed)'}
              </button>
              <button className="secondary" disabled={busyId === r.id} onClick={() => handleReject(r.id)}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevicesTab() {
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'devices'), orderBy('updatedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  return (
    <div>
      <h2>All Devices / Trials</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Institution</th>
            <th>Machine ID</th>
            <th>Trial ends</th>
            <th>Final status</th>
            <th>Final expiry</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>{d.institutionName}</td>
              <td><code>{d.machineId}</code></td>
              <td>{fmtDate(d.trialEndUtc)}</td>
              <td>{d.finalStatus}</td>
              <td>{fmtDate(d.finalLicenseExpiryUtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OfflineTab() {
  const [qrJson, setQrJson] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleIssue() {
    setError('');
    setResult('');
    setBusy(true);
    try {
      const data = await issueOffline(qrJson.trim(), validityDays ? Number(validityDays) : undefined);
      setResult(data.licenseKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(result);
  }

  return (
    <div>
      <h2>Offline Request Entry</h2>
      <p className="muted">
        Paste the QR/JSON content shown on the customer's "Offline Activation" tab, then issue a license key
        to read back to them or send by message.
      </p>
      <textarea
        rows={6}
        placeholder='{"i":"...","a":"...","n":"...","p":"...","e":"...","m":"...","k":"Trial","r":"...","v":"...","t":"..."}'
        value={qrJson}
        onChange={(e) => setQrJson(e.target.value)}
      />
      <div className="card-actions">
        <input
          type="number"
          placeholder="validity (days, only used for Final)"
          value={validityDays}
          onChange={(e) => setValidityDays(e.target.value)}
        />
        <button disabled={busy || !qrJson.trim()} onClick={handleIssue}>
          {busy ? 'Issuing…' : 'Decode & Issue License'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className="result-box">
          <div className="muted">License key (give this to the customer):</div>
          <textarea readOnly rows={4} value={result} />
          <button onClick={copyResult}>Copy</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState('pending');

  return (
    <div className="dashboard">
      <header className="topbar">
        <h1>SMRG License Admin</h1>
        <button className="secondary" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>
      <nav className="tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Pending Activations
        </button>
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
          All Devices
        </button>
        <button className={tab === 'offline' ? 'active' : ''} onClick={() => setTab('offline')}>
          Offline Entry
        </button>
      </nav>
      <main>
        {tab === 'pending' && <PendingTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'offline' && <OfflineTab />}
      </main>
    </div>
  );
}
