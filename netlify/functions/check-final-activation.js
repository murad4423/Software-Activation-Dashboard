// GET /.netlify/functions/check-final-activation?requestId=...  ("/checkFinalActivation")
//
// Client polls this after clicking "Check Activation Status". Returns the signed
// license once admin-approve-final.js has run for this request.

import { getAdmin } from './_shared/firebaseAdmin.js';
import { jsonResponse } from './_shared/body.js';

export default async function (request) {
  if (request.method !== 'GET') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const url = new URL(request.url);
  const requestId = url.searchParams.get('requestId');
  if (!requestId) {
    return jsonResponse(400, { success: false, message: 'Missing requestId.' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const snap = await db.collection('activationRequests').doc(requestId).get();

    if (!snap.exists) {
      return jsonResponse(200, { success: false, message: 'Unknown request id.' });
    }

    const data = snap.data();
    if (data.status === 'approved' && data.licenseKey) {
      return jsonResponse(200, { success: true, licenseKey: data.licenseKey });
    }
    if (data.status === 'rejected') {
      return jsonResponse(200, { success: false, message: 'This request was rejected. Please contact us.' });
    }

    return jsonResponse(200, { success: false, message: 'Still waiting for payment confirmation.' });
  } catch (err) {
    console.error('check-final-activation error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while checking status.' });
  }
}
