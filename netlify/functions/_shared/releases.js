// App updates: reads the releases of a product's GitHub repository (the token stays here on the server, so the
// repository can be private), and checks each release's signature file.
//
// The repository may be the app's main code repository; its releases may hold other files too. For updates, each
// release must have these two assets (the package type is the product's packageExtension, see products.js):
//   USG:  <name>.zip   + <name>.zip.sig   (made by the USG repository's tools/sign-update.mjs)
//   SMRG: <name>.exe   + <name>.exe.sig   (made by the SMRG repository's scripts/sign-update.mjs)
// .sig = {"format","version","file","size","sha256","signature"}
// signature = ECDSA P-256 / SHA-256 (r||s, base64) over UTF-8 "<updateMessagePrefix>|<version>|<size>|<sha256>",
// made with the product's UPDATE-SIGNING private key, which never leaves the developer PC. The app verifies it with
// the public key built into it, so neither this server nor GitHub can push a package the developer did not sign.
//
// Env per product (products.js -> github): USG_GITHUB_OWNER / USG_GITHUB_REPO / USG_GITHUB_TOKEN for USG,
// GITHUB_REPO_OWNER / GITHUB_REPO_NAME / GITHUB_TOKEN for SMRG. Token: fine-grained, read-only "Contents" on that
// repo (recommended even for a public repo — without it GitHub allows only 60 requests/hour).

import { createPublicKey, verify } from 'node:crypto';

const CACHE_MS = 5 * 60 * 1000;
const caches = new Map(); // product id -> { at, releases }

function repoConfig(product) {
  const { ownerEnv, repoEnv, tokenEnv } = product.github;
  const owner = process.env[ownerEnv];
  const repo = process.env[repoEnv];
  if (!owner || !repo) throw new Error(`${ownerEnv} / ${repoEnv} are not set in Netlify.`);
  return { owner, repo, token: process.env[tokenEnv] };
}

/** "owner/repo" as configured for a product (for the dashboard), "?" where not set. */
export function repoLabel(product) {
  const { ownerEnv, repoEnv } = product.github;
  return `${process.env[ownerEnv] || '?'}/${process.env[repoEnv] || '?'}`;
}

function githubHeaders(product, token, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': product.userAgent, 'X-GitHub-Api-Version': '2022-11-28' };
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

function verifyManifest(product, manifest) {
  try {
    const message = Buffer.from(`${product.updateMessagePrefix}|${manifest.version}|${manifest.size}|${manifest.sha256}`, 'utf8');
    const key = createPublicKey({ key: Buffer.from(product.updatePublicKey, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(manifest.signature, 'base64'));
  } catch {
    return false;
  }
}

async function fetchAssetText(product, owner, repo, token, assetId) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: githubHeaders(product, token, 'application/octet-stream'),
  });
  if (!res.ok) throw new Error(`GitHub asset ${assetId}: ${res.status}`);
  const text = await res.text();
  if (text.length > 10000) throw new Error('signature file too large');
  return text;
}

/**
 * All non-draft releases (newest first) with their package + signature check:
 * { id, tag, version, name, notes, publishedAt, prerelease, zip: {id,name,size}|null, manifest|null, problem|null }
 * ("zip" is the update package, whatever its type — the dashboard and USG app already use that name.)
 */
export async function listReleases(product, { fresh = false } = {}) {
  const cache = caches.get(product.id);
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.releases;
  const { owner, repo, token } = repoConfig(product);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, { headers: githubHeaders(product, token) });
  if (!res.ok) {
    throw new Error(res.status === 404 ? `GitHub repository ${owner}/${repo} not found (or the token can't read it).` : `GitHub answered ${res.status}.`);
  }
  const raw = await res.json();
  const ext = product.packageExtension.toLowerCase();
  const releases = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (r.draft || !parseVersion(r.tag_name)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    // A release may also carry other files: the package is the one that has a matching .sig; without one, the
    // first package-type file (reported as "not signed").
    const sigFor = (pkg) => assets.find((a) => (a.name || '').toLowerCase() === `${pkg.name}.sig`.toLowerCase());
    const packages = assets.filter((a) => (a.name || '').toLowerCase().endsWith(ext));
    const pkg = packages.find(sigFor) || packages[0];
    const sig = pkg && sigFor(pkg);
    const release = {
      id: r.id,
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/i, ''),
      name: r.name || r.tag_name,
      notes: r.body || '',
      publishedAt: r.published_at,
      prerelease: !!r.prerelease,
      zip: pkg ? { id: pkg.id, name: pkg.name, size: pkg.size } : null,
      manifest: null,
      problem: null,
    };
    if (!pkg) release.problem = `No ${ext} package attached.`;
    else if (!sig) release.problem = `No ${pkg.name}.sig attached (run ${product.signTool}).`;
    else {
      try {
        const m = JSON.parse(await fetchAssetText(product, owner, repo, token, sig.id));
        const manifest = { version: String(m.version || ''), file: String(m.file || ''), size: Number(m.size), sha256: String(m.sha256 || '').toLowerCase(), signature: String(m.signature || '') };
        if (m.format !== product.updateManifestFormat || !/^[0-9a-f]{64}$/.test(manifest.sha256) || !(manifest.size > 0)) release.problem = 'The .sig file is not valid.';
        else if (!verifyManifest(product, manifest)) release.problem = 'The signature does not match the update-signing key.';
        else if (!sameVersion(manifest.version, release.version)) release.problem = `Signed for version ${manifest.version}, but the tag is ${release.tag}.`;
        else if (manifest.size !== pkg.size) release.problem = `The ${ext} on GitHub is not the file that was signed (size differs).`;
        else release.manifest = manifest;
      } catch (err) {
        release.problem = 'The .sig file could not be read: ' + err.message;
      }
    }
    releases.push(release);
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  caches.set(product.id, { at: Date.now(), releases });
  return releases;
}

/** A short-lived direct download address for a package asset (GitHub answers a redirect; the token never leaves). */
export async function assetDownloadLocation(product, assetId) {
  const { owner, repo, token } = repoConfig(product);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: githubHeaders(product, token, 'application/octet-stream'),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) return res.headers.get('location');
  throw new Error(`GitHub did not give a download address (${res.status}).`);
}
