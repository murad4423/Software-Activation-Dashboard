import { auth } from './firebase';

async function callFunction(name, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const token = await user.getIdToken();

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}

export const approveFinal = (requestId, validityDays) =>
  callFunction('admin-approve-final', { requestId, validityDays });

export const rejectRequest = (requestId) => callFunction('admin-reject', { requestId });

export const issueOffline = (qrJson, validityDays) =>
  callFunction('admin-issue-offline', { qrJson, validityDays });
