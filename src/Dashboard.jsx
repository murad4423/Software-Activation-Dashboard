import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { approveFinal, rejectRequest, issueOffline } from './api';

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toDateSafe(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysLeft(ts) {
  const d = toDateSafe(ts);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Derives a single, human-readable lifecycle status for a device/trial record.
function deviceStatus(d) {
  if (d.finalStatus === 'active') {
    const left = daysLeft(d.finalLicenseExpiryUtc);
    if (left !== null && left < 0) return { key: 'final-expired', label: 'Final expired', tone: 'danger' };
    if (left !== null && left <= 7) return { key: 'final-ending', label: `Final · ${left}d left`, tone: 'warning' };
    return { key: 'final-active', label: 'Final active', tone: 'success' };
  }
  if (d.finalStatus === 'pending') return { key: 'final-pending', label: 'Final requested', tone: 'info' };
  if (d.finalStatus === 'rejected') return { key: 'final-rejected', label: 'Final rejected', tone: 'danger' };

  const left = daysLeft(d.trialEndUtc);
  if (left === null) return { key: 'unknown', label: 'Unknown', tone: 'muted' };
  if (left < 0) return { key: 'trial-expired', label: 'Trial expired', tone: 'danger' };
  if (left <= 3) return { key: 'trial-ending', label: `Trial · ${left}d left`, tone: 'warning' };
  return { key: 'trial-active', label: `Trial · ${left}d left`, tone: 'success' };
}

function StatusBadge({ status }) {
  return <span className={`status status-${status.tone}`}>{status.label}</span>;
}

function copyToClipboard(text) {
  if (text) navigator.clipboard.writeText(String(text));
}

function ShortId({ value }) {
  if (!value) return <span className="muted">—</span>;
  const short = value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  return (
    <button type="button" className="idchip" title={`Copy ${value}`} onClick={() => copyToClipboard(value)}>
      <code>{short}</code>
      <span className="idchip-copy">copy</span>
    </button>
  );
}

function StatCards({ stats }) {
  return (
    <div className="stat-grid">
      <div className="stat-card">
        <span className="stat-label">Total institutions</span>
        <span className="stat-value">{stats.total}</span>
      </div>
      <div className="stat-card stat-success">
        <span className="stat-label">Active trials</span>
        <span className="stat-value">{stats.trialActive}</span>
      </div>
      <div className="stat-card stat-info">
        <span className="stat-label">Active final licenses</span>
        <span className="stat-value">{stats.finalActive}</span>
      </div>
      <div className="stat-card stat-warning">
        <span className="stat-label">Expiring ≤ 7 days</span>
        <span className="stat-value">{stats.endingSoon}</span>
      </div>
      <div className="stat-card stat-danger">
        <span className="stat-label">Expired</span>
        <span className="stat-value">{stats.expired}</span>
      </div>
    </div>
  );
}

function exportCsv(rows) {
  const headers = [
    'institutionName', 'userName', 'phoneNumber', 'email', 'address', 'machineId',
    'appVersion', 'issuedVia', 'trialLicenseId', 'trialStartUtc', 'trialEndUtc',
    'finalStatus', 'finalLicenseExpiryUtc', 'createdAt', 'updatedAt',
  ];
  const escape = (v) => {
    if (v === undefined || v === null) return '';
    const s = v.toDate ? v.toDate().toISOString() : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smrg-devices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function PendingTab() {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [validityDays, setValidityDays] = useState({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'activationRequests'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status === 'pending'));
    });
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return requests;
    return requests.filter((r) =>
      [r.institutionName, r.userName, r.phoneNumber, r.email, r.machineId, r.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [requests, search]);

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
      <div className="section-head">
        <div>
          <h2>Pending Final Activations</h2>
          <p className="muted">Institutions waiting on payment confirmation before their final license is issued.</p>
        </div>
        <span className="count-pill">{requests.length} pending</span>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search institution, contact, phone, machine ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="error">{error}</div>}
      {filtered.length === 0 && <p className="muted empty-state">No pending requests match.</p>}

      <div className="card-list">
        {filtered.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-row">
              <strong>{r.institutionName || '(no institution name)'}</strong>
              <span className="badge">{r.channel}</span>
            </div>
            <div className="card-grid">
              <div><span className="field-label">Contact</span>{r.userName} · {r.phoneNumber} · {r.email}</div>
              <div><span className="field-label">Address</span>{r.address || '—'}</div>
              <div><span className="field-label">Machine ID</span><ShortId value={r.machineId} /></div>
              <div><span className="field-label">Requested</span>{fmtDate(r.createdAt)}</div>
              <div><span className="field-label">App version</span>{r.appVersion || '—'}</div>
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [sortKey, setSortKey] = useState('updatedAt');

  useEffect(() => {
    const q = query(collection(db, 'devices'), orderBy('updatedAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const enriched = useMemo(
    () => devices.map((d) => ({ ...d, _status: deviceStatus(d) })),
    [devices]
  );

  const stats = useMemo(() => {
    const s = { total: enriched.length, trialActive: 0, finalActive: 0, endingSoon: 0, expired: 0 };
    for (const d of enriched) {
      if (d._status.key === 'trial-active') s.trialActive += 1;
      if (d._status.key.startsWith('final-active') || d._status.key === 'final-active') s.finalActive += 1;
      if (d._status.key === 'trial-ending' || d._status.key === 'final-ending') s.endingSoon += 1;
      if (d._status.key === 'trial-expired' || d._status.key === 'final-expired') s.expired += 1;
    }
    return s;
  }, [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((d) =>
        [d.institutionName, d.userName, d.phoneNumber, d.email, d.machineId, d.address]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s))
      );
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((d) => d._status.key.startsWith(statusFilter));
    }
    const withTime = (v) => toDateSafe(v)?.getTime() ?? 0;
    return [...rows].sort((a, b) => {
      if (sortKey === 'institutionName') return (a.institutionName || '').localeCompare(b.institutionName || '');
      return withTime(b[sortKey]) - withTime(a[sortKey]);
    });
  }, [enriched, search, statusFilter, sortKey]);

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>All Institutions / Devices</h2>
          <p className="muted">Every trial and final license issued, with full registration details.</p>
        </div>
        <button className="secondary" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
          Export CSV
        </button>
      </div>

      <StatCards stats={stats} />

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search institution, contact, phone, machine ID, address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="trial-active">Trial active</option>
          <option value="trial-ending">Trial ending soon</option>
          <option value="trial-expired">Trial expired</option>
          <option value="final-active">Final active</option>
          <option value="final-ending">Final ending soon</option>
          <option value="final-expired">Final expired</option>
          <option value="final-pending">Final requested</option>
          <option value="final-rejected">Final rejected</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          <option value="updatedAt">Sort: recently updated</option>
          <option value="createdAt">Sort: recently created</option>
          <option value="institutionName">Sort: institution name</option>
          <option value="trialEndUtc">Sort: trial end date</option>
        </select>
      </div>

      <p className="muted result-count">{filtered.length} of {devices.length} shown</p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Institution</th>
              <th>Contact</th>
              <th>Machine ID</th>
              <th>Status</th>
              <th>Trial period</th>
              <th>Final expiry</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const isOpen = expandedId === d.id;
              return (
                <React.Fragment key={d.id}>
                  <tr className="table-row-clickable" onClick={() => setExpandedId(isOpen ? null : d.id)}>
                    <td className="expand-cell">
                      <span className={`chevron ${isOpen ? 'chevron-open' : ''}`}>▸</span>
                    </td>
                    <td>
                      <div className="institution-cell">
                        <strong>{d.institutionName || '—'}</strong>
                        <span className="muted small">{d.address || 'No address on file'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <span>{d.userName || '—'}</span>
                        <span className="muted small">{d.phoneNumber || '—'}</span>
                      </div>
                    </td>
                    <td><ShortId value={d.machineId} /></td>
                    <td><StatusBadge status={d._status} /></td>
                    <td className="small">{fmtDate(d.trialStartUtc)} → {fmtDate(d.trialEndUtc)}</td>
                    <td className="small">{fmtDate(d.finalLicenseExpiryUtc)}</td>
                    <td className="small">{fmtDate(d.updatedAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        <div className="detail-panel">
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Email</span>{d.email || '—'}</div>
                            <div className="detail-item"><span className="field-label">Phone</span>{d.phoneNumber || '—'}</div>
                            <div className="detail-item"><span className="field-label">Address</span>{d.address || '—'}</div>
                            <div className="detail-item"><span className="field-label">App version</span>{d.appVersion || '—'}</div>
                          </div>
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Machine ID</span><code className="wrap">{d.machineId || '—'}</code></div>
                            <div className="detail-item"><span className="field-label">Trial license ID</span><code className="wrap">{d.trialLicenseId || '—'}</code></div>
                            <div className="detail-item"><span className="field-label">Issued via</span>{d.issuedVia || '—'}</div>
                            <div className="detail-item"><span className="field-label">Final status</span>{d.finalStatus || '—'}</div>
                          </div>
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Trial start</span>{fmtDate(d.trialStartUtc)}</div>
                            <div className="detail-item"><span className="field-label">Trial end</span>{fmtDate(d.trialEndUtc)}</div>
                            <div className="detail-item"><span className="field-label">Created</span>{fmtDate(d.createdAt)}</div>
                            <div className="detail-item"><span className="field-label">Last updated</span>{fmtDate(d.updatedAt)}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">No devices match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    copyToClipboard(result);
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Offline Request Entry</h2>
          <p className="muted">
            Paste the QR/JSON content shown on the customer's "Offline Activation" tab, then issue a license key
            to read back to them or send by message.
          </p>
        </div>
      </div>
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

// Small live counter shown in the top nav for pending activations, so the
// admin can see at a glance whether anything needs attention without
// switching tabs.
function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const q = query(collection(db, 'activationRequests'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setCount(snap.docs.filter((d) => d.data().status === 'pending').length);
    });
  }, []);
  return count;
}

export default function Dashboard() {
  const [tab, setTab] = useState('pending');
  const pendingCount = usePendingCount();

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SMRG</span>
          <div>
            <h1>License Admin</h1>
            <span className="muted small">Hospital licensing &amp; activation control panel</span>
          </div>
        </div>
        <button className="secondary" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>
      <nav className="tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Pending Activations
          {pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}
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
