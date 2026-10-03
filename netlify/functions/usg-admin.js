// POST /.netlify/functions/usg-admin   (dashboard only — requires the admin login, same check as the SMRG admin functions)
// Body: { action, ...fields }. Every change is written to usgEvents.
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

import { requireAdmin } from './_shared/adminAuth.js';
import { db, getSettings, isFingerprint, json, licenceFor, logEvent, readJson, serverTimestamp, timestamp } from './_shared/usg.js';
import { listReleases, sameVersion } from './_shared/usgReleases.js';

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

async function deviceRef(fingerprint) {
  if (!isFingerprint(fingerprint)) throw Object.assign(new Error('Invalid PC fingerprint.'), { statusCode: 400 });
  const ref = db().collection('usgDevices').doc(fingerprint.toLowerCase());
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('This PC is not registered (it may have been reset).'), { statusCode: 404 });
  return { ref, device: snap.data() };
}

const actions = {
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
    await logEvent('renewed', device.fingerprint, {
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
    await logEvent('end-date-set', device.fingerprint, { to: endAt.toISOString(), by: admin.email, hospitalName: device.hospitalName || '' });
    return ok({ endAt: endAt.toISOString() });
  },

  async suspend(body, admin) {
    const { ref, device } = await deviceRef(body.fingerprint);
    if (device.status === 'suspended') return ok();
    await ref.update({ status: 'suspended', statusBeforeSuspend: device.status, suspendReason: String(body.reason || '').slice(0, 300), updatedAt: serverTimestamp() });
    await logEvent('suspended', device.fingerprint, { reason: String(body.reason || '').slice(0, 300), by: admin.email, hospitalName: device.hospitalName || '' });
    return ok();
  },

  async unsuspend(body, admin) {
    const { ref, device } = await deviceRef(body.fingerprint);
    if (device.status !== 'suspended') return ok();
    const status = device.statusBeforeSuspend === 'trial' ? 'trial' : 'active';
    await ref.update({ status, suspendReason: '', updatedAt: serverTimestamp() });
    await logEvent('unsuspended', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
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
    await logEvent(body.value === true ? 'test-pc-on' : 'test-pc-off', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
    return ok();
  },

  async licence(body) {
    const { device } = await deviceRef(body.fingerprint);
    return ok(licenceFor(device));
  },

  async deleteDevice(body, admin) {
    const { ref, device } = await deviceRef(body.fingerprint);
    await db().collection('usgDeletedDevices').add({ ...device, deletedAt: serverTimestamp(), deletedBy: admin.email });
    await ref.delete();
    await logEvent('device-reset', device.fingerprint, { by: admin.email, hospitalName: device.hospitalName || '' });
    return ok();
  },

  async approveReset(body, admin) {
    const reqRef = db().collection('usgResetRequests').doc(String(body.requestId || 'x'));
    const snap = await reqRef.get();
    if (!snap.exists) return bad('Request not found.', 404);
    const request = snap.data();
    const ref = db().collection('usgDevices').doc(request.fingerprint);
    const device = await ref.get();
    if (device.exists) {
      await db().collection('usgDeletedDevices').add({ ...device.data(), deletedAt: serverTimestamp(), deletedBy: admin.email, resetRequestId: snap.id });
      await ref.delete();
    }
    await reqRef.update({ status: 'approved', decidedAt: serverTimestamp(), decidedBy: admin.email });
    await logEvent('device-reset', request.fingerprint, { by: admin.email, viaRequest: snap.id, hospitalName: request.hospitalName || '' });
    return ok();
  },

  async dismissReset(body, admin) {
    const reqRef = db().collection('usgResetRequests').doc(String(body.requestId || 'x'));
    if (!(await reqRef.get()).exists) return bad('Request not found.', 404);
    await reqRef.update({ status: 'dismissed', decidedAt: serverTimestamp(), decidedBy: admin.email });
    return ok();
  },

  async saveSettings(body, admin) {
    const trialDays = Number(body.trialDays);
    if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365) return bad('Trial days must be a whole number from 1 to 365.');
    await db().collection('usgConfig').doc('settings').set({ trialDays, updatedAt: serverTimestamp() }, { merge: true });
    await logEvent('settings-changed', null, { trialDays, by: admin.email });
    return ok({ settings: await getSettings() });
  },

  async releases(body) {
    const [releases, config] = await Promise.all([listReleases({ fresh: body.fresh === true }), db().collection('usgConfig').doc('updates').get()]);
    const repo = `${process.env.USG_GITHUB_OWNER || '?'}/${process.env.USG_GITHUB_REPO || '?'}`;
    return ok({ repo, releases, config: config.exists ? config.data() : {} });
  },

  async setReleased(body, admin) {
    const version = String(body.version || '');
    if (version) {
      const release = (await listReleases({ fresh: true })).find((r) => sameVersion(r.version, version));
      if (!release) return bad('That version was not found on GitHub.');
      if (!release.manifest) return bad(`Version ${version} can't be released: ${release.problem}`);
      if (release.prerelease) return bad('A pre-release can only go to test PCs. Publish it as a normal release on GitHub first.');
    }
    await db().collection('usgConfig').doc('updates').set({ releasedVersion: version || null, releasedAt: serverTimestamp(), releasedBy: admin.email }, { merge: true });
    await logEvent(version ? 'update-released' : 'update-unreleased', null, { version, by: admin.email });
    return ok();
  },

  async setPaused(body, admin) {
    const paused = body.paused === true;
    await db().collection('usgConfig').doc('updates').set({ paused, pausedChangedAt: serverTimestamp() }, { merge: true });
    await logEvent(paused ? 'updates-paused' : 'updates-resumed', null, { by: admin.email });
    return ok();
  },
};

export default async function (request) {
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
    console.error(`usg-admin ${body.action} error:`, err);
    return bad(err.message || 'Server error.', 500);
  }
}
