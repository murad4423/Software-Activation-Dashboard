// POST /usg/api/sync  (USG app: periodic re-check, at most every 12 hours per PC)
//
// Answers with the licence as it is in the dashboard NOW — this is how a renewal (+1 month / +12 months), a
// suspension or a lifted suspension reaches the PC without reactivating. Unknown PC -> 404 unknown_device
// (the app keeps its current licence).

import { cleanComponents, clientIp, db, fail, isFingerprint, json, licenceFor, rateLimit, RATE_LIMITED, readJson, serverTimestamp } from './_shared/usg.js';

export default async function (request, context) {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');

  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(`sync:fp:${fp}`, 20, 3600)) || !(await rateLimit(`sync:ip:${ip}`, 120, 3600))) return RATE_LIMITED();

  try {
    const ref = db().collection('usgDevices').doc(fp);
    const snap = await ref.get();
    if (!snap.exists) return fail(404, 'unknown_device', 'This PC is not registered on the licence server.');

    const device = snap.data();
    const components = cleanComponents(body.components);
    await ref.update({
      lastSyncAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      appVersion: String(body.appVersion || device.appVersion || '').slice(0, 30),
      lastIp: ip,
      ...(Object.keys(components).length ? { components } : {}),
    });
    return json(200, { token: licenceFor(device).token });
  } catch (err) {
    console.error('usg-sync error:', err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again later.');
  }
}
