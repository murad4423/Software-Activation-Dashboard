// GET /.netlify/functions/check-update
//
// Called by the C# app's UpdateApiClient.CheckForUpdateAsync(). Asks GitHub for
// the latest Release on this repo, and returns the installer .exe URL + .sha256
// checksum URL + version + release notes in the shape UpdateApiClient expects:
//   { success, message, version, downloadUrl, checksumUrl, releaseNotes }
//
// Needs these Environment Variables set in Netlify (Site settings -> Environment
// variables):
//   GITHUB_REPO_OWNER  - e.g. "murad4423"
//   GITHUB_REPO_NAME   - the repo where you publish Releases with the exe + sha256
//   GITHUB_TOKEN       - required if that repo is PRIVATE (fine-grained token,
//                        read-only "Contents" on that repo).
//
// Release asset naming: this function picks the first asset ending in ".exe" as
// the installer, and the first asset ending in ".sha256" as the checksum file.
// Attach exactly one of each to every GitHub Release.
//
// downloadUrl / checksumUrl point at check-update-download on THIS site, not at
// GitHub: a private repo's browser_download_url answers 404 without a token, and
// the app downloads without one. check-update-download redirects to GitHub's
// short-lived download address, so the token never leaves the server.

import { jsonResponse } from './_shared/body.js';

export default async function (request) {
  if (request.method !== 'GET') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const token = process.env.GITHUB_TOKEN; // optional, only for private repos

  if (!owner || !repo) {
    return jsonResponse(500, {
      success: false,
      message: 'Server is not configured: GITHUB_REPO_OWNER / GITHUB_REPO_NAME missing.',
    });
  }

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SMRG-check-update-function',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      { headers }
    );

    if (ghResponse.status === 404) {
      // A private repo also answers 404 when GITHUB_TOKEN is missing/expired or
      // can't read it - log which repo was asked so that's easy to spot.
      console.error(`check-update: GitHub 404 for ${owner}/${repo} (token set: ${Boolean(token)})`);
      return jsonResponse(200, {
        success: false,
        message: 'No release has been published yet.',
      });
    }

    if (!ghResponse.ok) {
      const text = await ghResponse.text();
      console.error('check-update: GitHub API error', ghResponse.status, text);
      return jsonResponse(200, {
        success: false,
        message: `Could not reach GitHub (status ${ghResponse.status}).`,
      });
    }

    const release = await ghResponse.json();

    // Version: tag is usually "v1.1.0" -> strip a leading "v" so it matches the
    // app's own <Version>1.1.0</Version> format for comparison.
    const rawTag = release.tag_name || '';
    const version = rawTag.replace(/^v/i, '');

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exeAsset = assets.find((a) => a.name?.toLowerCase().endsWith('.exe'));
    const shaAsset = assets.find((a) => a.name?.toLowerCase().endsWith('.sha256'));

    if (!version || !exeAsset) {
      return jsonResponse(200, {
        success: false,
        message: 'Latest release is missing a version tag or an .exe asset.',
      });
    }

    const downloadBase = `${new URL(request.url).origin}/.netlify/functions/check-update-download?asset=`;

    return jsonResponse(200, {
      success: true,
      version,
      downloadUrl: downloadBase + exeAsset.id,
      checksumUrl: shaAsset ? downloadBase + shaAsset.id : null,
      releaseNotes: release.body || '',
    });
  } catch (err) {
    console.error('check-update error:', err);
    return jsonResponse(500, { success: false, message: 'Server error while checking for updates.' });
  }
}
