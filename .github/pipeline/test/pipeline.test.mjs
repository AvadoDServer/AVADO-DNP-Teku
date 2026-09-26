// Unit tests for the pipeline rules: node --test ".github/pipeline/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { decide } from '../gate.mjs';
import { reportVerdict, summarize } from '../lib/dappnode.js';
import { checkMandatory } from '../lib/mandatory.js';
import {
  compareVersions, bumpPatch, maxVersion, stableReleases, readTekuVersion, setTekuVersion, setManifestVersion,
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
  const edited = setTekuVersion(compose, '26.99.0');
  assert.equal(readTekuVersion(edited), '26.99.0');
  assert.equal(edited.split('\n').filter((l, i) => l !== compose.split('\n')[i]).length, 1);
  assert.equal(setTekuVersion(edited, now), compose);
  for (const net of ['mainnet', 'gnosis']) {
    const text = readFileSync(join(ROOT, 'package_variants', net, 'dappnode_package.json'), 'utf8');
    const v = JSON.parse(text).version;
    const out = setManifestVersion(text, bumpPatch(v));
    assert.equal(JSON.parse(out).version, bumpPatch(v));
    assert.equal(out.split('\n').filter((l, i) => l !== text.split('\n')[i]).length, 1);
  }
  assert.throws(() => readTekuVersion('services:\n  a:\n    build:\n      args:\n        TEKU_VERSION: 1.0.0\n        TEKU_VERSION: 2.0.0\n'));
});
