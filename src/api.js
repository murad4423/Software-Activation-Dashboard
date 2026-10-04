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

// One admin function per desktop app (usg-admin, smrg-admin), see netlify/functions/_shared/handlers.js
export const appAdmin = (app, action, fields) => callFunction(`${app.key}-admin`, { action, ...fields });
