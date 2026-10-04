// The licence server's endpoints, written once and used by every desktop app: each usg-*.js / smrg-*.js function
// file is just `export default <handler>(PRODUCTS.<app>)`. Addresses (netlify.toml):
//
//   POST /<app>/api/activate           online activation (new PC -> trial; known PC -> its current licence)
//   POST /<app>/api/sync               periodic re-check: renewals / suspensions reach the PC this way
//   POST /<app>/api/offline-activate   called by the public /<app>/activate page a phone opens from the app's QR code
//   POST /<app>/api/update             which update this PC is offered (decided in the dashboard)
//   GET  /<app>/api/update/download    redirect to the package on GitHub (token stays on the server)
//   POST /<app>/api/dev-reset-request  hidden developer reset: only RECORDS the request
//   POST /.netlify/functions/<app>-admin   dashboard only (admin login)
//
// Contract with the desktop apps: docs/LICENSE_SERVER_API.md in each app's repository.

import { requireAdmin } from './adminAuth.js';
import {
  cleanComponents, cleanHospital, clientIp, collection, fail, findOrCreateDevice, getSettings, isFingerprint, json,
  licenceFor, logEvent, rateLimit, RATE_LIMITED, readJson, serverTimestamp, timestamp,
} from './licensing.js';
import { assetDownloadLocation, listReleases, repoLabel, sameVersion } from './releases.js';

// ----- POST /<app>/api/activate -----
// New PC -> a trial record (trial length from the dashboard's settings, default 30 days) and its licence.
// Known PC (reinstalled, licence file deleted...) -> the EXISTING record's licence, never a fresh trial.
export const activateHandler = (product) => async (request, context) => {
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
  if (!(await rateLimit(product, `activate:ip:${ip}`, 30, 3600)) || !(await rateLimit(product, `activate:fp:${fp}`, 10, 3600))) {
    return RATE_LIMITED();
  }
  try {
    const device = await findOrCreateDevice(product, {
      fingerprint: fp,
      hospital,
      components: cleanComponents(body.components),
      machineName: String(body.machineName || '').slice(0, 100),
      appVersion: String(body.appVersion || '').slice(0, 30),
      via: 'online',
      ip,
    });
    return json(200, { token: licenceFor(product, device).token });
  } catch (err) {
    console.error(`${product.id}-activate error:`, err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again in a few minutes.');
  }
};

// ----- POST /<app>/api/sync (at most every 12 hours per PC) -----
// Answers with the licence as it is in the dashboard NOW — this is how a renewal (+1 month / +12 months), a
// suspension or a lifted suspension reaches the PC without reactivating. Unknown PC -> 404 unknown_device
// (the app keeps its current licence).
export const syncHandler = (product) => async (request, context) => {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');
  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(product, `sync:fp:${fp}`, 20, 3600)) || !(await rateLimit(product, `sync:ip:${ip}`, 120, 3600))) return RATE_LIMITED();
  try {
    const ref = collection(product, 'Devices').doc(fp);
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
    return json(200, { token: licenceFor(product, device).token });
  } catch (err) {
    console.error(`${product.id}-sync error:`, err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again later.');
  }
};

// ----- POST /<app>/api/offline-activate (public; called by the /<app>/activate page) -----
// Body: { r: "<the r= value from the QR link>" } = base64url of {"v":1,"fp":"<64 hex>","h":{...},"mn":"...","av":"..."}.
// Same rules as online activation (new PC -> trial, known PC -> its current licence, which also makes this the
// renewal path for PCs that are never online). Answers the token (for the licence file) and the typed code.
function decodeOfflineRequest(r) {
  if (typeof r !== 'string' || r.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(r)) return null;
  try {
    const data = JSON.parse(Buffer.from(r, 'base64url').toString('utf8'));
    return data && data.v === 1 && isFingerprint(data.fp) ? data : null;
  } catch {
    return null;
  }
}

export const offlineActivateHandler = (product) => async (request, context) => {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');
  const body = await readJson(request);
  const data = decodeOfflineRequest(body?.r);
  if (!data) return fail(400, 'invalid_request', 'This activation link is not valid. Scan the QR code from the app again.');
  const hospital = cleanHospital(data.h);
  if (!hospital.hospitalName) return fail(400, 'invalid_request', 'The hospital / clinic name is missing. Fill it in on the PC and scan the QR code again.');
  const ip = clientIp(request, context);
  const fp = data.fp.toLowerCase();
  if (!(await rateLimit(product, `offline:ip:${ip}`, 30, 3600)) || !(await rateLimit(product, `offline:fp:${fp}`, 10, 3600))) return RATE_LIMITED();
  try {
    const device = await findOrCreateDevice(product, {
      fingerprint: fp,
      hospital,
      components: {},
      machineName: String(data.mn || '').slice(0, 100),
      appVersion: String(data.av || '').slice(0, 30),
      via: 'offline',
      ip,
    });
    const licence = licenceFor(product, device);
    return json(200, {
      token: licence.token,
      code: licence.code,
      status: licence.status,
      expiresAt: licence.expiresAt,
      hospitalName: device.hospitalName || hospital.hospitalName,
      hospitalId: device.hospitalId,
    });
  } catch (err) {
    console.error(`${product.id}-offline-activate error:`, err);
    return fail(500, 'server_error', 'The licence server had a problem. Please try again in a few minutes.');
  }
};

// ----- POST /<app>/api/update  Body: { fingerprint, appVersion } -----
// Which version a PC is offered is decided in the dashboard (Updates), not by GitHub alone:
//   - a "Test PC" (flag on its device record) gets the newest correctly signed release, pre-releases included;
//   - every other PC gets the version marked "Released to all" — nothing while updates are paused or none is released.
// Answer: { release: {version, name, publishedAt, notes, assetName, assetSize, sha256, signature, downloadUrl} }
//      or { release: null, message }. The app itself compares versions and verifies the signature.
export const updateHandler = (product) => async (request, context) => {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');
  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request. Please update the app manually.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(product, `update:fp:${fp}`, 30, 3600)) || !(await rateLimit(product, `update:ip:${ip}`, 120, 3600))) return RATE_LIMITED();
  try {
    const [configSnap, deviceSnap] = await Promise.all([
      collection(product, 'Config').doc('updates').get(),
      collection(product, 'Devices').doc(fp).get(),
    ]);
    const config = configSnap.exists ? configSnap.data() : {};
    const isTest = deviceSnap.exists && deviceSnap.data().testDevice === true;
    if (deviceSnap.exists) {
      await deviceSnap.ref.update({ appVersion: String(body.appVersion || '').slice(0, 30), lastUpdateCheckAt: serverTimestamp() });
    }
    const releases = (await listReleases(product)).filter((r) => r.manifest);
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
        downloadUrl: `${origin}/${product.id}/api/update/download?asset=${target.zip.id}`,
      },
    });
  } catch (err) {
    console.error(`${product.id}-update error:`, err);
    return fail(502, 'server_error', 'The update server could not read the releases right now. Please try again later.');
  }
};

// ----- GET /<app>/api/update/download?asset=<GitHub asset id> -----
// Answers a redirect to GitHub's short-lived download address, so the (large) file never passes through Netlify and
// the GitHub token never leaves the server. Only assets of the product's configured repository can be reached.
// The app checks the downloaded file against the signed SHA-256, so the redirect target can't swap the file.
export const updateDownloadHandler = (product) => async (request, context) => {
  if (request.method !== 'GET') return fail(405, 'invalid_request', 'Method not allowed.');
  const asset = new URL(request.url).searchParams.get('asset') || '';
  if (!/^\d{1,15}$/.test(asset)) return fail(400, 'invalid_request', 'Invalid download.');
  const ip = clientIp(request, context);
  if (!(await rateLimit(product, `download:ip:${ip}`, 20, 3600))) return RATE_LIMITED();
  try {
    const location = await assetDownloadLocation(product, asset);
    await logEvent(product, 'update-download', null, { asset, ip });
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`${product.id}-update-download error:`, err);
    return fail(502, 'server_error', 'The update file could not be reached right now. Please try again later.');
  }
};

// ----- POST /<app>/api/dev-reset-request (hidden developer reset, see the app's docs/LICENSE_DEVELOPER_NOTES.md) -----
// ONLY records the request. Nothing is reset until it is approved in the dashboard (Reset requests), so a leaked
// trigger can't give anyone a free trial.
export const devResetRequestHandler = (product) => async (request, context) => {
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Method not allowed.');
  const body = await readJson(request);
  if (!body || !isFingerprint(body.fingerprint)) return fail(400, 'invalid_request', 'Invalid request.');
  const fp = body.fingerprint.toLowerCase();
  const ip = clientIp(request, context);
  if (!(await rateLimit(product, `reset:fp:${fp}`, 5, 86400)) || !(await rateLimit(product, `reset:ip:${ip}`, 20, 86400))) return RATE_LIMITED();
  try {
    const device = await collection(product, 'Devices').doc(fp).get();
    await collection(product, 'ResetRequests').add({
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
    await logEvent(product, 'reset-requested', fp, { ip });
    return json(202, { ok: true });
  } catch (err) {
    console.error(`${product.id}-dev-reset-request error:`, err);
    return fail(500, 'server_error', 'Server error.');
  }
};

// ----- any unknown /<app>/api/... address: a JSON error the desktop app can read (not the dashboard's HTML) -----
export const notFoundHandler = () => async () =>
  fail(404, 'not_found', 'This licence server address is not answering correctly. Please update the app or contact support.');

// ----- POST /.netlify/functions/<app>-admin  (dashboard only — requires the admin login) -----
// Body: { action, ...fields }. Every change is written to <app>Events.
//
// Licences:  renew {fingerprint, months, amount?, note?}  -> +N calendar months from max(today, current end); status active
//            setEnd {fingerprint, endDate}                -> exact end date (e.g. to correct a mistake)
//            suspend / unsuspend {fingerprint, reason?}
//            setNote {fingerprint, note}
//            setTestDevice {fingerprint, value}           -> this PC gets new versions before everybody else
//            licence {fingerprint}                         -> current token + activation code (to read out on the phone)
//            deleteDevice {fingerprint}                    -> forget the PC; its next activation starts a NEW trial
//            approveReset / dismissReset {requestId}
// Settings:  saveSettings {trialDays}
// Updates:   releases {fresh?}  setReleased {version}  setPaused {paused}

const ok = (body = {}) => json(200, { success: true, ...body });
const bad = (message, status = 400) => json(status, { success: false, message });

function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function adminActions(product) {
  async function deviceRef(fingerprint) {
    if (!isFingerprint(fingerprint)) throw Object.assign(new Error('Invalid PC fingerprint.'), { statusCode: 400 });
    const ref = collection(product, 'Devices').doc(fingerprint.toLowerCase());
    const snap = await ref.get();
    if (!snap.exists) throw Object.assign(new Error('This PC is not registered (it may have been reset).'), { statusCode: 404 });
    return { ref, device: snap.data() };
  }

  return {
    async renew(body, admin) {
      const months = Number(body.months);
      if (!Number.isInteger(months) || months < 1 || months > 60) return bad('Months must be a whole number from 1 to 60.');
      const { ref, device } = await deviceRef(body.fingerprint);
      const now = new Date();
      const currentEnd = device.endAt?.toDate ? device.endAt.toDate() : now;
      const base = currentEnd > now ? currentEnd : now;
      const endAt = addMonths(base, months);
      const plan = months % 12 === 0 ? 'yearly' : 'monthly';
      await ref.update({
        status: device.status === 'suspended' ? 'suspended' : 'active',
        plan,
        endAt: timestamp(endAt),
        paidSince: device.paidSince || timestamp(now),
        lastRenewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logEvent(product, 'renewed', device.fingerprint, {
        months,
        plan,
        from: currentEnd.toISOString(),
        to: endAt.toISOString(),
        amount: String(body.amount || '').slice(0, 30),
        note: String(body.note || '').slice(0, 300),
        by: admin.email,
        hospitalName: device.hospitalName || '',
      });
      return ok({ endAt: endAt.toISOString() });
    },

    async setEnd(body, admin) {
      const endAt = new Date(body.endDate);
      if (Number.isNaN(endAt.getTime())) return bad('Invalid date.');
      const { ref, device } = await deviceRef(body.fingerprint);
      await ref.update({ endAt: timestamp(endAt), ...(device.status === 'trial' ? { trialEndAt: timestamp(endAt) } : {}), updatedAt: serverTimestamp() });
      await logEvent(product, 'end-date-set', device.fingerprint, { to: endAt.toISOString(), by: admin.email, hospitalName: device.hospitalName || '' });
      return ok({ endAt: endAt.toISOString() });
    },

    async suspend(body, admin) {
      const { ref, device } = await deviceRef(body.fingerprint);
      if (device.status === 'suspended') return ok();
      await ref.update({ status: 'suspended', statusBeforeSuspend: device.status, suspendReason: String(body.reason || '').slice(0, 300), updatedAt: serverTimestamp() });
      await logEvent(product, 'suspended', device.fingerprint, { reason: String(body.reason || '').slice(0, 300), by: admin.email, hospitalName: device.hospitalName || '' });
      return ok();
    },

    async unsuspend(body, admin) {
      const { ref, device } = await deviceRef(body.fingerprint);
      if (device.status !== 'suspended') return ok();
      const status = device.statusBeforeSuspend === 'trial' ? 'trial' : 'active';
      await ref.update({ status, suspendReason: '', updatedAt: serverTimestamp() });
      await logEvent(product, 'unsuspended', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
      return ok();
    },

    async setNote(body) {
      const { ref } = await deviceRef(body.fingerprint);
      await ref.update({ note: String(body.note || '').slice(0, 1000), updatedAt: serverTimestamp() });
      return ok();
    },

    async setTestDevice(body, admin) {
      const { ref, device } = await deviceRef(body.fingerprint);
      await ref.update({ testDevice: body.value === true, updatedAt: serverTimestamp() });
      await logEvent(product, body.value === true ? 'test-pc-on' : 'test-pc-off', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
      return ok();
    },

    async licence(body) {
      const { device } = await deviceRef(body.fingerprint);
      return ok(licenceFor(product, device));
    },

    async deleteDevice(body, admin) {
      const { ref, device } = await deviceRef(body.fingerprint);
      await collection(product, 'DeletedDevices').add({ ...device, deletedAt: serverTimestamp(), deletedBy: admin.email });
      await ref.delete();
      await logEvent(product, 'device-reset', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
      return ok();
    },

    async approveReset(body, admin) {
      const reqRef = collection(product, 'ResetRequests').doc(String(body.requestId || 'x'));
      const snap = await reqRef.get();
      if (!snap.exists) return bad('Request not found.', 404);
      const request = snap.data();
      const ref = collection(product, 'Devices').doc(request.fingerprint);
      const device = await ref.get();
      if (device.exists) {
        await collection(product, 'DeletedDevices').add({ ...device.data(), deletedAt: serverTimestamp(), deletedBy: admin.email, resetRequestId: snap.id });
        await ref.delete();
      }
      await reqRef.update({ status: 'approved', decidedAt: serverTimestamp(), decidedBy: admin.email });
      await logEvent(product, 'device-reset', request.fingerprint, { by: admin.email, viaRequest: snap.id, hospitalName: request.hospitalName || '' });
      return ok();
    },

    async dismissReset(body, admin) {
      const reqRef = collection(product, 'ResetRequests').doc(String(body.requestId || 'x'));
      if (!(await reqRef.get()).exists) return bad('Request not found.', 404);
      await reqRef.update({ status: 'dismissed', decidedAt: serverTimestamp(), decidedBy: admin.email });
      return ok();
    },

    async saveSettings(body, admin) {
      const trialDays = Number(body.trialDays);
      if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365) return bad('Trial days must be a whole number from 1 to 365.');
      await collection(product, 'Config').doc('settings').set({ trialDays, updatedAt: serverTimestamp() }, { merge: true });
      await logEvent(product, 'settings-changed', null, { trialDays, by: admin.email });
      return ok({ settings: await getSettings(product) });
    },

    async releases(body) {
      const [releases, config] = await Promise.all([listReleases(product, { fresh: body.fresh === true }), collection(product, 'Config').doc('updates').get()]);
      return ok({ repo: repoLabel(product), releases, config: config.exists ? config.data() : {} });
    },

    async setReleased(body, admin) {
      const version = String(body.version || '');
      if (version) {
        const release = (await listReleases(product, { fresh: true })).find((r) => sameVersion(r.version, version));
        if (!release) return bad('That version was not found on GitHub.');
        if (!release.manifest) return bad(`Version ${version} can't be released: ${release.problem}`);
        if (release.prerelease) return bad('A pre-release can only go to test PCs. Publish it as a normal release on GitHub first.');
      }
      await collection(product, 'Config').doc('updates').set({ releasedVersion: version || null, releasedAt: serverTimestamp(), releasedBy: admin.email }, { merge: true });
      await logEvent(product, version ? 'update-released' : 'update-unreleased', null, { version, by: admin.email });
      return ok();
    },

    async setPaused(body, admin) {
      const paused = body.paused === true;
      await collection(product, 'Config').doc('updates').set({ paused, pausedChangedAt: serverTimestamp() }, { merge: true });
      await logEvent(product, paused ? 'updates-paused' : 'updates-resumed', null, { by: admin.email });
      return ok();
    },
  };
}

export const adminHandler = (product) => {
  const actions = adminActions(product);
  return async (request) => {
    if (request.method !== 'POST') return bad('Method not allowed.', 405);

    let admin;
    try {
      admin = await requireAdmin(request);
    } catch (err) {
      return bad(err.message, err.statusCode || 401);
    }

    const body = (await readJson(request)) || {};
    const handler = Object.prototype.hasOwnProperty.call(actions, body.action) ? actions[body.action] : null;
    if (!handler) return bad('Unknown action.');

    try {
      return await handler(body, admin);
    } catch (err) {
      if (err.statusCode) return bad(err.message, err.statusCode);
      console.error(`${product.id}-admin ${body.action} error:`, err);
      return bad(err.message || 'Server error.', 500);
    }
  };
};
