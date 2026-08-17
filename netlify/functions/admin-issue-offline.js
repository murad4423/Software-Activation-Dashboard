// POST /.netlify/functions/admin-issue-offline
// Body: { qrJson: string, validityDays?: number }
//
// Used by the "Offline Request Entry" tab: you scan/paste the QR content the app
// generated (see QrCodeHelper.EncodeRequestToJson - compact keys i/a/n/p/e/m/k/r/v/t),
// this decodes it, runs the same trial-abuse check as the online path (for Trial
// requests), signs a license, and returns the key string for you to copy to the
// customer. No internet round trip on the client side is needed for this flow —
// only you (the admin) need to be online.

import { getAdmin } from './_shared/firebaseAdmin.js';
import { signLicense } from './_shared/license.js';
import { jsonResponse, parseJsonBody } from './_shared/body.js';
import { requireAdmin } from './_shared/adminAuth.js';

const TRIAL_DURATION_DAYS = 30;
const DEFAULT_FINAL_VALIDITY_DAYS = Number(process.env.FINAL_LICENSE_VALIDITY_DAYS || 3650);

function decodeQrJson(qrJson) {
  const compact = JSON.parse(qrJson);
  return {
    institutionName: compact.i || '',
    address: compact.a || '',
    userName: compact.n || '',
    phoneNumber: compact.p || '',
    email: compact.e || '',
    machineId: compact.m || '',
    kind: compact.k || 'Trial', // "Trial" | "Final"
    requestId: compact.r || '',
    appVersion: compact.v || '',
    createdUtc: compact.t || new Date().toISOString(),
  };
}

export default async function (request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  try {
    await requireAdmin(request);
  } catch (err) {
    return jsonResponse(err.statusCode || 401, { success: false, message: err.message });
  }

  const body = await parseJsonBody(request);
  let req;
  try {
    req = decodeQrJson(body.qrJson);
  } catch {
    return jsonResponse(400, { success: false, message: 'Could not parse the pasted QR/JSON content.' });
  }
  if (!req.machineId) {
    return jsonResponse(400, { success: false, message: 'Decoded data has no machine id.' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const deviceRef = db.collection('devices').doc(req.machineId);
    const deviceSnap = await deviceRef.get();
    const device = deviceSnap.exists ? deviceSnap.data() : null;

    const now = new Date();

    if (req.kind === 'Trial') {
      if (device && device.trialLicenseId) {
        return jsonResponse(200, {
          success: false,
          message: 'This machine has already used its trial (found existing trial record).',
        });
      }

      const expiry = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const licenseId = db.collection('_ids').doc().id;
      const licenseKey = signLicense({
        licenseId,
        machineId: req.machineId,
        kind: 'Trial',
        issuedUtc: now,
        expiryUtc: expiry,
        institutionName: req.institutionName,
      });

      await deviceRef.set(
        {
          machineId: req.machineId,
          institutionName: req.institutionName,
          address: req.address,
          userName: req.userName,
          phoneNumber: req.phoneNumber,
          email: req.email,
          appVersion: req.appVersion,
          trialStartUtc: admin.firestore.Timestamp.fromDate(now),
          trialEndUtc: admin.firestore.Timestamp.fromDate(expiry),
          trialLicenseId: licenseId,
          finalStatus: device?.finalStatus || 'none',
          createdAt: device ? device.createdAt : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return jsonResponse(200, { success: true, licenseKey });
    }

    // Final (offline, manually approved on the spot after payment)
    const validityDays = Number(body.validityDays || DEFAULT_FINAL_VALIDITY_DAYS);
    const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
    const licenseId = db.collection('_ids').doc().id;
    const institutionName = device?.institutionName || req.institutionName;

    const licenseKey = signLicense({
      licenseId,
      machineId: req.machineId,
      kind: 'Final',
      issuedUtc: now,
      expiryUtc: expiry,
      institutionName,
    });

    await deviceRef.set(
      {
        machineId: req.machineId,
        institutionName,
        address: device?.address || req.address,
        userName: device?.userName || req.userName,
        phoneNumber: device?.phoneNumber || req.phoneNumber,
        email: device?.email || req.email,
        appVersion: req.appVersion,
        finalStatus: 'approved',
        finalLicenseId: licenseId,
        finalLicenseExpiryUtc: admin.firestore.Timestamp.fromDate(expiry),
        createdAt: device ? device.createdAt : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return jsonResponse(200, { success: true, licenseKey });
  } catch (err) {
    console.error('admin-issue-offline error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while issuing offline license.' });
  }
}
