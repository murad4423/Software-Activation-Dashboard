// POST /.netlify/functions/activate-offline-trial  (public, no login required)
//
// Called by the public "/activate" web page that opens when someone scans the
// Offline-Activation QR code with their phone. Body: { qrJson: string } where
// qrJson is EXACTLY the compact string produced by QrCodeHelper.EncodeRequestToJson
// on the desktop app (keys i/a/n/p/e/m/k/r/v/t).
//
// SAFETY: this endpoint only ever issues Trial licenses. If the decoded request's
// kind is "Final", it is rejected outright — premium/final activation must still go
// through the existing manual-approval flow (request-final-activation.js +
// admin-approve-final.js). Do not extend this function to handle Final requests.
//
// Otherwise this runs the exact same abuse-prevention + signing logic as the
// existing online trial flow (activate-trial.js): one trial per machine id, ever.

import { getAdmin } from './_shared/firebaseAdmin.js';
import { signLicense } from './_shared/license.js';
import { jsonResponse, parseJsonBody } from './_shared/body.js';

const TRIAL_DURATION_DAYS = 30; // keep in sync with LicenseManager.TrialDurationDays in the C# app

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

  const body = await parseJsonBody(request);
  let req;
  try {
    req = decodeQrJson(body.qrJson);
  } catch {
    return jsonResponse(400, { success: false, message: 'Could not read the scanned code. Please rescan.' });
  }

  if (!req.machineId) {
    return jsonResponse(400, { success: false, message: 'This code has no machine id. Please rescan from the app.' });
  }

  // Hard guard: this public, unauthenticated endpoint must NEVER issue a Final/paid
  // license. Only the admin-approved flow may do that.
  if (req.kind === 'Final') {
    return jsonResponse(200, {
      success: false,
      message: 'This is a full/premium activation request. Please complete payment and contact us — it will be approved from the admin dashboard.',
    });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const deviceRef = db.collection('devices').doc(req.machineId);
    const deviceSnap = await deviceRef.get();
    const device = deviceSnap.exists ? deviceSnap.data() : null;

    if (device && device.trialLicenseId) {
      return jsonResponse(200, {
        success: false,
        message: 'This computer has already used its trial. Please contact us for a full license.',
      });
    }

    const now = new Date();
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
        issuedVia: 'offline-qr-self-serve',
        createdAt: device ? device.createdAt : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return jsonResponse(200, {
      success: true,
      licenseKey,
      institutionName: req.institutionName,
      machineId: req.machineId,
      expiryUtc: expiry.toISOString(),
    });
  } catch (err) {
    console.error('activate-offline-trial error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while issuing trial license.' });
  }
}
