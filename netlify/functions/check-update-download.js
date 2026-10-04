// GET /.netlify/functions/check-update-download?asset=<GitHub asset id>
//
// SMRG app: downloads the installer / .sha256 offered by check-update. Answers a
// redirect to GitHub's short-lived download address, so the (large) file never
// passes through Netlify and GITHUB_TOKEN never leaves the server. Only assets of
// the configured GITHUB_REPO_OWNER/GITHUB_REPO_NAME repo can be reached. The app
// checks the downloaded installer against the .sha256 before running it.

import { jsonResponse } from './_shared/body.js';
import { clientIp, rateLimit } from './_shared/usg.js';

export default async function (request, context) {
  if (request.method !== 'GET') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const asset = new URL(request.url).searchParams.get('asset') || '';
  if (!/^\d{1,15}$/.test(asset)) {
    return jsonResponse(400, { success: false, message: 'Invalid download.' });
  }

  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo) {
    return jsonResponse(500, {
      success: false,
      message: 'Server is not configured: GITHUB_REPO_OWNER / GITHUB_REPO_NAME missing.',
    });
  }

  // Each update fetches 2 assets (.sha256 + .exe); this leaves room for retries.
  if (!(await rateLimit(`smrg-download:ip:${clientIp(request, context)}`, 20, 3600))) {
    return jsonResponse(429, { success: false, message: 'Too many downloads. Please try again later.' });
  }

  try {
    const headers = {
      Accept: 'application/octet-stream',
      'User-Agent': 'SMRG-check-update-function',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset}`,
      { headers, redirect: 'manual' }
    );
    const location = ghResponse.headers.get('location');
    if (ghResponse.status >= 300 && ghResponse.status < 400 && location) {
      return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
    }

    console.error('check-update-download: GitHub answered', ghResponse.status, 'for asset', asset);
    return jsonResponse(502, { success: false, message: 'The update file could not be reached right now.' });
  } catch (err) {
    console.error('check-update-download error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while downloading the update.' });
  }
}
