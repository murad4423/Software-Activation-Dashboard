import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { usgAdmin } from '../api';
import { EVENT_TEXT, daysLeft, fmtDate, pcDisplayId, toDate, usgStatus } from './usgFormat.js';

// USG Reporting app (new software). Reads Firestore directly (admin-only rules), changes everything through the
// usg-admin function. Collections: usgDevices, usgResetRequests, usgEvents, usgConfig.

function useCollection(path, ...constraints) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const q = query(collection(db, path), ...constraints);
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return rows;
}

function useDoc(path, id) {
  const [data, setData] = useState(undefined);
  useEffect(() => onSnapshot(doc(db, path, id), (snap) => setData(snap.exists() ? snap.data() : null), () => setData(null)), [path, id]);
  return data;
}

function StatusBadge({ status }) {
  return <span className={`status status-${status.tone}`}>{status.label}</span>;
}

function CopyChip({ value, label }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <button type="button" className="idchip" title={`Copy ${value}`} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(value)); }}>
      <code>{label || value}</code>
      <span className="idchip-copy">copy</span>
    </button>
  );
}

function exportCsv(rows) {
  const columns = [
    ['hospitalId', (d) => d.hospitalId],
    ['hospitalName', (d) => d.hospitalName],
    ['phone', (d) => d.hospital?.phone],
    ['email', (d) => d.hospital?.email],
    ['contactPerson', (d) => d.hospital?.contactPerson],
    ['address', (d) => d.hospital?.address],
    ['city', (d) => d.hospital?.city],
    ['status', (d) => usgStatus(d).label],
    ['plan', (d) => d.plan],
    ['endAt', (d) => toDate(d.endAt)?.toISOString()],
    ['trialStartAt', (d) => toDate(d.trialStartAt)?.toISOString()],
    ['pcId', (d) => pcDisplayId(d.fingerprint)],
    ['fingerprint', (d) => d.fingerprint],
    ['machineName', (d) => d.machineName],
    ['appVersion', (d) => d.appVersion],
    ['lastSyncAt', (d) => toDate(d.lastSyncAt)?.toISOString()],
    ['note', (d) => d.note],
  ];
  const escape = (v) => (v === undefined || v === null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [columns.map((c) => c[0]).join(','), ...rows.map((r) => columns.map((c) => escape(c[1](r))).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `usg-devices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ----- one device: actions + history -----

function DeviceActions({ device }) {
  const fp = device.fingerprint;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [months, setMonths] = useState('');
  const [amount, setAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [endDate, setEndDate] = useState(() => toDate(device.endAt)?.toISOString().slice(0, 10) || '');
  const [note, setNote] = useState(device.note || '');
  const [licence, setLicence] = useState(null);
  const events = useCollection('usgEvents', where('fingerprint', '==', fp), limit(100));

  // Keep the inputs in step with the live record (e.g. after a renewal changed the end date).
  const endIso = toDate(device.endAt)?.toISOString().slice(0, 10) || '';
  useEffect(() => setEndDate(endIso), [endIso]);
  useEffect(() => setNote(device.note || ''), [device.note]);

  async function run(name, action, fields, done) {
    setBusy(name);
    setError('');
    setInfo('');
    try {
      const result = await usgAdmin(action, { fingerprint: fp, ...fields });
      if (done) done(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function renew(n) {
    const label = n === 12 ? '1 year' : `${n} month${n > 1 ? 's' : ''}`;
    if (!window.confirm(`Renew ${device.hospitalName || 'this PC'} for ${label}?`)) return;
    run(`renew${n}`, 'renew', { months: n, amount, note: payNote }, (r) => {
      setInfo(`Renewed until ${fmtDate(r.endAt)}. The PC picks it up at its next sync (within 12 hours when online, or "Check for renewal").`);
      setMonths('');
      setAmount('');
      setPayNote('');
    });
  }

  const sortedEvents = useMemo(
    () => (events || []).slice().sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0)),
    [events]
  );

  return (
    <div className="usg-actions">
      {error && <div className="error">{error}</div>}
      {info && <div className="usg-info">{info}</div>}

      <div className="usg-action-group">
        <span className="field-label">Renew subscription</span>
        <div className="card-actions">
          <button disabled={!!busy} onClick={() => renew(1)}>{busy === 'renew1' ? 'Working…' : '+1 month'}</button>
          <button disabled={!!busy} onClick={() => renew(12)}>{busy === 'renew12' ? 'Working…' : '+1 year'}</button>
          <input className="usg-narrow" type="number" min="1" max="60" placeholder="months" value={months} onChange={(e) => setMonths(e.target.value)} />
          <button className="secondary" disabled={!!busy || !(Number(months) >= 1)} onClick={() => renew(Number(months))}>+ months</button>
          <input className="usg-mid" placeholder="amount (optional)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="usg-wide" placeholder="payment note, e.g. bKash TrxID (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
        </div>
        <span className="muted small">Adds calendar months from the current end date (or from today if it has already ended). 12 months = yearly plan.</span>
      </div>

      <div className="usg-action-row">
        <div className="usg-action-group">
          <span className="field-label">Set exact end date</span>
          <div className="card-actions">
            <input className="usg-mid" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <button className="secondary" disabled={!!busy || !endDate} onClick={() => {
              if (window.confirm(`Set the licence end to ${endDate} (end of that day, UTC)?`)) {
                run('end', 'setEnd', { endDate: `${endDate}T23:59:59Z` }, () => setInfo('End date saved.'));
              }
            }}>Save date</button>
          </div>
        </div>

        <div className="usg-action-group">
          <span className="field-label">Access</span>
          <div className="card-actions">
            {device.status === 'suspended' ? (
              <button disabled={!!busy} onClick={() => run('unsuspend', 'unsuspend', {}, () => setInfo('Suspension lifted.'))}>Lift suspension</button>
            ) : (
              <button className="danger" disabled={!!busy} onClick={() => {
                const reason = window.prompt('Suspend this PC? It locks at its next sync. Reason (optional):', '');
                if (reason !== null) run('suspend', 'suspend', { reason }, () => setInfo('Suspended. The PC locks at its next sync.'));
              }}>Suspend</button>
            )}
            <label className="usg-check">
              <input type="checkbox" checked={device.testDevice === true} disabled={!!busy} onChange={(e) => run('test', 'setTestDevice', { value: e.target.checked })} />
              Test PC (gets new versions first)
            </label>
          </div>
        </div>
      </div>

      <div className="usg-action-group">
        <span className="field-label">Licence for this PC (to read out on the phone)</span>
        <div className="card-actions">
          <button className="secondary" disabled={!!busy} onClick={() => run('licence', 'licence', {}, (r) => setLicence(r))}>
            {busy === 'licence' ? 'Working…' : 'Show activation code'}
          </button>
          {licence && <CopyChip value={licence.code} />}
          {licence && <CopyChip value={licence.token} label="licence token" />}
        </div>
      </div>

      <div className="usg-action-group">
        <span className="field-label">Note (only you see this)</span>
        <div className="card-actions">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="secondary" disabled={!!busy || note === (device.note || '')} onClick={() => run('note', 'setNote', { note }, () => setInfo('Note saved.'))}>Save note</button>
        </div>
      </div>

      <div className="usg-action-group">
        <span className="field-label">History</span>
        {sortedEvents.length === 0 ? <span className="muted small">No events yet.</span> : (
          <ul className="usg-history">
            {sortedEvents.map((e) => (
              <li key={e.id}>
                <span className="muted small">{fmtDate(e.at, true)}</span> {EVENT_TEXT[e.type] || e.type}
                {e.type === 'renewed' && ` · ${e.months} month(s) → ${fmtDate(e.to)}`}
                {e.amount ? ` · ${e.amount}` : ''}
                {e.note ? ` · ${e.note}` : ''}
                {e.reason ? ` · ${e.reason}` : ''}
                {e.via ? ` · ${e.via}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="usg-action-group usg-danger-zone">
        <span className="field-label">Reset this PC</span>
        <div className="card-actions">
          <button className="danger" disabled={!!busy} onClick={() => {
            if (window.confirm(`Forget this PC (${device.hospitalName || pcDisplayId(fp)})?\n\nIts next activation starts a NEW free trial. A copy of the record is kept in usgDeletedDevices.`)) {
              run('delete', 'deleteDevice');
            }
          }}>Reset (forget PC)</button>
          <span className="muted small">Only for a PC that should start over (e.g. testing). Normally use Suspend.</span>
        </div>
      </div>
    </div>
  );
}

// ----- tabs -----

function DevicesTab({ devices }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('endAt');
  const [openId, setOpenId] = useState(null);

  const enriched = useMemo(() => (devices || []).map((d) => ({ ...d, _status: usgStatus(d) })), [devices]);

  const stats = useMemo(() => {
    const s = { total: enriched.length, trial: 0, paid: 0, ending: 0, expired: 0 };
    for (const d of enriched) {
      const k = d._status.key;
      if (k === 'trial-active' || k === 'trial-ending') s.trial += 1;
      if (k === 'paid-active' || k === 'paid-ending') s.paid += 1;
      if (k.endsWith('-ending')) s.ending += 1;
      if (k.endsWith('-expired') || k === 'suspended') s.expired += 1;
    }
    return s;
  }, [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((d) =>
        [d.hospitalName, d.hospital?.phone, d.hospital?.email, d.hospital?.contactPerson, d.hospital?.address, d.hospital?.city, d.fingerprint, pcDisplayId(d.fingerprint), d.machineName, String(d.hospitalId), d.note]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s))
      );
    }
    if (statusFilter !== 'all') rows = rows.filter((d) => d._status.key.includes(statusFilter));
    const time = (v) => toDate(v)?.getTime() ?? 0;
    return [...rows].sort((a, b) => {
      if (sortKey === 'hospitalName') return (a.hospitalName || '').localeCompare(b.hospitalName || '');
      if (sortKey === 'endAt') return time(a.endAt) - time(b.endAt);
      return time(b[sortKey]) - time(a[sortKey]);
    });
  }, [enriched, search, statusFilter, sortKey]);

  if (devices === null) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>USG Reporting: Hospitals / PCs</h2>
          <p className="muted">One row per PC. Renewals and suspensions reach the PC at its next sync (every 12 hours when online).</p>
        </div>
        <button className="secondary" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>Export CSV</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">Total PCs</span><span className="stat-value">{stats.total}</span></div>
        <div className="stat-card stat-info"><span className="stat-label">On trial</span><span className="stat-value">{stats.trial}</span></div>
        <div className="stat-card stat-success"><span className="stat-label">Paid &amp; active</span><span className="stat-value">{stats.paid}</span></div>
        <div className="stat-card stat-warning"><span className="stat-label">Ending ≤ 7 days</span><span className="stat-value">{stats.ending}</span></div>
        <div className="stat-card stat-danger"><span className="stat-label">Expired / suspended</span><span className="stat-value">{stats.expired}</span></div>
      </div>

      <div className="toolbar">
        <input className="search-input" type="search" placeholder="Search hospital, phone, email, PC ID, hospital ID, note…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="trial-">Trial</option>
          <option value="paid-">Paid</option>
          <option value="-ending">Ending soon</option>
          <option value="-expired">Expired</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          <option value="endAt">Sort: ends first</option>
          <option value="createdAt">Sort: newest</option>
          <option value="lastSyncAt">Sort: last seen online</option>
          <option value="hospitalName">Sort: hospital name</option>
        </select>
      </div>

      <p className="muted result-count">{filtered.length} of {enriched.length} shown</p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Hospital</th>
              <th>Contact</th>
              <th>PC</th>
              <th>Status</th>
              <th>Ends</th>
              <th>Version</th>
              <th>Last online</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const open = openId === d.id;
              return (
                <React.Fragment key={d.id}>
                  <tr className="table-row-clickable" onClick={() => setOpenId(open ? null : d.id)}>
                    <td className="expand-cell"><span className={`chevron ${open ? 'chevron-open' : ''}`}>▸</span></td>
                    <td>
                      <div className="institution-cell">
                        <strong>{d.hospitalName || '—'}</strong>
                        <span className="muted small">#{d.hospitalId} · {d.hospital?.city || d.hospital?.address || 'no address'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <span>{d.hospital?.contactPerson || '—'}</span>
                        <span className="muted small">{d.hospital?.phone || '—'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <CopyChip value={d.fingerprint} label={pcDisplayId(d.fingerprint)} />
                        <span className="muted small">{d.machineName || ''}{d.testDevice ? ' · test PC' : ''}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={d._status} /></td>
                    <td className="small">{fmtDate(d.endAt)}</td>
                    <td className="small">{d.appVersion || '—'}</td>
                    <td className="small">{fmtDate(d.lastSyncAt || d.lastSeenAt, true)}</td>
                  </tr>
                  {open && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        <div className="detail-panel">
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Email</span>{d.hospital?.email || '—'}</div>
                            <div className="detail-item"><span className="field-label">Phone</span>{d.hospital?.phone || '—'}</div>
                            <div className="detail-item"><span className="field-label">Address</span>{d.hospital?.address || '—'}</div>
                            <div className="detail-item"><span className="field-label">City</span>{d.hospital?.city || '—'}</div>
                          </div>
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Fingerprint</span><code className="wrap">{d.fingerprint}</code></div>
                            <div className="detail-item"><span className="field-label">Activated</span>{d.activatedVia || '—'} · {fmtDate(d.createdAt, true)}</div>
                            <div className="detail-item"><span className="field-label">Trial</span>{fmtDate(d.trialStartAt)} → {fmtDate(d.trialEndAt)}</div>
                            <div className="detail-item"><span className="field-label">Plan</span>{d.plan || '—'}{d.paidSince ? ` · paid since ${fmtDate(d.paidSince)}` : ''}</div>
                          </div>
                          <div className="detail-col">
                            <div className="detail-item"><span className="field-label">Licence ends</span>{fmtDate(d.endAt, true)} ({daysLeft(d.endAt)} days)</div>
                            <div className="detail-item"><span className="field-label">Last sync</span>{fmtDate(d.lastSyncAt, true)}</div>
                            <div className="detail-item"><span className="field-label">Last update check</span>{fmtDate(d.lastUpdateCheckAt, true)}</div>
                            {d.status === 'suspended' && <div className="detail-item"><span className="field-label">Suspended because</span>{d.suspendReason || '—'}</div>}
                          </div>
                        </div>
                        <DeviceActions key={d.id} device={d} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="empty-state">{enriched.length === 0 ? 'No PC has activated the USG app yet.' : 'No PCs match your filters.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResetTab({ requests }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const pending = (requests || []).filter((r) => r.status === 'pending');
  const decided = (requests || []).filter((r) => r.status !== 'pending').slice(0, 20);

  async function decide(id, action) {
    setBusyId(id);
    setError('');
    try {
      await usgAdmin(action, { requestId: id });
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
          <h2>Developer reset requests</h2>
          <p className="muted">Sent by the hidden <code>--usg-dev-license-reset</code> flag. Approving forgets the PC, so its next activation starts a new trial. Approve only PCs you recognise.</p>
        </div>
        <span className="count-pill">{pending.length} pending</span>
      </div>
      {error && <div className="error">{error}</div>}
      {requests === null && <p className="muted">Loading…</p>}
      {requests && pending.length === 0 && <p className="muted empty-state">No pending requests.</p>}
      <div className="card-list">
        {pending.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-row">
              <strong>{r.hospitalName || (r.knownDevice ? '(no name)' : 'Unknown PC (not registered)')}</strong>
              <span className="badge">{r.machineName || 'PC'}</span>
            </div>
            <div className="card-grid">
              <div><span className="field-label">PC ID</span><CopyChip value={r.fingerprint} label={pcDisplayId(r.fingerprint)} /></div>
              <div><span className="field-label">Requested</span>{fmtDate(r.createdAt, true)}</div>
              <div><span className="field-label">App version</span>{r.appVersion || '—'}</div>
              <div><span className="field-label">IP</span>{r.ip || '—'}</div>
            </div>
            <div className="card-actions">
              <button className="danger" disabled={busyId === r.id} onClick={() => window.confirm('Reset this PC? Its next activation starts a NEW trial.') && decide(r.id, 'approveReset')}>
                {busyId === r.id ? 'Working…' : 'Approve reset'}
              </button>
              <button className="secondary" disabled={busyId === r.id} onClick={() => decide(r.id, 'dismissReset')}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
      {decided.length > 0 && (
        <>
          <h3 className="usg-subhead">Recently decided</h3>
          <ul className="usg-history">
            {decided.map((r) => (
              <li key={r.id}>{fmtDate(r.decidedAt, true)} · {r.status} · {r.hospitalName || pcDisplayId(r.fingerprint)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UpdatesTab({ devices }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load(fresh) {
    setError('');
    setBusy('load');
    try {
      setData(await usgAdmin('releases', { fresh }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => { load(false); }, []);

  async function act(name, action, fields, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    setError('');
    try {
      await usgAdmin(action, fields);
      await load(true);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  const versions = useMemo(() => {
    const counts = {};
    for (const d of devices || []) counts[d.appVersion || 'unknown'] = (counts[d.appVersion || 'unknown'] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [devices]);
  const testPcs = (devices || []).filter((d) => d.testDevice);

  const config = data?.config || {};
  const released = config.releasedVersion || null;

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Updates (USG Reporting)</h2>
          <p className="muted">
            Releases come from GitHub {data ? <code>{data.repo}</code> : ''}. Customers get ONLY the version you release here; test PCs get the newest signed release (pre-releases too).
          </p>
        </div>
        <button className="secondary" disabled={!!busy} onClick={() => load(true)}>{busy === 'load' ? 'Loading…' : 'Refresh from GitHub'}</button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="stat-grid usg-stat-3">
        <div className="stat-card stat-success"><span className="stat-label">Released to all</span><span className="stat-value">{released || 'none'}</span></div>
        <div className={`stat-card ${config.paused ? 'stat-danger' : 'stat-info'}`}>
          <span className="stat-label">Update delivery</span>
          <span className="stat-value">{config.paused ? 'Paused' : 'On'}</span>
        </div>
        <div className="stat-card"><span className="stat-label">Test PCs</span><span className="stat-value">{testPcs.length}</span></div>
      </div>

      <div className="card-actions">
        {config.paused ? (
          <button disabled={!!busy} onClick={() => act('pause', 'setPaused', { paused: false })}>Resume updates</button>
        ) : (
          <button className="danger" disabled={!!busy} onClick={() => act('pause', 'setPaused', { paused: true }, 'Pause updates? No customer PC will be offered an update until you resume (test PCs still are).')}>Pause all updates</button>
        )}
        {released && <button className="secondary" disabled={!!busy} onClick={() => act('withdraw', 'setReleased', { version: '' }, `Withdraw ${released}? Customers will not be offered any update until you release one again.`)}>Withdraw released version</button>}
      </div>

      <h3 className="usg-subhead">Releases on GitHub</h3>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Version</th><th>Published</th><th>Package</th><th>Signature</th><th></th></tr>
            </thead>
            <tbody>
              {data.releases.map((r) => {
                const isReleased = released && r.version.replace(/^v/i, '') === String(released).replace(/^v/i, '');
                return (
                  <tr key={r.id}>
                    <td><strong>{r.version}</strong>{r.prerelease && <span className="badge usg-badge-gap">pre-release</span>}<div className="muted small">{r.name}</div></td>
                    <td className="small">{fmtDate(r.publishedAt, true)}</td>
                    <td className="small">{r.zip ? `${r.zip.name} (${(r.zip.size / 1048576).toFixed(1)} MB)` : '—'}</td>
                    <td>{r.manifest ? <span className="status status-success">Signed ✓</span> : <span className="status status-danger" title={r.problem}>Not usable</span>}
                      {!r.manifest && <div className="muted small">{r.problem}</div>}</td>
                    <td>
                      {isReleased ? <span className="status status-success">Live for all</span> : (
                        <button disabled={!!busy || !r.manifest || r.prerelease} onClick={() => act(`rel-${r.id}`, 'setReleased', { version: r.version }, `Release ${r.version} to ALL customer PCs?\n\nTip: try it on a test PC first.`)}>
                          {busy === `rel-${r.id}` ? 'Working…' : 'Release to all'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.releases.length === 0 && <tr><td colSpan={5} className="empty-state">No releases on GitHub yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="usg-two-col">
        <div>
          <h3 className="usg-subhead">Versions in use</h3>
          <ul className="usg-history">{versions.map(([v, n]) => <li key={v}><strong>{v}</strong> · {n} PC{n > 1 ? 's' : ''}</li>)}</ul>
        </div>
        <div>
          <h3 className="usg-subhead">Test PCs</h3>
          {testPcs.length === 0 ? <p className="muted small">None. Mark a PC as "Test PC" in its row on the Hospitals / PCs tab.</p> : (
            <ul className="usg-history">{testPcs.map((d) => <li key={d.id}>{d.hospitalName} · {pcDisplayId(d.fingerprint)} · {d.appVersion || '—'}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityTab() {
  const events = useCollection('usgEvents', orderBy('at', 'desc'), limit(200));
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Activity</h2>
          <p className="muted">The latest 200 events: activations, renewals, suspensions, resets, update releases.</p>
        </div>
      </div>
      {events === null ? <p className="muted">Loading…</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Event</th><th>Hospital / PC</th><th>Details</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="small">{fmtDate(e.at, true)}</td>
                  <td>{EVENT_TEXT[e.type] || e.type}</td>
                  <td className="small">{e.hospitalName || ''}{e.fingerprint ? ` ${pcDisplayId(e.fingerprint)}` : ''}</td>
                  <td className="small">
                    {[e.months && `${e.months} month(s)`, e.to && `→ ${fmtDate(e.to)}`, e.amount, e.note, e.reason, e.version, e.via, e.trialDays && `${e.trialDays}-day trial`, e.by]
                      .filter(Boolean).join(' · ')}
                  </td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={4} className="empty-state">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const settings = useDoc('usgConfig', 'settings');
  const [trialDays, setTrialDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = settings?.trialDays || 30;

  useEffect(() => { if (settings !== undefined) setTrialDays(String(current)); }, [settings, current]);

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await usgAdmin('saveSettings', { trialDays: Number(trialDays) });
      setMessage('Saved. New PCs get this trial length; existing trials are not changed.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Settings (USG Reporting)</h2>
          <p className="muted">These apply to the USG app only. SMRG settings are not affected.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="usg-info">{message}</div>}
      <div className="card">
        <span className="field-label">Free trial for a new PC (days)</span>
        <div className="card-actions">
          <input className="usg-narrow" type="number" min="1" max="365" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
          <button disabled={busy || !trialDays || Number(trialDays) === current} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          <span className="muted small">Currently {current} days.</span>
        </div>
      </div>
    </div>
  );
}

export default function UsgPanel() {
  const [tab, setTab] = useState('devices');
  const devices = useCollection('usgDevices', orderBy('createdAt', 'desc'));
  const resets = useCollection('usgResetRequests', orderBy('createdAt', 'desc'), limit(100));
  const pendingResets = (resets || []).filter((r) => r.status === 'pending').length;

  return (
    <>
      <nav className="tabs">
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>Hospitals / PCs</button>
        <button className={tab === 'resets' ? 'active' : ''} onClick={() => setTab('resets')}>
          Reset requests{pendingResets > 0 && <span className="tab-badge">{pendingResets}</span>}
        </button>
        <button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>Updates</button>
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </nav>
      <main>
        {tab === 'devices' && <DevicesTab devices={devices} />}
        {tab === 'resets' && <ResetTab requests={resets} />}
        {tab === 'updates' && <UpdatesTab devices={devices} />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </>
  );
}
