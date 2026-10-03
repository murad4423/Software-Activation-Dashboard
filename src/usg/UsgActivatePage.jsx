import React, { useEffect, useState } from 'react';
import { pcDisplayId } from './usgFormat.js';

// Public page a phone opens from the USG Reporting app's Offline Activation QR code:
//   /usg/activate?r=<base64url of {"v":1,"fp":...,"h":{hospital},"mn":...,"av":...}>
// Shows the activation code to type into the PC and a licence file to download.

function decodeRequest() {
  const r = new URLSearchParams(window.location.search).get('r') || '';
  if (!r) return { error: 'No activation data found in this link. Scan the QR code from the app again.' };
  try {
    const b64 = r.replace(/-/g, '+').replace(/_/g, '/').padEnd(r.length + ((4 - (r.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.v !== 1 || !/^[0-9a-fA-F]{64}$/.test(data.fp || '')) throw new Error('bad');
    return { r, hospital: data.h || {}, machineName: data.mn || '', pcId: pcDisplayId(data.fp) };
  } catch {
    return { error: 'This activation link could not be read. Scan the QR code from the app again.' };
  }
}

function downloadLicence(token, hospitalName) {
  const blob = new Blob([JSON.stringify({ token }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(hospitalName || 'USG').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'USG'}.usglicense`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STATUS_TEXT = { trial: 'Trial', active: 'Active subscription', suspended: 'Suspended' };

export default function UsgActivatePage() {
  const [data] = useState(decodeRequest);
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'Activate - USG Reporting';
  }, []);

  async function activate() {
    setState('working');
    setMessage('');
    try {
      const res = await fetch('/usg/api/offline-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r: data.r }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.code) {
        setState('error');
        setMessage(body.message || 'Activation failed. Please try again.');
        return;
      }
      setResult(body);
      setState('done');
    } catch {
      setState('error');
      setMessage('Could not reach the activation server. Check the phone\'s internet connection and try again.');
    }
  }

  if (data.error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>USG Reporting - Activation</h1>
          <p className="error">{data.error}</p>
        </div>
      </div>
    );
  }

  const expires = result ? new Date(result.expiresAt) : null;

  return (
    <div className="login-wrap usg-activate">
      <div className="login-card usg-activate-card">
        <h1>USG Reporting - Activation</h1>
        <div className="muted usg-activate-facts">
          <div><strong>Hospital / Clinic:</strong> {data.hospital.hospitalName || '-'}</div>
          {data.hospital.phone && <div><strong>Phone:</strong> {data.hospital.phone}</div>}
          <div><strong>PC:</strong> {data.machineName || '-'} ({data.pcId})</div>
        </div>

        {state !== 'done' && (
          <>
            <p className="muted">Tap the button to get the activation code for this PC. A new PC starts with a free trial; a PC that is already registered gets its current licence (use this to renew a PC that has no internet).</p>
            <button onClick={activate} disabled={state === 'working'}>
              {state === 'working' ? 'Getting the code...' : 'Get Activation Code'}
            </button>
            {state === 'error' && <p className="error">{message}</p>}
          </>
        )}

        {state === 'done' && result && (
          <>
            <div className="usg-activate-status">
              <span className={`status status-${result.status === 'suspended' ? 'danger' : 'success'}`}>{STATUS_TEXT[result.status] || result.status}</span>
              <span className="muted">valid until {expires.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            <p className="muted">On the PC: Offline Activation, then type this code:</p>
            <div className="usg-code" aria-label="Activation code">{result.code}</div>
            <button
              className="secondary"
              onClick={() => navigator.clipboard.writeText(result.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
            <p className="muted">Or download the licence file and import it on the PC ("Import licence file..."):</p>
            <button onClick={() => downloadLicence(result.token, result.hospitalName)}>Download Licence File</button>
          </>
        )}
      </div>
    </div>
  );
}
