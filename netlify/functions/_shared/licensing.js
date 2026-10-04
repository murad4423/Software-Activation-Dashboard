// Licensing shared by the desktop apps (USG Reporting under /usg/..., SMRG under /smrg/...). Every function takes the
// product (products.js), which decides the key, the token issuer, the code prefix and the Firestore collections — so
// the two apps share the code but never their data or keys.
//
// Contract with the desktop apps: docs/LICENSE_SERVER_API.md in each app's repository.
// signToken / makeActivationCode are copied from the USG repository's tools/make-license.mjs
// (the reference implementation the app is tested against) — keep them byte-identical.
//
// Firestore layout (prefix "usg" or "smrg"):
//   <p>Devices/{fingerprint}   one record per PC: hospital details, status, end date
//   <p>ResetRequests/{auto}    developer reset requests waiting for approval
//   <p>Events/{auto}           log: activations, renewals, suspensions, resets...
//   <p>Config/settings         { trialDays }
//   <p>Config/counters         { nextHospitalId }
//   <p>Config/updates          { releasedVersion, paused }
//   usgRateLimits/{key}        request counters (all products; SMRG keys start with "smrg:")

import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { getAdmin } from './firebaseAdmin.js';
import { collectionName } from './products.js';

// ----- licence signing (copied from tools/make-license.mjs) -----

const DAY_ZERO = Date.UTC(2020, 0, 1);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STATUS_CODES = { trial: 1, active: 2, expired: 3, suspended: 4 };

const base64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const checkedKeys = new Map(); // product id -> { raw, pem }

/**
 * The licence private key of a product (its environment variable), as a PEM string. Tolerates a paste that lost its
 * line breaks or its BEGIN/END lines, and says exactly what is wrong when it is a public key or the wrong key.
 */
function privateKeyPem(product) {
  const raw = (process.env[product.licenceKeyEnv] || '').replace(/\\n/g, '\n').trim();
  const checked = checkedKeys.get(product.id);
  if (checked && checked.raw === raw) return checked.pem;
  if (!raw) throw new Error(`${product.licenceKeyEnv} is not set. ` + product.licenceKeyHelp);
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(raw);
  const label = m ? m[1] : 'PRIVATE KEY';
  const body = (m ? m[2] : raw).replace(/[^A-Za-z0-9+/=]/g, '');
  if (/PUBLIC/.test(label)) throw new Error(`${product.licenceKeyEnv} contains a PUBLIC key. ` + product.licenceKeyHelp);
  let key;
  try {
    key = createPrivateKey(`-----BEGIN ${label}-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END ${label}-----\n`);
  } catch {
    let isPublic = false;
    try {
      createPublicKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'spki' });
      isPublic = true;
    } catch {
      // neither
    }
    throw new Error(`${product.licenceKeyEnv} is ${isPublic ? 'a PUBLIC key (e.g. a *-public-key.txt file)' : 'not a readable private key (incomplete copy?)'}. ` + product.licenceKeyHelp);
  }
  const publicSpki = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
  if (publicSpki !== product.licencePublicKey) {
    throw new Error(`${product.licenceKeyEnv} is a private key, but not the LICENCE key the ${product.name} app trusts (update-signing key, or the other app's key?). ` + product.licenceKeyHelp);
  }
  const pem = key.export({ type: 'pkcs8', format: 'pem' });
  checkedKeys.set(product.id, { raw, pem });
  return pem;
}

/** ES256 JWT. The signature is the raw 64-byte r||s ("ieee-p1363"), as JWT requires. */
export function signToken(privateKey, { issuer, fingerprint, hospitalId, hospitalName, status, issuedAt, expiresAt }) {
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: issuer,
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

/** The short code typed in by hand: "<prefix>-" + base32 of [version, status, hospital id, issued day, end day, signature]. */
export function makeActivationCode(privateKey, { codePrefix, fingerprint, hospitalId, status, issuedAt, expiresAt }) {
  const fields = Buffer.alloc(10);
  fields[0] = 1;
  fields[1] = STATUS_CODES[status] ?? 2;
  fields.writeUInt32BE(Number(hospitalId) >>> 0, 2);
  fields.writeUInt16BE(Math.floor((issuedAt.getTime() - DAY_ZERO) / 86400000), 6);
  fields.writeUInt16BE(Math.floor((expiresAt.getTime() - DAY_ZERO) / 86400000), 8); // the licence runs to the END of this day (UTC)
  const signed = Buffer.concat([Buffer.from(`${codePrefix}|${fingerprint.toLowerCase()}|`, 'utf8'), fields]);
  const signature = sign('sha256', signed, { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  const encoded = base32(Buffer.concat([fields, signature]));
  return `${codePrefix}-` + encoded.match(/.{1,5}/g).join('-');
}

// ----- device records -> licences -----

export const DEFAULT_TRIAL_DAYS = 30;

const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null);

/** The licence for a device record, exactly as stored now (status + end date set in the dashboard). */
export function licenceFor(product, device) {
  const key = privateKeyPem(product);
  const licence = {
    issuer: product.issuer,
    codePrefix: product.codePrefix,
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

/** A product's Firestore collection, e.g. collection(PRODUCTS.smrg, 'Devices') -> smrgDevices. */
export function collection(product, name) {
  return db().collection(collectionName(product, name));
}

export function serverTimestamp() {
  return getAdmin().firestore.FieldValue.serverTimestamp();
}

export function timestamp(date) {
  return getAdmin().firestore.Timestamp.fromDate(date);
}

export async function getSettings(product) {
  const snap = await collection(product, 'Config').doc('settings').get();
  const data = snap.exists ? snap.data() : {};
  const trialDays = Number(data.trialDays);
  return { trialDays: Number.isFinite(trialDays) && trialDays > 0 ? trialDays : DEFAULT_TRIAL_DAYS };
}

export async function logEvent(product, type, fingerprint, details = {}) {
  try {
    await collection(product, 'Events').add({ type, fingerprint: fingerprint || null, ...details, at: serverTimestamp() });
  } catch (err) {
    console.error(`${product.id} logEvent failed:`, err);
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
export async function findOrCreateDevice(product, { fingerprint, hospital, components, machineName, appVersion, via, ip }) {
  const fp = fingerprint.toLowerCase();
  const firestore = db();
  const ref = collection(product, 'Devices').doc(fp);
  const { trialDays } = await getSettings(product);

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      tx.update(ref, { lastSeenAt: serverTimestamp(), appVersion: appVersion || snap.data().appVersion || '', machineName: machineName || snap.data().machineName || '', lastIp: ip || null });
      return { device: snap.data(), created: false };
    }
    const counterRef = collection(product, 'Config').doc('counters');
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

  await logEvent(product, result.created ? 'trial-started' : 'reactivated', fp, {
    via,
    hospitalName: result.device.hospitalName || '',
    ...(result.created ? { trialDays } : {}),
  });
  return result.device;
}

// ----- rate limiting (fixed window counters in Firestore) -----

/** True when allowed. `key` should be specific, e.g. "activate:ip:1.2.3.4"; the product's prefix is added here. */
export async function rateLimit(product, key, limit, windowSeconds) {
  const firestore = db();
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const id = `${product.rateLimitPrefix}${key}:${windowStart}`.replace(/[\/]/g, '_').slice(0, 400);
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
    console.error(`${product.id} rateLimit failed (allowing):`, err);
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

/** The error shape the desktop apps expect: {"error": code, "message": text shown to the hospital}. */
export function fail(status, error, message) {
  return json(status, { error, message });
}

export const RATE_LIMITED = () => fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
