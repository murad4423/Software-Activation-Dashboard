import { getAdmin } from './firebaseAdmin.js';

/**
 * Verifies the "Authorization: Bearer <Firebase ID token>" header on admin-only
 * endpoints, AND checks the token's email against ADMIN_EMAIL. This is a second
 * layer on top of Firebase Auth itself (which already restricts to accounts you
 * create) so a leaked/expired allow-list of "who can log in" is never the only gate.
 *
 * Returns the decoded token on success, or throws with a { statusCode } you can
 * pass straight through to the Netlify response.
 */
export async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    const err = new Error('Missing bearer token.');
    err.statusCode = 401;
    throw err;
  }

  const admin = getAdmin();
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    const err = new Error('Invalid or expired token.');
    err.statusCode = 401;
    throw err;
  }

  const allowedEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (allowedEmail && (decoded.email || '').toLowerCase() !== allowedEmail) {
    const err = new Error('Not authorized.');
    err.statusCode = 403;
    throw err;
  }

  return decoded;
}
