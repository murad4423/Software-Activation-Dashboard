// POST /usg/api/dev-reset-request  (USG app: hidden developer reset, see Software Code/docs/LICENSE_DEVELOPER_NOTES.md)
//
// ONLY records the request. Nothing is reset until it is approved in the dashboard (USG -> Reset requests), so a
// leaked trigger can't give anyone a free trial.

import { cleanComponents, clientIp, db, fail, isFingerprint, json, logEvent, rateLimit, RATE_LIMITED, readJson, serverTimestamp } from './_shared/usg.js';

export default async function (request, context) {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');

  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(`reset:fp:${fp}`, 5, 86400)) || !(await rateLimit(`reset:ip:${ip}`, 20, 86400))) return RATE_LIMITED();

  try {
    const device = await db().collection('usgDevices').doc(fp).get();
    await db().collection('usgResetRequests').add({
      fingerprint: fp,
      components: cleanComponents(body.components),
      machineName: String(body.machineName || '').slice(0, 100),
      appVersion: String(body.appVersion || '').slice(0, 30),
      requestedAtClient: String(body.requestedAt || '').slice(0, 40),
      hospitalName: device.exists ? device.data().hospitalName || '' : '',
      knownDevice: device.exists,
      ip,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    await logEvent('reset-requested', fp, { ip });
    return json(202, { ok: true });
  } catch (err) {
    console.error('usg-dev-reset-request error:', err);
    return fail(500, 'server_error', 'Server error.');
  }
}
