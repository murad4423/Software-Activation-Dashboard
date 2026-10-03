// POST /usg/api/offline-activate  (public; called by the /usg/activate page a phone opens from the app's QR code)
//
// Body: { r: "<the r= value from the QR link>" } = base64url of {"v":1,"fp":"<64 hex>","h":{...},"mn":"...","av":"..."}.
// Same rules as online activation (new PC -> trial, known PC -> its current licence, which also makes this the
// renewal path for PCs that are never online). Answers the token (for the .usglicense file) and the typed code.

import { cleanHospital, clientIp, fail, findOrCreateDevice, isFingerprint, json, licenceFor, rateLimit, RATE_LIMITED, readJson } from './_shared/usg.js';

function decodeRequest(r) {
  if (typeof r !== 'string' || r.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(r)) return null;
  try {
    const data = JSON.parse(Buffer.from(r, 'base64url').toString('utf8'));
    return data && data.v === 1 && isFingerprint(data.fp) ? data : null;
  } catch {
    return null;
  }
}

export default async function (request, context) {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');

  const body = await readJson(request);
  const data = decodeRequest(body?.r);
  if (!data) return fail(400, 'invalid_request', 'This activation link is not valid. Scan the QR code from the app again.');

  const hospital = cleanHospital(data.h);
  if (!hospital.hospitalName) return fail(400, 'invalid_request', 'The hospital / clinic name is missing. Fill it in on the PC and scan the QR code again.');

  const ip = clientIp(request, context);
  const fp = data.fp.toLowerCase();
  if (!(await rateLimit(`offline:ip:${ip}`, 30, 3600)) || !(await rateLimit(`offline:fp:${fp}`, 10, 3600))) return RATE_LIMITED();

  try {
    const device = await findOrCreateDevice({
      fingerprint: fp,
      hospital,
      components: {},
      machineName: String(data.mn || '').slice(0, 100),
      appVersion: String(data.av || '').slice(0, 30),
      via: 'offline',
      ip,
    });
    const licence = licenceFor(device);
    return json(200, {
      token: licence.token,
      code: licence.code,
      status: licence.status,
      expiresAt: licence.expiresAt,
      hospitalName: device.hospitalName || hospital.hospitalName,
      hospitalId: device.hospitalId,
    });
  } catch (err) {
    console.error('usg-offline-activate error:', err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again in a few minutes.');
  }
}
