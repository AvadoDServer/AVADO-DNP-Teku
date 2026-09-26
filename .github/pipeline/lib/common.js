// Shared helpers for the Teku pipeline (bump, gate, release). Node 20+, no
// dependencies. Everything that reads or edits the repo layout lives here, so
// the three workflows agree on it.
//
// Layout (see README): the upstream Teku version is written once, as
// TEKU_VERSION in the base docker-compose.yml; every network has its own
// package_variants/<network>/dappnode_package.json with its package name and
// version.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const BOT_NAME = 'github-actions[bot]';
export const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
export const BOT_BRANCH = 'avado-bot/bump';
export const BUMP_MARKER = '<!-- avado-bot:bump -->';
export const UPSTREAM_REPO = 'Consensys/teku';
export const UPSTREAM_IMAGE = 'consensys/teku';
export const DAPPNODE = { repo: 'dappnode/DAppNodePackage-teku-generic', bump_name: 'teku', kind: 'cl' };
export const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;
// The network names the mandatory-wording rules use for each variant.
export const RULE_NETWORK = { mainnet: 'ethereum-mainnet', gnosis: 'gnosis' };

// --- versions ----------------------------------------------------------------

export function parseVersion(v) {
  const m = STABLE_TAG.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const bare = (tag) => String(tag).replace(/^v/, '');

export function maxVersion(list) {
  return list.filter((v) => parseVersion(v)).reduce((a, b) => (a === null || compareVersions(b, a) > 0 ? b : a), null);
}

export function bumpPatch(v) {
  const p = parseVersion(v);
  if (!p) throw new Error(`not a version: ${v}`);
  return `${p[0]}.${p[1]}.${p[2] + 1}`;
}

// Stable upstream releases only (no draft, pre-release, rc, beta, nightly), newest version first.
export function stableReleases(releases) {
  return (releases || [])
    .filter((r) => !r.draft && !r.prerelease && STABLE_TAG.test(r.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
}

// --- repo files ----------------------------------------------------------------

const TEKU_LINE = /^(\s*TEKU_VERSION:\s*)["']?([^\s"'#]+)["']?(\s*(#.*)?)$/m;

export function readTekuVersion(composeText) {
  const all = [...String(composeText).matchAll(new RegExp(TEKU_LINE.source, 'gm'))];
  if (all.length !== 1) throw new Error(`expected exactly one TEKU_VERSION line in docker-compose.yml, found ${all.length}`);
  return all[0][2];
}

export function setTekuVersion(composeText, version) {
  readTekuVersion(composeText);
  const out = composeText.replace(TEKU_LINE, (_, pre, _old, post) => `${pre}${version}${post || ''}`);
  if (readTekuVersion(out) !== version) throw new Error('could not set TEKU_VERSION');
  return out;
}

// Replaces only the top-level "version" line, so the file keeps its formatting.
export function setManifestVersion(text, version) {
  const before = JSON.parse(text);
  const re = /^( {2}"version":\s*")([^"]*)(",?\s*)$/m;
  if (!re.test(text)) throw new Error('no top-level "version" line in the manifest');
  const out = text.replace(re, (_, pre, _old, post) => `${pre}${version}${post}`);
  const after = JSON.parse(out);
  if (after.version !== version || JSON.stringify({ ...after, version: before.version }) !== JSON.stringify(before)) {
    throw new Error('setting the version changed more than the version');
  }
  return out;
}

export function variants(root) {
  const dir = join(root, 'package_variants');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'dappnode_package.json')))
    .map((d) => d.name)
    .sort();
}

export function readVariant(root, network) {
  const path = join(root, 'package_variants', network, 'dappnode_package.json');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  return { network, name: m.name, version: m.version, path };
}

// --- git -------------------------------------------------------------------------

export function git(root, args, opts = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

// Git credentials through the environment (git 2.31+), so the token never
// appears in a command line or an error message. Works in private repos too
// (the workflows check out with persist-credentials: false).
export function gitAuthEnv(token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function fetchBranch(root, token, branch) {
  git(root, ['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { env: gitAuthEnv(token) });
}

export function pushHead(root, token, branch, { force = false } = {}) {
  execFileSync('git', ['-C', root, 'push', '-q', ...(force ? ['--force'] : []), 'origin', `HEAD:refs/heads/${branch}`], { stdio: 'inherit', env: gitAuthEnv(token) });
}

// Versions the CI released for a package name: commits "Release <name> <version>"
// by github-actions[bot] (ci-release-action and this pipeline's release.yml).
export function releasedVersions(root, name, ref = 'HEAD') {
  const out = git(root, ['log', ref, `--author=${BOT_NAME}`, '-F', `--grep=Release ${name} `, '--format=%s']);
  const re = new RegExp(`^Release ${name.replace(/\./g, '\\.')} (\\d+\\.\\d+\\.\\d+)$`);
  return out.split('\n').map((s) => re.exec(s.trim())?.[1]).filter(Boolean);
}

// --- production store (read only) ----------------------------------------------------

export async function readProductionVersions({ http, pointerUrl = 'https://bo.ava.do/value/store', gateways = ['http://80.208.229.228:8080', 'https://ipfs.io'] }) {
  let v = JSON.parse(await http.text(pointerUrl, { headers: { 'Cache-Control': 'no-cache' } }));
  if (typeof v === 'string') v = JSON.parse(v);
  let lastErr;
  for (const gw of gateways) {
    try {
      const store = await http.json(`${gw}/ipfs/${v.hash}`, { timeout: 60000 });
      const out = new Map();
      for (const p of store.packages || []) if (p.manifest?.name) out.set(p.manifest.name, p.manifest.version);
      return { hash: v.hash, versions: out };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('production store unreadable');
}

// --- small things ------------------------------------------------------------------------

export function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export function hoursBetween(a, b) {
  return (new Date(b) - new Date(a)) / 3600000;
}

export function fmtUtc(d) {
  return new Date(d).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}

// GitHub Actions log helpers.
export const notice = (msg) => console.log(`::notice::${String(msg).replace(/\n/g, '%0A')}`);
export const warning = (msg) => console.log(`::warning::${String(msg).replace(/\n/g, '%0A')}`);
