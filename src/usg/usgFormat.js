// Small helpers shared by the USG dashboard pages.

/** "A1B2-C3D4-E5F6-0718": the short PC id the desktop app shows (HardwareFingerprint.DisplayId). */
export function pcDisplayId(fingerprint) {
  if (!fingerprint) return '—';
  return (fingerprint.slice(0, 16).match(/.{1,4}/g) || []).join('-').toUpperCase();
}

export function toDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(ts, withTime = false) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleString(undefined, withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysLeft(ts) {
  const d = toDate(ts);
  return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
}

/** One status for a USG device record: what the PC will show after its next sync. */
export function usgStatus(d) {
  if (d.status === 'suspended') return { key: 'suspended', label: 'Suspended', tone: 'danger' };
  const left = daysLeft(d.endAt);
  const paid = d.status === 'active';
  const name = paid ? (d.plan === 'yearly' ? 'Yearly' : 'Monthly') : 'Trial';
  if (left === null) return { key: 'unknown', label: 'Unknown', tone: 'muted' };
  if (left <= 0) return { key: paid ? 'paid-expired' : 'trial-expired', label: `${name} expired`, tone: 'danger' };
  if (left <= 7) return { key: paid ? 'paid-ending' : 'trial-ending', label: `${name} · ${left}d left`, tone: 'warning' };
  return { key: paid ? 'paid-active' : 'trial-active', label: `${name} · ${left}d left`, tone: paid ? 'success' : 'info' };
}

export const EVENT_TEXT = {
  'trial-started': 'Trial started',
  reactivated: 'Activated again (same PC)',
  renewed: 'Renewed',
  'end-date-set': 'End date changed',
  suspended: 'Suspended',
  unsuspended: 'Suspension lifted',
  'device-reset': 'PC reset (forgotten)',
  'reset-requested': 'Developer reset requested',
  'test-pc-on': 'Marked as test PC',
  'test-pc-off': 'Test PC flag removed',
  'settings-changed': 'Settings changed',
  'update-released': 'Update released to all',
  'update-unreleased': 'Update withdrawn',
  'updates-paused': 'Updates paused',
  'updates-resumed': 'Updates resumed',
  'update-download': 'Update downloaded',
};
