#!/usr/bin/env node
// Release (release.yml, on every push to the default branch and when the gate
// starts it): publishes to the STAGING store every network whose version is not
// published yet. Replaces AvadoDServer/ci-release-action for this repo.
//
// For each package_variants/<network> whose version has no release yet (no
// "Release <name> <version>" commit and no entry in its releases.json):
//   1. take the build the PR checks tested for exactly this tree (artifact
//      avado-build-<network>-<tree> from a run in this repo, its manifest read
//      back from AVADO's IPFS node and compared with the render of main), or,
//      if there is none, build it now with the pinned AVADOSDK (and check the
//      Teku version and options),
//   2. record the manifest hash in package_variants/<network>/releases.json
//      (the AVADOSDK / ci-release-action format),
//   3. store.setPackageHash on adminrpc.ava.do, then commit
//      "Release <name> <version>" + "Manifest hash: <hash>" and push,
// then ONE store.releaseStore on bo.ava.do (the staging store is rebuilt).
// Same calls and the same secret (RPC_TOKEN) as ci-release-action. Versions
// only go up. Nothing changed: nothing is published.
//
// DRY RUN when RPC_TOKEN is empty or DRY_RUN=true: everything up to the
// store calls is done or shown, nothing is committed, pushed or published.
//
// Environment: GITHUB_REPOSITORY, GITHUB_TOKEN (contents write, actions read),
// RPC_TOKEN, DRY_RUN, IPFS_API (the IPFS API the builds were added to; default
// AVADO's node), ADMIN_RPC_URL, STORE_RPC_URL.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { makeClient } from './lib/gh.js';
import {
  BOT_NAME, BOT_EMAIL, compareVersions, maxVersion, variants, git, fetchBranch, pushHead, releasedVersions,
  readProductionVersions, env, notice, warning,
} from './lib/common.js';

export const AVADO_IPFS_API = 'http://80.208.229.228:35001';
const root = process.cwd();
const repo = env('GITHUB_REPOSITORY');
const token = env('GITHUB_TOKEN');
const rpcToken = env('RPC_TOKEN');
const dryRun = !rpcToken || env('DRY_RUN') === 'true';
const ipfsApi = env('IPFS_API', AVADO_IPFS_API);
const adminRpc = env('ADMIN_RPC_URL', 'https://adminrpc.ava.do');
const storeRpc = env('STORE_RPC_URL', 'https://bo.ava.do/rpc');
const runUrl = `${env('GITHUB_SERVER_URL', 'https://github.com')}/${repo}/actions/runs/${env('GITHUB_RUN_ID', '0')}`;
const out = [];
const say = (s) => { console.log(s); out.push(s); };

const sh = (cmd, args, opts = {}) => String(execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20, ...opts }) ?? '').trim();
const stripBuild = (m) => {
  const c = structuredClone(m);
  if (c.image) { delete c.image.path; delete c.image.hash; delete c.image.size; }
  delete c.builddate;
  return c;
};

async function ipfs(api, path) {
  const res = await fetch(`${api}/api/v0/${path}`, { method: 'POST', signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`IPFS ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 160)}`);
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

// The build the PR checks made and tested for exactly this tree.
async function testedBuild(gh, net, tree, rendered) {
  const name = `avado-build-${net}-${tree}`;
  const list = await gh.get(`repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=30`);
  const candidates = (list?.artifacts || [])
    .filter((a) => !a.expired && a.workflow_run && a.workflow_run.head_repository_id === a.workflow_run.repository_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!candidates.length) return { why: `no tested build ${name} (from a run in this repo) was found` };
  const a = candidates[0];
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  sh('gh', ['run', 'download', String(a.workflow_run.id), '-R', repo, '-n', name, '-D', dir], { env: { ...process.env, GH_TOKEN: token } });
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
  const from = `${env('GITHUB_SERVER_URL', 'https://github.com')}/${repo}/actions/runs/${a.workflow_run.id}`;
  const headTree = (() => { try { return git(root, ['rev-parse', `${a.workflow_run.head_sha}^{tree}`]); } catch { return null; } })();
  if (record.tree !== tree || headTree !== tree) return { why: `tested build ${from} is for another tree` };
  if (record.name !== rendered.name || record.version !== rendered.version || record.upstream !== rendered.upstream) {
    return { why: `tested build ${from} is ${record.name} ${record.version} (Teku ${record.upstream})` };
  }
  if (record.provider !== ipfsApi) return { why: `tested build ${from} was added to ${record.provider}, not ${ipfsApi}`, record, from, local: true };
  const manifest = JSON.parse(await ipfs(ipfsApi, `cat?arg=${encodeURIComponent(record.manifestHash)}`));
  if (!isDeepStrictEqual(stripBuild(manifest), rendered)) return { why: `the manifest of tested build ${from} differs from what main renders` };
  if (manifest.image?.hash !== record.imageHash) return { why: `tested build ${from}: image hash differs from its manifest` };
  try {
    await ipfs(ipfsApi, `pin/ls?arg=${encodeURIComponent(record.imageHash)}&type=recursive`);
  } catch (err) {
    await ipfs(ipfsApi, `block/stat?arg=${encodeURIComponent(record.imageHash.replace('/ipfs/', ''))}`).catch(() => {
      throw new Error(`the image of tested build ${from} is not on ${ipfsApi} (${err.message})`);
    });
  }
  return { record, from };
}

function freshBuild(net) {
  const dir = mkdtempSync(join(tmpdir(), `release-${net}-`));
  sh(join(root, 'scripts/ci/sdk-build.sh'), [net, dir, ipfsApi], { stdio: ['ignore', 'pipe', 'inherit'] });
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'));
  // The same fast checks as the PR checks, so an untested build is at least the right Teku with valid options.
  sh(join(root, 'scripts/ci/check-version.sh'), [`${record.name}:${record.version}`, record.upstream], { stdio: 'inherit' });
  sh(join(root, 'scripts/ci/check-flags.sh'), [`${record.name}:${record.version}`, join(dir, 'flags')], { stdio: 'inherit' });
  return record;
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

async function main() {
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = makeClient({ token });
  const base = (await gh.get(`repos/${repo}`)).default_branch;
  fetchBranch(root, token, base);
  git(root, ['checkout', '-q', '--detach', `origin/${base}`]);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  say(`${dryRun ? 'DRY RUN' + (rpcToken ? ' (DRY_RUN=true)' : ' (no RPC_TOKEN)') + ': nothing is committed or published. ' : ''}${base} at ${git(root, ['rev-parse', '--short', 'HEAD'])}, tree ${tree.slice(0, 12)}, IPFS ${ipfsApi}`);

  let prod = null;
  try { prod = await readProductionVersions({ http: gh.http }); } catch (err) { warning(`production store unreadable (${err.message}); the version guard uses git history only`); }

  const todo = [];
  for (const net of variants(root)) {
    const dir = mkdtempSync(join(tmpdir(), `render-${net}-`));
    const renderedDir = sh(join(root, 'scripts/render.sh'), [net, dir]);
    const rendered = JSON.parse(readFileSync(join(renderedDir, 'dappnode_package.json'), 'utf8'));
    const { name, version } = rendered;
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
    return;
  }

  const done = [];
  for (const t of todo) {
    let build = await testedBuild(gh, t.net, tree, t.rendered).catch((err) => ({ why: err.message }));
    let rec;
    let source;
    if (build.record && !build.local) {
      rec = build.record;
      source = `the build the PR checks tested (${build.from})`;
    } else if (build.local && dryRun) {
      rec = build.record;
      source = `the tested build ${build.from} (DRY RUN: it was added to a test IPFS node, ${build.record.provider}, so it could not be read back)`;
    } else {
      warning(`${t.net}: ${build.why}; building it now`);
      rec = freshBuild(t.net);
      source = `a new build made by this run (${runUrl}); ${build.why}`;
    }
    const hash = rec.manifestHash.replace(/^\/ipfs\//, '');
    t.record[t.version] = { hash: `/ipfs/${hash}`, type: 'manifest', uploadedTo: { [rec.provider]: new Date(rec.builtAt).toUTCString() } };
    writeFileSync(t.relFile, JSON.stringify(t.record, null, 2));
    const message = `Release ${t.name} ${t.version}\n\nManifest hash: ${hash}\n\nTeku ${t.rendered.upstream}. Published from ${source}.`;
    say(`- ${t.name} ${t.version}: manifest ${hash}, image ${rec.imageHash}, from ${source}`);

    if (dryRun) {
      say(`  DRY RUN: would call store.setPackageHash({name: "${t.name}", ipfsHash: "${hash}"}) on ${adminRpc}, then commit "Release ${t.name} ${t.version}" with package_variants/${t.net}/releases.json and push to ${base}`);
      say(`  DRY RUN: package_variants/${t.net}/releases.json would become: ${JSON.stringify(t.record)}`);
      continue;
    }
    if (/localhost|127\.0\.0\.1/.test(rec.provider)) throw new Error(`refusing to publish a build that was added to a test IPFS node (${rec.provider}); boxes could not download it`);
    await rpc(adminRpc, { Authorization: rpcToken }, 'store.setPackageHash', { name: t.name, ipfsHash: hash }, { strict: true });
    say(`  store.setPackageHash ${t.name} -> ${hash}: ok`);
    git(root, ['add', '-f', `package_variants/${t.net}/releases.json`]);
    git(root, ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '-q', '-m', message]);
    pushWithRetry(base);
    say(`  committed and pushed "Release ${t.name} ${t.version}"`);
    done.push(t);
  }

  if (dryRun) {
    say(`DRY RUN: would call store.releaseStore once on ${storeRpc} (staging store rebuilt with ${todo.map((t) => `${t.name} ${t.version}`).join(', ')})`);
    return;
  }
  if (done.length) {
    await rpc(storeRpc, { admintoken: rpcToken }, 'store.releaseStore', null, { strict: false });
    say(`store.releaseStore: ok. Staging now gets ${done.map((t) => `${t.name} ${t.version}`).join(', ')}. Production stays the owner's click in editstore.`);
    notice(`Published to staging: ${done.map((t) => `${t.name} ${t.version}`).join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.log(`::error::${err.stack || err.message}`);
    out.push(`**Release failed:** ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    const f = env('GITHUB_STEP_SUMMARY');
    if (f) appendFileSync(f, `${out.join('\n')}\n`);
  });
