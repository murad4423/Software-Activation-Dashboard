// POST /.netlify/functions/request-final-activation ("/requestFinalActivation")
//
// Queues the request; does NOT issue a license. The vendor approves manually from
// the dashboard after confirming payment (admin-approve-final.js does the signing).

import { getAdmin } from './_shared/firebaseAdmin.js';
import { parseJsonBody, readActivationRequest, jsonResponse } from './_shared/body.js';

export default async function (request) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const req = readActivationRequest(await parseJsonBody(request));

  if (!req.machineId || !req.requestId) {
    return jsonResponse(400, { success: false, message: 'Missing machine id or request id.' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();

    // Pull institution details from the existing trial record when available, per
    // the "don't ask again at final activation" design — falls back to whatever the
    // client sent if there's no trial record (e.g. a machine that skipped trial).
    const deviceRef = db.collection('devices').doc(req.machineId);
    const deviceSnap = await deviceRef.get();
    const device = deviceSnap.exists ? deviceSnap.data() : null;

    const institutionName = device?.institutionName || req.institutionName;
    const address = device?.address || req.address;
    const userName = device?.userName || req.userName;
    const phoneNumber = device?.phoneNumber || req.phoneNumber;
    const email = device?.email || req.email;

    await db.collection('activationRequests').doc(req.requestId).set({
      requestId: req.requestId,
      machineId: req.machineId,
      kind: 'Final',
      channel: req.channel === 1 ? 'Offline' : 'Online',
      institutionName,
      address,
      userName,
      phoneNumber,
      email,
      appVersion: req.appVersion,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await deviceRef.set(
      {
        finalStatus: 'pending',
        finalRequestId: req.requestId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return jsonResponse(200, {
      success: true,
      message: 'Request received. It will be approved once payment is confirmed.',
    });
  } catch (err) {
    console.error('request-final-activation error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while queuing the request.' });
  }
}
