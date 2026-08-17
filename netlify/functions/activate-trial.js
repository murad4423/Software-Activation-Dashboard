// POST /.netlify/functions/activate-trial  (client calls it as "/activateTrial" via
// the redirect rule in netlify.toml)
//
// Fully automatic: checks the machine fingerprint against prior trial records, and
// if this machine hasn't had a trial yet, issues a signed 30-day trial license
// immediately. No manual approval — matches the agreed design.

import { getAdmin } from './_shared/firebaseAdmin.js';
import { signLicense } from './_shared/license.js';
import { parseJsonBody, readActivationRequest, jsonResponse } from './_shared/body.js';

const TRIAL_DURATION_DAYS = 30; // keep in sync with LicenseManager.TrialDurationDays in the C# app

export default async function (request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const req = readActivationRequest(await parseJsonBody(request));

  if (!req.machineId) {
    return jsonResponse(400, { success: false, message: 'Missing machine id.' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const deviceRef = db.collection('devices').doc(req.machineId);

    // Abuse prevention: one trial per machine fingerprint, ever (uninstall/reinstall
    // does not reset this, since it's keyed server-side, not on local app state).
    const existing = await deviceRef.get();
    if (existing.exists && existing.data().trialLicenseId) {
      return jsonResponse(200, {
        success: false,
        message: 'This computer has already used its trial. Please contact us for a paid license.',
      });
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const licenseId = db.collection('_ids').doc().id; // random id, no extra doc created

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
        finalStatus: 'none',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return jsonResponse(200, { success: true, licenseKey });
  } catch (err) {
    console.error('activate-trial error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while issuing trial license.' });
  }
}
