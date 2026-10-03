// GET /usg/api/update/download?asset=<GitHub asset id>  (USG app: downloads the package offered by /usg/api/update)
//
// Answers a redirect to GitHub's short-lived download address, so the (large) file never passes through Netlify and
// the GitHub token never leaves the server. Only assets of the configured USG repository can be reached.
// The app checks the downloaded file against the signed SHA-256, so the redirect target can't swap the file.

import { clientIp, fail, logEvent, rateLimit, RATE_LIMITED } from './_shared/usg.js';
import { assetDownloadLocation } from './_shared/usgReleases.js';

export default async function (request, context) {
  if (request.method !== 'GET') return fail(405, 'invalid_request', 'Method not allowed.');

  const asset = new URL(request.url).searchParams.get('asset') || '';
  if (!/^\d{1,15}$/.test(asset)) return fail(400, 'invalid_request', 'Invalid download.');
  const ip = clientIp(request, context);
  if (!(await rateLimit(`download:ip:${ip}`, 20, 3600))) return RATE_LIMITED();

  try {
    const location = await assetDownloadLocation(asset);
    await logEvent('update-download', null, { asset, ip });
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('usg-update-download error:', err);
    return fail(502, 'server_error', 'The update file could not be reached right now. Please try again later.');
  }
}
