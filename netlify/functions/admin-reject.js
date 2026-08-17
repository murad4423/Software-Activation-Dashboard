// POST /.netlify/functions/admin-reject
// Body: { requestId: string }

import { getAdmin } from './_shared/firebaseAdmin.js';
import { jsonResponse, parseJsonBody } from './_shared/body.js';
import { requireAdmin } from './_shared/adminAuth.js';

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

    await reqRef.update({ status: 'rejected', rejectedAt: admin.firestore.FieldValue.serverTimestamp() });
    const machineId = snap.data().machineId;
    if (machineId) {
      await db.collection('devices').doc(machineId).set(
        { finalStatus: 'none', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error('admin-reject error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while rejecting.' });
  }
}
