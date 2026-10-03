// POST /usg/api/update  (USG app: Settings > Update > "Check for Updates")
// Body: { fingerprint, appVersion }
//
// Which version a PC is offered is decided in the dashboard (USG -> Updates), not by GitHub alone:
//   - a "Test PC" (flag on its device record) gets the newest correctly signed release, pre-releases included;
//   - every other PC gets the version marked "Released to all" — nothing while updates are paused or none is released.
// Answer: { release: {version, name, publishedAt, notes, assetName, assetSize, sha256, signature, downloadUrl} }
//      or { release: null, message }. The app itself compares versions and verifies the signature.

import { clientIp, db, fail, isFingerprint, json, rateLimit, RATE_LIMITED, readJson, serverTimestamp } from './_shared/usg.js';
import { listReleases, sameVersion } from './_shared/usgReleases.js';

export default async function (request, context) {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');

  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request. Please update the app manually.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(`update:fp:${fp}`, 30, 3600)) || !(await rateLimit(`update:ip:${ip}`, 120, 3600))) return RATE_LIMITED();

  try {
    const firestore = db();
    const [configSnap, deviceSnap] = await Promise.all([
      firestore.collection('usgConfig').doc('updates').get(),
      firestore.collection('usgDevices').doc(fp).get(),
    ]);
    const config = configSnap.exists ? configSnap.data() : {};
    const isTest = deviceSnap.exists && deviceSnap.data().testDevice === true;
    if (deviceSnap.exists) {
      await deviceSnap.ref.update({ appVersion: String(body.appVersion || '').slice(0, 30), lastUpdateCheckAt: serverTimestamp() });
    }

    const releases = (await listReleases()).filter((r) => r.manifest);
    let target = null;
    if (isTest) target = releases[0] || null;
    else if (!config.paused && config.releasedVersion) target = releases.find((r) => !r.prerelease && sameVersion(r.version, config.releasedVersion)) || null;

    if (!target) {
      return json(200, { release: null, message: config.paused && !isTest ? 'Updates are paused right now. Please check again later.' : 'No update is available right now.' });
    }

    const origin = new URL(request.url).origin;
    return json(200, {
      release: {
        version: target.manifest.version,
        name: target.name,
        publishedAt: target.publishedAt,
        notes: target.notes,
        assetName: target.zip.name,
        assetSize: target.manifest.size,
        sha256: target.manifest.sha256,
        signature: target.manifest.signature,
        downloadUrl: `${origin}/usg/api/update/download?asset=${target.zip.id}`,
      },
    });
  } catch (err) {
    console.error('usg-update error:', err);
    return fail(502, 'server_error', 'The update server could not read the releases right now. Please try again later.');
  }
}
