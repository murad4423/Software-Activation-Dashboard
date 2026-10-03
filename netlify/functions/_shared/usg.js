// Shared code for the USG Reporting app (the NEW desktop app) — everything under /usg/...
//
// Completely separate from the SMRG app's licensing (license.js / body.js / the
// devices + activationRequests collections): different key (ECDSA P-256, not RSA),
// different token format (ES256 JWT + "USG1-" activation code), different Firestore
// collections (usg*). Nothing here reads or writes SMRG data.
//
// Contract with the desktop app: Software Code/docs/LICENSE_SERVER_API.md.
// signToken / makeActivationCode are copied from Software Code/tools/make-license.mjs
// (the reference implementation the app is tested against) — keep them byte-identical.
//
// Firestore layout:
//   usgDevices/{fingerprint}   one record per PC: hospital details, status, end date
//   usgResetRequests/{auto}    developer reset requests waiting for approval
//   usgEvents/{auto}           log: activations, renewals, suspensions, resets...
//   usgConfig/settings         { trialDays }
//   usgConfig/counters         { nextHospitalId }
//   usgConfig/updates          { releasedVersion, paused, testDevices: [fingerprint] }
//   usgRateLimits/{key}        request counters

import { createPrivateKey, sign } from 'node:crypto';
import { getAdmin } from './firebaseAdmin.js';

// ----- licence signing (copied from tools/make-license.mjs) -----

const ISSUER = 'usg-license';
const DAY_ZERO = Date.UTC(2020, 0, 1);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STATUS_CODES = { trial: 1, active: 2, expired: 3, suspended: 4 };

const base64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * The PEM text from USG_LICENSE_PRIVATE_KEY, repaired if pasting lost its line breaks: a value pasted into a
 * one-line field often arrives with spaces or literal "\n" instead of newlines, which crypto can't read.
 */
function privateKeyPem() {
  const raw = (process.env.USG_LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!raw) {
    throw new Error('USG_LICENSE_PRIVATE_KEY env var is not set (PEM text of the USG ECDSA P-256 private key).');
  }
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(raw);
  if (!m) {
    throw new Error('USG_LICENSE_PRIVATE_KEY is not a PEM key: it must contain the -----BEGIN ... PRIVATE KEY----- and -----END ... PRIVATE KEY----- lines.');
  }
  const body = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`;
}

/** ES256 JWT. The signature is the raw 64-byte r||s ("ieee-p1363"), as JWT requires. */
export function signToken(privateKey, { fingerprint, hospitalId, hospitalName, status, issuedAt, expiresAt }) {
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: ISSUER,
      sub: String(hospitalId),
      fp: fingerprint.toLowerCase(),
      status,
      hn: hospitalName ?? undefined,
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    })
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${base64url(signature)}`;
}

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return output;
}

/** The short code typed in by hand: "USG1-" + base32 of [version, status, hospital id, issued day, end day, signature]. */
export function makeActivationCode(privateKey, { fingerprint, hospitalId, status, issuedAt, expiresAt }) {
  const fields = Buffer.alloc(10);
  fields[0] = 1;
  fields[1] = STATUS_CODES[status] ?? 2;
  fields.writeUInt32BE(Number(hospitalId) >>> 0, 2);
  fields.writeUInt16BE(Math.floor((issuedAt.getTime() - DAY_ZERO) / 86400000), 6);
  fields.writeUInt16BE(Math.floor((expiresAt.getTime() - DAY_ZERO) / 86400000), 8); // the licence runs to the END of this day (UTC)
  const signed = Buffer.concat([Buffer.from(`USG1|${fingerprint.toLowerCase()}|`, 'utf8'), fields]);
  const signature = sign('sha256', signed, { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  const encoded = base32(Buffer.concat([fields, signature]));
  return 'USG1-' + encoded.match(/.{1,5}/g).join('-');
}

// ----- device records -> licences -----

export const DEFAULT_TRIAL_DAYS = 30;

const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null);

/** The licence for a device record, exactly as stored now (status + end date set in the dashboard). */
export function licenceFor(device) {
  const key = privateKeyPem();
  const licence = {
    fingerprint: device.fingerprint,
    hospitalId: device.hospitalId,
    hospitalName: device.hospitalName || undefined,
    status: device.status === 'suspended' ? 'suspended' : device.status === 'trial' ? 'trial' : 'active',
    issuedAt: new Date(),
    expiresAt: toDate(device.endAt),
  };
  return { token: signToken(key, licence), code: makeActivationCode(key, licence), status: licence.status, expiresAt: licence.expiresAt.toISOString() };
}

export function db() {
  return getAdmin().firestore();
}

export function serverTimestamp() {
  return getAdmin().firestore.FieldValue.serverTimestamp();
}

export function timestamp(date) {
  return getAdmin().firestore.Timestamp.fromDate(date);
}

export async function getSettings() {
  const snap = await db().collection('usgConfig').doc('settings').get();
  const data = snap.exists ? snap.data() : {};
  const trialDays = Number(data.trialDays);
  return { trialDays: Number.isFinite(trialDays) && trialDays > 0 ? trialDays : DEFAULT_TRIAL_DAYS };
}

export async function logEvent(type, fingerprint, details = {}) {
  try {
    await db().collection('usgEvents').add({ type, fingerprint: fingerprint || null, ...details, at: serverTimestamp() });
  } catch (err) {
    console.error('usg logEvent failed:', err);
  }
}

const HOSPITAL_KEYS = ['hospitalName', 'address', 'phone', 'email', 'contactPerson', 'city'];

/** Only short text values, only known keys plus a few extra the app's license-config.json may add. */
export function cleanHospital(raw) {
  const hospital = {};
  if (!raw || typeof raw !== 'object') return hospital;
  for (const [key, value] of Object.entries(raw).slice(0, 20)) {
    if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) && (typeof value === 'string' || typeof value === 'number')) {
      hospital[key] = String(value).trim().slice(0, 300);
    }
  }
  for (const key of HOSPITAL_KEYS) hospital[key] ??= '';
  return hospital;
}

export function cleanComponents(raw) {
  const components = {};
  if (!raw || typeof raw !== 'object') return components;
  for (const [key, value] of Object.entries(raw).slice(0, 10)) {
    if (/^[a-z]{1,20}$/.test(key) && typeof value === 'string' && /^[0-9a-f]{1,64}$/i.test(value)) components[key] = value.toLowerCase();
  }
  return components;
}

export const isFingerprint = (value) => typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);

/**
 * The record for this PC: the existing one (same PC again, e.g. after reinstalling -> the SAME licence, never a fresh
 * trial), or a new trial record. Transactional, so two parallel requests can't create two trials / two hospital ids.
 */
export async function findOrCreateDevice({ fingerprint, hospital, components, machineName, appVersion, via, ip }) {
  const fp = fingerprint.toLowerCase();
  const firestore = db();
  const ref = firestore.collection('usgDevices').doc(fp);
  const { trialDays } = await getSettings();

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      tx.update(ref, { lastSeenAt: serverTimestamp(), appVersion: appVersion || snap.data().appVersion || '', machineName: machineName || snap.data().machineName || '', lastIp: ip || null });
      return { device: snap.data(), created: false };
    }
    const counterRef = firestore.collection('usgConfig').doc('counters');
    const counter = await tx.get(counterRef);
    const hospitalId = counter.exists && Number(counter.data().nextHospitalId) > 0 ? Number(counter.data().nextHospitalId) : 1001;
    const now = new Date();
    const endAt = new Date(now.getTime() + trialDays * 86400000);
    const device = {
      fingerprint: fp,
      hospitalId,
      hospitalName: hospital.hospitalName || '',
      hospital,
      components: components || {},
      machineName: machineName || '',
      appVersion: appVersion || '',
      status: 'trial',
      plan: 'trial',
      trialStartAt: timestamp(now),
      trialEndAt: timestamp(endAt),
      endAt: timestamp(endAt),
      activatedVia: via,
      testDevice: false,
      note: '',
      lastIp: ip || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    };
    tx.set(counterRef, { nextHospitalId: hospitalId + 1 }, { merge: true });
    tx.set(ref, device);
    return { device: { ...device, endAt: endAt }, created: true };
  });

  await logEvent(result.created ? 'trial-started' : 'reactivated', fp, {
    via,
    hospitalName: result.device.hospitalName || '',
    ...(result.created ? { trialDays } : {}),
  });
  return result.device;
}

// ----- rate limiting (fixed window counters in Firestore) -----

/** True when allowed. `key` should be specific, e.g. "activate:ip:1.2.3.4". */
export async function rateLimit(key, limit, windowSeconds) {
  const firestore = db();
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const id = `${key}:${windowStart}`.replace(/[\/]/g, '_').slice(0, 400);
  const ref = firestore.collection('usgRateLimits').doc(id);
  try {
    return await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? Number(snap.data().count) || 0 : 0;
      if (count >= limit) return false;
      tx.set(ref, { count: count + 1, expiresAt: timestamp(new Date((windowStart + windowSeconds) * 1000 + 86400000)) });
      return true;
    });
  } catch (err) {
    console.error('usg rateLimit failed (allowing):', err);
    return true; // never lock hospitals out because the counter itself failed
  }
}

// ----- HTTP helpers -----

export function clientIp(request, context) {
  return context?.ip || request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > 20000) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** The error shape the desktop app expects: {"error": code, "message": text shown to the hospital}. */
export function fail(status, error, message) {
  return json(status, { error, message });
}

export const RATE_LIMITED = () => fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
