// USG app updates: reads the releases of the USG GitHub repository (the token stays here on the server, so the
// repository can be private), and checks each release's signature file.
//
// The repository may be the app's main code repository; its releases may hold other files too (e.g. an installer
// .exe for new installations). For updates, each release must have these two assets (made by
// Software Code/tools/sign-update.mjs on the developer PC):
//   <name>.zip       the app package
//   <name>.zip.sig   {"format":"usg-update-1","version","file","size","sha256","signature"}
// signature = ECDSA P-256 / SHA-256 (r||s, base64) over UTF-8 "USGUPD1|<version>|<size>|<sha256>", made with the
// UPDATE-SIGNING private key, which never leaves the developer PC. The app verifies it with the public key built into
// it, so neither this server nor GitHub can push a package the developer did not sign.
//
// Env: USG_GITHUB_OWNER, USG_GITHUB_REPO, USG_GITHUB_TOKEN (fine-grained token, read-only "Contents" on that repo;
// recommended even for a public repo — without it GitHub allows only 60 requests/hour).

import { createPublicKey, verify } from 'node:crypto';

/** Same public key as UpdateSignature.PublicKeySpki in the app — used here only to warn in the dashboard. */
const UPDATE_PUBLIC_KEY_SPKI =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErcZN7PxFoA8+U+tSb98Ff9EPIc+RuJULYu0gBvDRDeGDnAXTlW+IvGGz60CNiWUm0i1eF0GRR782f8VLPUOIqQ==';

const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { at, releases }

function repoConfig() {
  const owner = process.env.USG_GITHUB_OWNER;
  const repo = process.env.USG_GITHUB_REPO;
  if (!owner || !repo) throw new Error('USG_GITHUB_OWNER / USG_GITHUB_REPO are not set in Netlify.');
  return { owner, repo, token: process.env.USG_GITHUB_TOKEN };
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': 'usg-update-server', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** "v1.2.0" / "1.2" -> [1,2,0,0]; null if not a version. */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text || ''));
  return m ? [m[1], m[2], m[3] || 0, m[4] || 0].map(Number) : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a) || [0, 0, 0, 0];
  const y = parseVersion(b) || [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export const sameVersion = (a, b) => parseVersion(a) !== null && compareVersions(a, b) === 0;

function verifyManifest(manifest) {
  try {
    const message = Buffer.from(`USGUPD1|${manifest.version}|${manifest.size}|${manifest.sha256}`, 'utf8');
    const key = createPublicKey({ key: Buffer.from(UPDATE_PUBLIC_KEY_SPKI, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(manifest.signature, 'base64'));
  } catch {
    return false;
  }
}

async function fetchAssetText(owner, repo, token, assetId) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: githubHeaders(token, 'application/octet-stream'),
  });
  if (!res.ok) throw new Error(`GitHub asset ${assetId}: ${res.status}`);
  const text = await res.text();
  if (text.length > 10000) throw new Error('signature file too large');
  return text;
}

/**
 * All non-draft releases (newest first) with their package + signature check:
 * { id, tag, version, name, notes, publishedAt, prerelease, zip: {id,name,size}|null, manifest|null, problem|null }
 */
export async function listReleases({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.releases;
  const { owner, repo, token } = repoConfig();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, { headers: githubHeaders(token) });
  if (!res.ok) {
    throw new Error(res.status === 404 ? `GitHub repository ${owner}/${repo} not found (or the token can't read it).` : `GitHub answered ${res.status}.`);
  }
  const raw = await res.json();
  const releases = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (r.draft || !parseVersion(r.tag_name)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    // A release may also carry other files (installer .exe, other zips...): the package is the .zip that has a
    // matching .zip.sig; without one, the first .zip (reported as "not signed").
    const sigFor = (zipAsset) => assets.find((a) => (a.name || '').toLowerCase() === `${zipAsset.name}.sig`.toLowerCase());
    const zips = assets.filter((a) => /\.zip$/i.test(a.name || ''));
    const zip = zips.find(sigFor) || zips[0];
    const sig = zip && sigFor(zip);
    const release = {
      id: r.id,
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/i, ''),
      name: r.name || r.tag_name,
      notes: r.body || '',
      publishedAt: r.published_at,
      prerelease: !!r.prerelease,
      zip: zip ? { id: zip.id, name: zip.name, size: zip.size } : null,
      manifest: null,
      problem: null,
    };
    if (!zip) release.problem = 'No .zip package attached.';
    else if (!sig) release.problem = `No ${zip.name}.sig attached (run tools/sign-update.mjs).`;
    else {
      try {
        const m = JSON.parse(await fetchAssetText(owner, repo, token, sig.id));
        const manifest = { version: String(m.version || ''), file: String(m.file || ''), size: Number(m.size), sha256: String(m.sha256 || '').toLowerCase(), signature: String(m.signature || '') };
        if (m.format !== 'usg-update-1' || !/^[0-9a-f]{64}$/.test(manifest.sha256) || !(manifest.size > 0)) release.problem = 'The .sig file is not valid.';
        else if (!verifyManifest(manifest)) release.problem = 'The signature does not match the update-signing key.';
        else if (!sameVersion(manifest.version, release.version)) release.problem = `Signed for version ${manifest.version}, but the tag is ${release.tag}.`;
        else if (manifest.size !== zip.size) release.problem = 'The .zip on GitHub is not the file that was signed (size differs).';
        else release.manifest = manifest;
      } catch (err) {
        release.problem = 'The .sig file could not be read: ' + err.message;
      }
    }
    releases.push(release);
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  cache = { at: Date.now(), releases };
  return releases;
}

/** A short-lived direct download address for a package asset (GitHub answers a redirect; the token never leaves). */
export async function assetDownloadLocation(assetId) {
  const { owner, repo, token } = repoConfig();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: githubHeaders(token, 'application/octet-stream'),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) return res.headers.get('location');
  throw new Error(`GitHub did not give a download address (${res.status}).`);
}
