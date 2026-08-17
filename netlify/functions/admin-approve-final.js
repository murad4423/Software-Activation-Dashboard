// POST /.netlify/functions/admin-approve-final
// Body: { requestId: string, validityDays?: number }
// Called from the dashboard after you've confirmed payment for a pending Final
// (Online) activation request. Signs a Final license and stores it on the request,
// so the client's next "Check Activation Status" poll picks it up.

import { getAdmin } from './_shared/firebaseAdmin.js';
import { signLicense } from './_shared/license.js';
import { jsonResponse, parseJsonBody } from './_shared/body.js';
import { requireAdmin } from './_shared/adminAuth.js';

// Default validity for a paid/final license if the dashboard doesn't specify one.
// Change this (or pass validityDays per-approval from the dashboard) to match
// whatever your actual licensing model is — perpetual, annual, etc.
const DEFAULT_FINAL_VALIDITY_DAYS = Number(process.env.FINAL_LICENSE_VALIDITY_DAYS || 3650);

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
  const requestId = body.requestId;
  const validityDays = Number(body.validityDays || DEFAULT_FINAL_VALIDITY_DAYS);

  if (!requestId) {
    return jsonResponse(400, { success: false, message: 'Missing requestId.' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const reqRef = db.collection('activationRequests').doc(requestId);
    const snap = await reqRef.get();

    if (!snap.exists) {
      return jsonResponse(404, { success: false, message: 'Request not found.' });
    }
    const data = snap.data();
    if (data.status === 'approved') {
      return jsonResponse(200, { success: true, message: 'Already approved.', licenseKey: data.licenseKey });
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
    const licenseId = db.collection('_ids').doc().id;

    const licenseKey = signLicense({
      licenseId,
      machineId: data.machineId,
      kind: 'Final',
      issuedUtc: now,
      expiryUtc: expiry,
      institutionName: data.institutionName,
    });

    await reqRef.update({
      status: 'approved',
      licenseKey,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('devices').doc(data.machineId).set(
      {
        finalStatus: 'approved',
        finalLicenseId: licenseId,
        finalLicenseExpiryUtc: admin.firestore.Timestamp.fromDate(expiry),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return jsonResponse(200, { success: true, licenseKey });
  } catch (err) {
    console.error('admin-approve-final error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while approving.' });
  }
}
