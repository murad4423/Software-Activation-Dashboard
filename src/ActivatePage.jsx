import React, { useEffect, useState } from 'react';

// Decodes the compact QR payload produced by QrCodeHelper.EncodeRequestToJson on the
// desktop app (keys i/a/n/p/e/m/k/r/v/t), passed here as ?req=<base64url(json)>.
function decodeReqParam() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('req');
  if (!raw) return { error: 'No activation data found in this link.' };

  try {
    // base64url -> base64
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '=');
    const json = decodeURIComponent(escape(atob(b64)));
    const compact = JSON.parse(json);
    return {
      qrJson: json,
      institutionName: compact.i || '',
      address: compact.a || '',
      userName: compact.n || '',
      phoneNumber: compact.p || '',
      email: compact.e || '',
      machineId: compact.m || '',
      kind: compact.k || 'Trial',
      requestId: compact.r || '',
      appVersion: compact.v || '',
      createdUtc: compact.t || '',
    };
  } catch {
    return { error: 'Could not read this activation code. Please rescan the QR code from the app.' };
  }
}

function downloadLicenseFile(requestId, licenseKey) {
  const blob = new Blob([licenseKey], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SMRG-License-${requestId || 'key'}.lic`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ActivatePage() {
  const [data] = useState(decodeReqParam);
  const [status, setStatus] = useState('idle'); // idle | working | done | error
  const [message, setMessage] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'Activate - Smart Medical Report Generator';
  }, []);

  if (data.error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Activation</h1>
          <p className="error">{data.error}</p>
        </div>
      </div>
    );
  }

  const isFinal = data.kind === 'Final';

  async function handleActivate() {
    setStatus('working');
    setMessage('');
    try {
      const res = await fetch('/activateOfflineTrial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrJson: data.qrJson }),
      });
      const body = await res.json();
      if (!body.success) {
        setStatus('error');
        setMessage(body.message || 'Activation failed.');
        return;
      }
      setLicenseKey(body.licenseKey);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setMessage('Could not reach the activation server. Check your internet connection and try again.');
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(licenseKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ width: 380 }}>
        <h1>Activate Your License</h1>

        <div className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div><strong>Institution:</strong> {data.institutionName || '-'}</div>
          <div><strong>Contact:</strong> {data.userName || '-'}</div>
          <div><strong>Request type:</strong> {isFinal ? 'Full / Premium License' : 'Trial (30 days)'}</div>
          <div style={{ wordBreak: 'break-all' }}><strong>Machine ID:</strong> {data.machineId}</div>
        </div>

        {isFinal && (
          <p className="muted">
            This is a full/premium activation request. Please complete payment and contact us —
            your license will be approved from the admin dashboard and sent to you.
          </p>
        )}

        {!isFinal && status !== 'done' && (
          <>
            <button onClick={handleActivate} disabled={status === 'working'}>
              {status === 'working' ? 'Activating...' : 'Activate Trial'}
            </button>
            {status === 'error' && <p className="error">{message}</p>}
          </>
        )}

        {status === 'done' && (
          <>
            <p className="muted">Trial activated. Get this key onto your PC (download it, or copy it) and enter it in the app.</p>
            <textarea readOnly rows={4} value={licenseKey} style={{ fontSize: 12, wordBreak: 'break-all' }} />
            <button onClick={() => downloadLicenseFile(data.requestId, licenseKey)}>
              Download Key File
            </button>
            <button className="secondary" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy Key'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
