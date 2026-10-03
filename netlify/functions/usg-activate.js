// POST /usg/api/activate  (USG app: online activation; redirect in netlify.toml)
//
// New PC -> a trial record (trial length from the dashboard's USG settings, default 30 days) and its licence.
// Known PC (reinstalled, licence file deleted...) -> the EXISTING record's licence, never a fresh trial.
// Body / answer: Software Code/docs/LICENSE_SERVER_API.md, "POST /api/activate".

import { cleanComponents, cleanHospital, clientIp, fail, findOrCreateDevice, isFingerprint, json, licenceFor, rateLimit, RATE_LIMITED, readJson } from './_shared/usg.js';

export default async function (request, context) {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');

  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) {
    return fail(400, 'invalid_request', 'The activation request was not complete. Please update the app and try again.');
  }
  const hospital = cleanHospital(body.hospital);
  if (!hospital.hospitalName) {
    return fail(400, 'invalid_request', 'Enter the hospital / clinic name.');
  }

  const ip = clientIp(request, context);
  const fp = body.fingerprint.toLowerCase();
  if (!(await rateLimit(`activate:ip:${ip}`, 30, 3600)) || !(await rateLimit(`activate:fp:${fp}`, 10, 3600))) {
    return RATE_LIMITED();
  }

  try {
    const device = await findOrCreateDevice({
      fingerprint: fp,
      hospital,
      components: cleanComponents(body.components),
      machineName: String(body.machineName || '').slice(0, 100),
      appVersion: String(body.appVersion || '').slice(0, 30),
      via: 'online',
      ip,
    });
    return json(200, { token: licenceFor(device).token });
  } catch (err) {
    console.error('usg-activate error:', err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again in a few minutes.');
  }
}
