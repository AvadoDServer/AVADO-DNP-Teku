// Unit tests for the pipeline rules: node --test ".github/pipeline/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { decide, logExcerpt, combineMandatory, ownerMergeFiles, retryable, partialMandatoryNotice, issueText } from '../gate.mjs';
import { reportVerdict, summarize } from '../lib/dappnode.js';
import { checkMandatory } from '../lib/mandatory.js';
import {
  compareVersions, bumpPatch, maxVersion, stableReleases, readTekuVersion, setTekuVersion, setManifestVersion,
  readTekuDigest, setTekuDigest, bumpMarker, markerTarget, holdReason, contentId,
} from '../lib/common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const released = '2026-09-17T02:27:13Z';
const at = (h) => new Date(new Date(released).getTime() + h * 3600000);
const base = { checks: 'success', dn: { level: 'WAIT', verdict: 'pending' }, mandatory: null, releasedAt: released, now: at(1), upToDate: true, conflict: false };

test('merges when our checks are green and DAppNode passed', () => {
  const d = decide({ ...base, dn: { level: 'GOOD', verdict: 'pass' } });
  assert.equal(d.action, 'merge');
  assert.equal(d.cause, 'dappnode-good');
});

test('waits for DAppNode, then falls back after 72 h', () => {
  assert.equal(decide({ ...base, now: at(71.9) }).action, 'wait');
  assert.equal(decide({ ...base, now: at(71.9) }).cause, 'dappnode');
  const d = decide({ ...base, now: at(72) });
  assert.equal(d.action, 'merge');
  assert.equal(d.cause, 'fallback');
  assert.equal(decide({ ...base, now: at(72), dn: { level: 'WAIT', verdict: 'infra' } }).action, 'merge');
});

test('a required release does not wait for the 72 h', () => {
  const d = decide({ ...base, mandatory: { source: 'release notes' } });
  assert.equal(d.action, 'merge');
  assert.equal(d.cause, 'mandatory');
});

test('never merges when DAppNode saw the client fail or its result is unclear, even when required', () => {
  for (const verdict of ['client-fail', 'unverified-fail']) {
    const d = decide({ ...base, now: at(500), mandatory: { source: 'x' }, dn: { level: 'BLOCK', verdict } });
    assert.equal(d.action, 'block');
    assert.equal(d.cause, verdict === 'client-fail' ? 'dappnode-failed' : 'dappnode-unclear');
  }
});

test('never merges when our checks failed, and says so before anything else', () => {
  const d = decide({ ...base, checks: 'failure', dn: { level: 'GOOD', verdict: 'pass' } });
  assert.equal(d.action, 'block');
  assert.equal(d.cause, 'checks-failed');
  assert.equal(decide({ ...base, checks: 'failure', releasedAt: null }).cause, 'checks-failed');
});

test('waits while checks run or the branch is behind', () => {
  assert.equal(decide({ ...base, checks: 'pending', dn: { level: 'GOOD', verdict: 'pass' } }).cause, 'checks');
  assert.equal(decide({ ...base, checks: 'missing', dn: { level: 'GOOD', verdict: 'pass' } }).cause, 'checks');
  assert.equal(decide({ ...base, upToDate: false, dn: { level: 'GOOD', verdict: 'pass' } }).cause, 'behind');
});

test('checks that stay silent for 6 h after the last push block instead of waiting forever', () => {
  const headAt = at(0).toISOString();
  assert.equal(decide({ ...base, checks: 'missing', headAt, now: at(5.9) }).action, 'wait');
  const d = decide({ ...base, checks: 'pending', headAt, now: at(6) });
  assert.equal(d.action, 'block');
  assert.equal(d.cause, 'unclear');
});

test('anything unclear blocks', () => {
  assert.equal(decide({ ...base, dn: null }).cause, 'unclear');
  assert.equal(decide({ ...base, releasedAt: null, dn: { level: 'GOOD', verdict: 'pass' } }).cause, 'unclear');
  assert.equal(decide({ ...base, errors: ['Teku releases: HTTP 500'] }).cause, 'unclear');
  assert.equal(decide({ ...base, conflict: true }).cause, 'conflict');
  assert.equal(decide({ ...base, unexpectedFiles: ['build/startTeku.sh'] }).cause, 'unexpected-files');
});

test('DAppNode reports are read by structure (vendored watcher rules)', () => {
  const passed = '## SYNC TEST REPORT - PASSED\n### Version Tracking\n| Client | Before | After |\n|---|---|---|\n| Consensus | teku:26.8.0 | teku:26.9.0 |\n';
  assert.equal(reportVerdict(passed, '26.9.0', 'cl').verdict, 'pass');
  assert.equal(reportVerdict(passed, '26.10.0', 'cl').verdict, 'unverified-fail');
  const failed = '## SYNC TEST REPORT - FAILED\n### Timing\n| Operation | Duration | Status |\n|---|---|---|\n| WaitForSync | 30m | ❌ |\n\nIPFS Hash: Qm\n';
  assert.equal(reportVerdict(failed, '26.9.0', 'cl').verdict, 'client-fail');
  assert.equal(summarize({ report: { verdict: 'infra' } }).level, 'WAIT');
  assert.equal(summarize({ report: { verdict: 'pass' } }).level, 'GOOD');
});

test('mandatory wording (vendored watcher rules)', () => {
  const r = (body) => ({ tag_name: '26.10.0', published_at: '2026-10-01T00:00:00Z', body });
  assert.ok(checkMandatory(r('This is a mandatory update for all mainnet users.'), ['release-wording'], { network: 'ethereum-mainnet' })?.mandatory);
  assert.equal(checkMandatory(r('Hoodi users must upgrade before the fork.'), ['release-wording'], { network: 'ethereum-mainnet' }), null);
  assert.equal(checkMandatory(r('Bug fixes and performance improvements.'), ['release-wording'], { network: 'gnosis' }), null);
});

test('versions', () => {
  assert.equal(compareVersions('26.10.0', '26.9.0'), 1);
  assert.equal(compareVersions('v26.9.0', '26.9.0'), 0);
  assert.equal(bumpPatch('0.0.75'), '0.0.76');
  assert.equal(maxVersion(['0.0.75', '0.0.9', '0.0.100']), '0.0.100');
  const rels = [
    { tag_name: '26.9.0', draft: false, prerelease: false },
    { tag_name: '26.10.0-rc1', draft: false, prerelease: false },
    { tag_name: '26.11.0', draft: false, prerelease: true },
    { tag_name: '26.10.0', draft: false, prerelease: false },
  ];
  assert.deepEqual(stableReleases(rels).map((r) => r.tag_name), ['26.10.0', '26.9.0']);
});

test('the bump edits only the version fields of the real files', () => {
  const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
  const now = readTekuVersion(compose);
  const other = bumpPatch(now); // always differs from what is checked out (also on a bump PR)
  const edited = setTekuVersion(compose, other);
  assert.equal(readTekuVersion(edited), other);
  assert.equal(edited.split('\n').filter((l, i) => l !== compose.split('\n')[i]).length, 1);
  assert.equal(setTekuVersion(edited, now), compose);
  // The digest line is the only other line the bump writes.
  const digest = readTekuDigest(compose);
  const otherDigest = `sha256:${'a'.repeat(64)}` === digest ? `sha256:${'b'.repeat(64)}` : `sha256:${'a'.repeat(64)}`;
  const both = setTekuDigest(edited, otherDigest);
  assert.equal(readTekuDigest(both), otherDigest);
  assert.equal(both.split('\n').filter((l, i) => l !== compose.split('\n')[i]).length, 2);
  assert.equal(setTekuDigest(setTekuVersion(both, now), digest), compose);
  assert.throws(() => setTekuDigest(compose, 'sha256:1234'));
  assert.throws(() => readTekuDigest(compose.replace(/TEKU_DIGEST:.*/, 'TEKU_DIGEST: latest')));
  for (const net of ['mainnet', 'gnosis']) {
    const text = readFileSync(join(ROOT, 'package_variants', net, 'dappnode_package.json'), 'utf8');
    const v = JSON.parse(text).version;
    const out = setManifestVersion(text, bumpPatch(v));
    assert.equal(JSON.parse(out).version, bumpPatch(v));
    assert.equal(out.split('\n').filter((l, i) => l !== text.split('\n')[i]).length, 1);
  }
  assert.throws(() => readTekuVersion('services:\n  a:\n    build:\n      args:\n        TEKU_VERSION: 1.0.0\n        TEKU_VERSION: 2.0.0\n'));
});

test('the issue shows the failing lines of a job log, not setup or cleanup noise', () => {
  const log = [
    '2026-09-26T22:10:19.1Z ##[group]Run node --test',
    '2026-09-26T22:10:19.2Z ok 4 - never merges when our checks failed',
    '2026-09-26T22:10:19.3Z # fail 0',
    '2026-09-26T22:10:19.4Z   FAIL    compose                  difference from production',
    '2026-09-26T22:10:19.5Z ----- mainnet/compose: lines that differ from production and are not in the expected file',
    '2026-09-26T22:10:19.6Z     +          "NETWORK": "mainnet"',
    '2026-09-26T22:10:19.7Z \x1b[36;1mshell: /usr/bin/bash -e {0}\x1b[0m',
    '2026-09-26T22:10:19.8Z ##[error]Process completed with exit code 1.',
    '2026-09-26T22:10:19.9Z Post job cleanup.',
    '2026-09-26T22:10:20.0Z [command]/usr/bin/git version',
  ].join('\n');
  const x = logExcerpt(log);
  assert.match(x, /FAIL {4}compose/);
  assert.match(x, /"NETWORK": "mainnet"/);
  assert.match(x, /##\[error\]/);
  assert.ok(x.indexOf('FAIL    compose') < x.indexOf('ok 4'), 'failure lines come first, then the context before the error');
  assert.doesNotMatch(x, /Post job|\[command\]|\x1b|shell: /);
});

test('a person changing the checks or the pipeline on the bot branch leaves the merge to the owner', () => {
  const files = ['docker-compose.yml', 'package_variants/mainnet/dappnode_package.json', 'build/startTeku.sh'];
  assert.deepEqual(ownerMergeFiles(files, false), [], 'a start-script fix may still merge by itself');
  for (const f of ['scripts/ci/check-flags.sh', 'scripts/proof/expected/mainnet/start-mode-unset.diff', '.github/pipeline/release.mjs',
    '.github/workflows/release.yml', 'package_variants/gnosis/hold', 'package_variants/mainnet/releases.json', 'scripts/render.sh']) {
    assert.deepEqual(ownerMergeFiles([...files, f], false), [f], f);
  }
  assert.deepEqual(ownerMergeFiles(['scripts/ci/check-flags.sh'], true), [], 'bot-only PRs are guarded by the unexpected-files rule');
  const d = decide({ ...base, dn: { level: 'GOOD', verdict: 'pass' }, ownerFiles: ['scripts/ci/check-flags.sh'] });
  assert.equal(d.action, 'block');
  assert.equal(d.cause, 'owner-merge');
});

test('checks that failed on an outside step run once more, without an issue', () => {
  const outside = [{ name: 'gnosis', step: 'Boots on its real network' }, { name: 'mainnet', step: 'AVADOSDK build (render, build, add to IPFS)' }];
  assert.ok(retryable(outside));
  assert.ok(retryable([{ name: 'mainnet', step: null }]), 'a job lost without a failed step (runner) is retried');
  assert.ok(!retryable([...outside, { name: 'mainnet', step: 'Every option we pass exists in teku --help' }]));
  assert.ok(!retryable([{ name: 'Plan (unit tests, identity, manifests)', step: 'Unit tests of the pipeline rules' }]));
  assert.ok(retryable([{ name: 'gnosis', steps: ['Boots on its real network', 'Upgrades a box in place (production image, then this build on the same volume)'] }]));
  assert.ok(!retryable([{ name: 'gnosis', steps: ['Boots on its real network', 'Every option we pass exists in teku --help'] }]), 'every failed step counts, not only the first');
  assert.ok(!retryable([]));
  const d = decide({ ...base, checks: 'failure', rerun: 'gnosis: Boots on its real network' });
  assert.equal(d.action, 'wait');
  assert.equal(d.cause, 'rerun');
});

test('a release required for one network only does not skip the DAppNode wait for the others', () => {
  const hit = { tag: '26.4.0', source: 'release notes of 26.4.0: "required update for Gnosis nodes"' };
  const one = combineMandatory(['gnosis', 'mainnet'], { gnosis: hit });
  assert.equal(one.mandatory, null);
  assert.deepEqual(one.partial.map((p) => p.network), ['gnosis']);
  assert.equal(decide({ ...base, mandatory: one.mandatory }).action, 'wait');
  const all = combineMandatory(['gnosis', 'mainnet'], { gnosis: hit, mainnet: { ...hit, source: 'x' } });
  assert.ok(all.mandatory);
  assert.equal(decide({ ...base, mandatory: all.mandatory }).cause, 'mandatory');
  assert.ok(combineMandatory(['mainnet'], { mainnet: hit }).mandatory, 'gnosis held: mainnet alone decides');
  assert.equal(combineMandatory([], {}).mandatory, null);
});

test('a release required for one network only does not wait silently: the owner gets an issue once only DAppNode is missing', () => {
  const hit = { tag: '26.4.0', source: 'release notes of 26.4.0: "required update for Gnosis nodes"' };
  const { mandatory, partial } = combineMandatory(['gnosis', 'mainnet'], { gnosis: hit });
  const waiting = decide({ ...base, mandatory });
  assert.equal(waiting.cause, 'dappnode');
  const n = partialMandatoryNotice(waiting, partial);
  assert.equal(n.cause, 'partial-mandatory');
  assert.deepEqual(n.networks, ['gnosis']);
  assert.equal(n.fallbackAt, waiting.fallbackAt);
  // Not while the checks run, the branch is behind or something blocks, and not without a required network.
  assert.equal(partialMandatoryNotice(decide({ ...base, mandatory, checks: 'pending' }), partial), null);
  assert.equal(partialMandatoryNotice(decide({ ...base, mandatory, upToDate: false }), partial), null);
  assert.equal(partialMandatoryNotice(decide({ ...base, mandatory, checks: 'failure' }), partial), null);
  assert.equal(partialMandatoryNotice(decide({ ...base, mandatory, now: at(72) }), partial), null, 'the fallback merges');
  assert.equal(partialMandatoryNotice(waiting, []), null);
  const text = (shadow) => issueText({
    repo: 'o/r', pr: { number: 7 }, target: '26.4.0', mainTeku: '26.3.0', decision: { ...n, shadow }, dn: null, dnText: 'pending',
    checks: { state: 'success' }, failed: { runId: null, jobs: [] }, runUrl: 'https://x/run', mandatoryHits: { gnosis: hit },
  });
  const { title, body } = text(false);
  assert.match(title, /^\[your call\] Teku 26\.4\.0: required for gnosis only/);
  assert.match(body, /Create a merge commit/);
  assert.match(body, /Do not change any files and do not merge\./);
  assert.match(body, /Required upgrade for: gnosis/);
  assert.doesNotMatch(body, /PIPELINE_MODE is not/);
  assert.match(text(true).body, /PIPELINE_MODE is not "on"/);
});

test('the bump PR marker names its Teku version (closing the PR skips that version)', () => {
  assert.equal(markerTarget(`${bumpMarker('26.10.0')}\n## Teku 26.10.0`), '26.10.0');
  assert.equal(markerTarget(`${bumpMarker(null)}\n## TEST`), null, 'a [TEST] PR never skips a real version');
  assert.equal(markerTarget('no marker'), null);
});

test('holds: the first line that is not a comment is the reason; no file means not held', () => {
  // A temporary folder, so the test does not depend on which networks are held now.
  const dir = mkdtempSync(join(tmpdir(), 'hold-'));
  mkdirSync(join(dir, 'package_variants/gnosis'), { recursive: true });
  mkdirSync(join(dir, 'package_variants/mainnet'), { recursive: true });
  writeFileSync(join(dir, 'package_variants/gnosis/hold'), '\n# why\nwaits for the catch-up\n# more\n');
  writeFileSync(join(dir, 'package_variants/mainnet/hold'), '# only comments\n');
  assert.equal(holdReason(dir, 'gnosis'), 'waits for the catch-up');
  assert.equal(holdReason(dir, 'mainnet'), 'held (no reason given)');
  assert.equal(holdReason(dir, 'hoodi'), null);
});

test('the content id ignores release records only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-id-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  mkdirSync(join(dir, 'package_variants/mainnet'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts/ci/content-id.sh'), join(dir, 'scripts/ci/content-id.sh'));
  writeFileSync(join(dir, 'package_variants/mainnet/dappnode_package.json'), '{"version":"0.0.76"}\n');
  const commit = (msg) => { g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg); return g('rev-parse', 'HEAD'); };
  const a = commit('a');
  writeFileSync(join(dir, 'package_variants/mainnet/releases.json'), '{"0.0.76":{"hash":"/ipfs/Qm"}}\n');
  const b = commit('Release teku 0.0.76');
  writeFileSync(join(dir, 'package_variants/mainnet/dappnode_package.json'), '{"version":"0.0.77"}\n');
  const c = commit('c');
  assert.equal(contentId(dir, a), contentId(dir, b), 'a Release commit does not change the content id');
  assert.notEqual(contentId(dir, b), contentId(dir, c));
  assert.match(contentId(dir, a), /^[0-9a-f]{40}$/);
});
