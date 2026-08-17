// Initializes firebase-admin once per function container, using a service account
// JSON stored DIRECTLY (as plain JSON — no base64) in the FIREBASE_SERVICE_ACCOUNT
// environment variable. Never commit the actual key — this file only reads it from
// the environment.

import admin from 'firebase-admin';

export function getAdmin() {
  if (admin.apps.length) return admin;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set (plain service account JSON).');
  }

  const serviceAccount = JSON.parse(raw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
}
