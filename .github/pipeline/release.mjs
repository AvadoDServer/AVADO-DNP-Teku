#!/usr/bin/env node
// Release (release.yml, on every push to the default branch and when the gate
// starts it): publishes to the STAGING store every network whose version is not
// published yet, and ONLY the exact build our PR checks tested. Replaces
// AvadoDServer/ci-release-action for this repo.
//
// For each package_variants/<network> that is not held (no hold file) and whose
// version has no release yet (no "Release <name> <version>" commit and no entry
// in its releases.json):
//   1. find the build the PR checks tested for exactly these files: artifact
//      avado-build-<network>-<content id> (scripts/ci/content-id.sh: every file
//      except the releases.json records, so a merge commit, a squash and a
//      re-run after a partial release all find it), made by a PR-checks run of
//      this repo for the commit it names; its manifest is read back from AVADO's
//      IPFS node and must equal what the default branch renders, and its image
//      must be on the node. There is NO fallback build: a network without a
//      tested build is not published and the run fails, so the owner gets an
//      issue that says how to get one ("PR checks" with pr = main, then Release).
//   2. store.setPackageHash on adminrpc.ava.do, then record the hash in
//      package_variants/<network>/releases.json (the AVADOSDK format) and commit
//      "Release <name> <version>" + "Manifest hash: <hash>" and push,
// then ONE store.releaseStore on bo.ava.do: the server only queues the staging
// rebuild and does not say whether it worked. Same calls and the same secret
// (RPC_TOKEN) as ci-release-action. Versions only go up. Nothing new: nothing is
// published (with RELEASE_STORE=true the staging rebuild is requested again).
//
// DRY RUN when RPC_TOKEN is empty or DRY_RUN=true: everything up to the store
// calls is done or shown, nothing is committed, pushed or published.
//
// Environment: GITHUB_REPOSITORY, GITHUB_TOKEN (contents write, actions read),
// RPC_TOKEN, DRY_RUN, RELEASE_STORE, IPFS_API (the IPFS API the tested builds
// were added to; default AVADO's node), ADMIN_RPC_URL, STORE_RPC_URL.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { makeClient } from './lib/gh.js';
import {
  BOT_NAME, BOT_EMAIL, PR_CHECKS_PATH, compareVersions, maxVersion, variants, git, fetchBranch, pushHead, releasedVersions,
  readProductionVersions, holdReason, contentId, ensureCommit, retry, env, notice, warning, recordFailure,
} from './lib/common.js';

export const AVADO_IPFS_API = 'http://80.208.229.228:35001';
const root = process.cwd();
const repo = env('GITHUB_REPOSITORY');
const token = env('GITHUB_TOKEN');
const rpcToken = env('RPC_TOKEN');
const dryRun = !rpcToken || env('DRY_RUN') === 'true';
const storeAgain = env('RELEASE_STORE') === 'true';
const ipfsApi = env('IPFS_API', AVADO_IPFS_API);
const adminRpc = env('ADMIN_RPC_URL', 'https://adminrpc.ava.do');
const storeRpc = env('STORE_RPC_URL', 'https://bo.ava.do/rpc');
const server = env('GITHUB_SERVER_URL', 'https://github.com');
const runLink = (id) => `${server}/${repo}/actions/runs/${id}`;
const out = [];
const say = (s) => { console.log(s); out.push(s); };

const sh = (cmd, args, opts = {}) => String(execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20, ...opts }) ?? '').trim();
const stripBuild = (m) => {
  const c = structuredClone(m);
  if (c.image) { delete c.image.path; delete c.image.hash; delete c.image.size; }
  delete c.builddate;
  return c;
};
const isLocal = (url) => /localhost|127\.0\.0\.1/.test(url || '');

async function ipfs(api, path) {
  const res = await fetch(`${api}/api/v0/${path}`, { method: 'POST', signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`IPFS ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 160)}`), { status: res.status });
  return text;
}

async function rpc(url, headers, method, params, { strict }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  let body = null;
  try { body = JSON.parse(text); } catch { /* checked below */ }
  if (body?.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  if (strict && (!body || body.result === undefined)) throw new Error(`${method}: unexpected answer ${text.slice(0, 200)}`);
  if (!body) warning(`${method}: the answer was not JSON (${text.slice(0, 120)}); HTTP ${res.status} counts as success, as in ci-release-action`);
  return body?.result;
}

// One artifact: is it a build our PR checks made and tested for these files?
// Returns { record, from } (local: true when it was added to a throwaway IPFS
// node) or { reject: why }. Throws when something could not be READ (after
// retries), so a network hiccup never turns into "use another build".
async function checkCandidate(gh, a, net, cid, rendered) {
  const from = runLink(a.workflow_run.id);
  const run = await retry('reading the PR-checks run', () => gh.get(`repos/${repo}/actions/runs/${a.workflow_run.id}`));
  if (run.path !== PR_CHECKS_PATH) return { reject: `${from} is not a PR-checks run (${run.path})` };
  if (!run.head_repository || run.head_repository.id !== run.repository?.id) return { reject: `${from} ran for a fork` };
  if (!['pull_request', 'workflow_dispatch'].includes(run.event)) return { reject: `${from} was started by ${run.event}` };

  // A fresh folder for every attempt: a half-finished download must not get in the way.
  const dir = await retry('downloading the tested build record', async () => {
    const d = mkdtempSync(join(tmpdir(), `avado-build-${net}-`));
    sh('gh', ['run', 'download', String(a.workflow_run.id), '-R', repo, '-n', a.name, '-D', d], { env: { ...process.env, GH_TOKEN: token } });
    return d;
  });
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(record.commit || '')) return { reject: `${from}: the record names no commit` };
  // A pull_request run checks the PR head; a run started by hand (the bump bot
  // without PAT_TOKEN, or "PR checks" with pr = main) checks the commit it names,
  // and pr-checks.yml refuses to start one for a fork.
  if (run.event === 'pull_request' && run.head_sha !== record.commit) return { reject: `${from} checked ${run.head_sha.slice(0, 7)}, not ${record.commit.slice(0, 7)}` };
  await retry('fetching the tested commit', async () => ensureCommit(root, token, record.commit));
  const builtId = contentId(root, record.commit);
  if (record.contentId !== cid || builtId !== cid) return { reject: `${from} tested other files (commit ${record.commit.slice(0, 7)})` };
  if (record.network !== net || record.name !== rendered.name || record.version !== rendered.version || record.upstream !== rendered.upstream) {
    return { reject: `${from} is ${record.name} ${record.version} (Teku ${record.upstream})` };
  }
  // A build added to a throwaway IPFS node (a test copy with IPFS_PROVIDER=local)
  // cannot be read back, and boxes could never download it.
  if (record.provider !== ipfsApi || isLocal(record.provider)) {
    return { record, from, local: true, why: `the tested build ${from} was added to ${record.provider}, which cannot be read back or downloaded by boxes` };
  }
  const manifest = JSON.parse(await retry('reading the tested manifest from IPFS', () => ipfs(ipfsApi, `cat?arg=${encodeURIComponent(record.manifestHash)}`)));
  if (!isDeepStrictEqual(stripBuild(manifest), rendered)) return { reject: `the manifest of ${from} differs from what the default branch renders` };
  if (manifest.image?.hash !== record.imageHash) return { reject: `${from}: the image hash differs from its manifest` };
  const cidOnly = record.imageHash.replace('/ipfs/', '');
  await retry('checking the tested image on IPFS', async () => {
    try {
      await ipfs(ipfsApi, `pin/ls?arg=${encodeURIComponent(cidOnly)}&type=recursive`);
    } catch {
      await ipfs(ipfsApi, `block/stat?arg=${encodeURIComponent(cidOnly)}`);
    }
  });
  return { record, from };
}

// The build the PR checks tested for exactly these files. Oldest first, so a
// re-run after a partial release picks the same build (the same hash).
async function testedBuild(gh, net, cid, rendered) {
  const name = `avado-build-${net}-${cid}`;
  const list = await retry('listing the tested builds', () => gh.get(`repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`));
  const candidates = (list?.artifacts || [])
    .filter((a) => !a.expired && a.workflow_run && a.workflow_run.head_repository_id === a.workflow_run.repository_id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!candidates.length) return { missing: `no tested build ${name} was found (the PR checks of this repo never tested exactly these files, or the build is older than 90 days)` };
  const rejects = [];
  let local = null;
  for (const a of candidates) {
    const r = await checkCandidate(gh, a, net, cid, rendered);
    if (r.record && !r.local) return r;
    if (r.local) { local = local || r; continue; }
    rejects.push(r.reject);
  }
  if (local) return local;
  return { missing: `no usable tested build: ${rejects.join('; ')}` };
}

function pushWithRetry(base) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pushHead(root, token, base);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      warning(`push rejected (attempt ${attempt}); rebasing on the new ${base}`);
      fetchBranch(root, token, base);
      git(root, ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'rebase', '-q', `origin/${base}`]);
    }
  }
}

async function releaseStore(names) {
  if (dryRun) {
    say(`DRY RUN: would call store.releaseStore once on ${storeRpc} (staging store rebuilt${names.length ? ` with ${names.join(', ')}` : ''})`);
    return;
  }
  await rpc(storeRpc, { admintoken: rpcToken }, 'store.releaseStore', null, { strict: false });
  say(`store.releaseStore: the staging rebuild is queued${names.length ? ` with ${names.join(', ')}` : ''}. The server does not report whether the rebuild worked: check the package on the test box. Production stays the owner's click in editstore.`);
}

async function main() {
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = makeClient({ token });
  const base = (await gh.get(`repos/${repo}`)).default_branch;
  fetchBranch(root, token, base);
  git(root, ['checkout', '-q', '--detach', `origin/${base}`]);
  const cid = contentId(root, 'HEAD');
  say(`${dryRun ? 'DRY RUN' + (rpcToken ? ' (DRY_RUN=true)' : ' (no RPC_TOKEN)') + ': nothing is committed or published. ' : ''}${base} at ${git(root, ['rev-parse', '--short', 'HEAD'])}, content id ${cid.slice(0, 12)}, IPFS ${ipfsApi}`);

  let prod = null;
  try { prod = await readProductionVersions({ http: gh.http }); } catch (err) { warning(`production store unreadable (${err.message}); the version guard uses git history only`); }

  const todo = [];
  for (const net of variants(root)) {
    const dir = mkdtempSync(join(tmpdir(), `render-${net}-`));
    const renderedDir = sh(join(root, 'scripts/render.sh'), [net, dir]);
    const rendered = JSON.parse(readFileSync(join(renderedDir, 'dappnode_package.json'), 'utf8'));
    const { name, version } = rendered;
    const hold = holdReason(root, net);
    if (hold) {
      say(`- ${net}: HELD, not published (${hold}). Boxes keep ${prod?.versions.get(name) ? `production ${prod.versions.get(name)}` : 'what they have'}.`);
      continue;
    }
    const relFile = join(root, 'package_variants', net, 'releases.json');
    const record = existsSync(relFile) ? JSON.parse(readFileSync(relFile, 'utf8')) : {};
    const released = releasedVersions(root, name);
    if (record[version]?.hash || released.includes(version)) {
      say(`- ${net}: ${name} ${version} is already published${record[version]?.hash ? ` (${record[version].hash})` : ''}; nothing to do`);
      continue;
    }
    const highest = maxVersion([...released, prod?.versions.get(name)].filter(Boolean));
    if (highest && compareVersions(version, highest) <= 0) {
      throw new Error(`${name} ${version} is not above the highest version already released (${highest}); versions only go up`);
    }
    todo.push({ net, name, version, rendered, relFile, record });
    say(`- ${net}: ${name} ${version} (Teku ${rendered.upstream}) will be published${highest ? ` (last released ${highest})` : ''}`);
  }
  if (!todo.length) {
    say('Nothing to publish: no network has a new version.');
    if (storeAgain) await releaseStore([]);
    return;
  }

  // Find every tested build BEFORE publishing anything: a read error stops the
  // run here, with nothing published.
  const ready = [];
  const missing = [];
  for (const t of todo) {
    const b = await testedBuild(gh, t.net, cid, t.rendered);
    if (b.record && (!b.local || dryRun)) ready.push({ ...t, rec: b.record, from: b.from, local: !!b.local });
    else missing.push({ ...t, why: b.missing || b.why });
  }

  const done = [];
  for (const t of ready) {
    const hash = t.rec.manifestHash.replace(/^\/ipfs\//, '');
    const source = t.local
      ? `the tested build ${t.from} (DRY RUN: it was added to a test IPFS node, ${t.rec.provider}, so it could not be read back)`
      : `the build the PR checks tested (${t.from}, commit ${t.rec.commit.slice(0, 7)})`;
    t.record[t.version] = { hash: `/ipfs/${hash}`, type: 'manifest', uploadedTo: { [t.rec.provider]: new Date(t.rec.builtAt).toUTCString() } };
    const message = `Release ${t.name} ${t.version}\n\nManifest hash: ${hash}\n\nTeku ${t.rendered.upstream}. Published from ${source}.`;
    say(`- ${t.name} ${t.version}: manifest ${hash}, image ${t.rec.imageHash}, from ${source}`);
    if (dryRun) {
      say(`  DRY RUN: would call store.setPackageHash({name: "${t.name}", ipfsHash: "${hash}"}) on ${adminRpc}, then commit "Release ${t.name} ${t.version}" with package_variants/${t.net}/releases.json and push to ${base}`);
      say(`  DRY RUN: package_variants/${t.net}/releases.json would become: ${JSON.stringify(t.record)}`);
      done.push(t);
      continue;
    }
    if (isLocal(t.rec.provider)) throw new Error(`refusing to publish a build that was added to a test IPFS node (${t.rec.provider}); boxes could not download it`);
    writeFileSync(t.relFile, JSON.stringify(t.record, null, 2));
    await rpc(adminRpc, { Authorization: rpcToken }, 'store.setPackageHash', { name: t.name, ipfsHash: hash }, { strict: true });
    say(`  store.setPackageHash ${t.name} -> ${hash}: ok`);
    git(root, ['add', '-f', `package_variants/${t.net}/releases.json`]);
    git(root, ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '-q', '-m', message]);
    pushWithRetry(base);
    say(`  committed and pushed "Release ${t.name} ${t.version}"`);
    done.push(t);
  }

  if (done.length) {
    await releaseStore(done.map((t) => `${t.name} ${t.version}`));
    if (!dryRun) notice(`Published to staging: ${done.map((t) => `${t.name} ${t.version}`).join(', ')}`);
  }

  if (missing.length) {
    const list = missing.map((m) => `${m.name} ${m.version}: ${m.why}`).join('\n- ');
    throw new Error(`NOT published (nothing untested is ever published):
- ${list}
${done.length ? `${dryRun ? 'Would be published (dry run)' : 'Published'}: ${done.map((t) => `${t.name} ${t.version}`).join(', ')}.\n` : ''}To publish it: in GitHub, Actions -> "PR checks" -> Run workflow, with pr = ${base} (it builds and tests the default branch exactly as it is). When it is green, Actions -> "Release" -> Run workflow. If the checks fail, fix the cause in a pull request instead.`);
  }
}

main()
  .catch((err) => {
    console.log(`::error::${err.stack || err.message}`);
    out.push(`**Release failed:** ${err.message}`);
    recordFailure(err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    const f = env('GITHUB_STEP_SUMMARY');
    if (f) appendFileSync(f, `${out.join('\n')}\n`);
  });
