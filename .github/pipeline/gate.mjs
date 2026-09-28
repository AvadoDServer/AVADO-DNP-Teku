#!/usr/bin/env node
// Gate (gate.yml, every 4 hours and whenever the PR checks finish): decides
// whether the bump bot's PR may be merged, and merges it; and makes sure every
// version on the default branch gets its release run.
//
// Merge (a merge commit, never squash) only when our checks ("avado/checks",
// set by this repo's PR-checks workflow) are green on the PR head, the branch
// contains the current default branch, no person changed the checks or the
// pipeline on the branch, and
//   - DAppNode's real-node result for the same Teku version is good (their
//     bump PR tropibot/bump-teku-<version>: a bound PASSED report showing the
//     version, their validator attesting after the merge, or their published
//     release), read strictly by the watcher's rules (report section 2.5), or
//   - DAppNode has no usable answer (none yet, their machine or build broke)
//     and 72 hours have passed since the Teku release, or
//   - the release notes (or the watcher) mark the release as required for
//     EVERY network the PR releases (required for one network only: it waits
//     like any other release).
// Never merge when our checks failed, DAppNode says the client failed or its
// result cannot be read, or anything else is unclear: then an issue assigned
// to the owner explains it and carries a ready-to-paste Claude Code prompt.
// A check that failed only on something outside our package (the AVADOSDK
// build, the boot test, the proof, the upgrade test, a runner step) is run once
// more first (GitHub "re-run failed jobs"), without an email.
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN   this repo (contents, pull requests, issues,
//                                      statuses write; actions write to re-run the
//                                      checks and start release.yml)
//   WATCHER_READ_TOKEN                 optional: reads the release watcher's URGENT
//                                      issues (AvadoDServer/avado-release-control)
//   PIPELINE_MODE                      shadow (default, also when not set: decide
//                                      and comment, never merge) | on (merge) | off
//   PIPELINE_OWNER                     who gets the issues (default flisko)
//   GATE_FALLBACK_HOURS                default 72
//   GITHUB_SERVER_URL, GITHUB_RUN_ID   for links to this run
// Run in a checkout of the default branch with full history (fetch-depth: 0).

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeClient } from './lib/gh.js';
import { readDappnode, describe } from './lib/dappnode.js';
import { checkMandatory } from './lib/mandatory.js';
import { upsertIssue, closeIssue, findIssue, listOpenIssues } from './lib/issue.js';
import {
  BOT_EMAIL, BOT_BRANCH, UPSTREAM_REPO, DAPPNODE, RULE_NETWORK, PR_CHECKS_PATH, compareVersions, bare, stableReleases,
  readTekuVersion, variantsAt, holdReason, releasedVersions, git, fetchBranch, retry, isTransient, env, hoursBetween, fmtUtc,
  recordFailure,
} from './lib/common.js';

export const CHECKS_CONTEXT = 'avado/checks';
export const GATE_CONTEXT = 'avado/gate';
const GATE_COMMENT = '<!-- avado-bot:gate -->';
const ALLOWED_BOT_FILES = /^(docker-compose\.yml|package_variants\/[a-z0-9-]+\/dappnode_package\.json)$/;
// Files a person may change on the bot branch and still let the gate merge:
// the build (build/), the compose file and the variant manifests. Anything else
// (the checks, the proof and its expected differences, the pipeline, holds and
// release records) is merged only by the owner, after reading it.
export const OWNER_MERGE_FILES = /^(\.github\/|scripts\/|package_variants\/[^/]+\/(?!dappnode_package\.json$))/;
// Steps whose failure is usually outside our package (public network, IPFS node,
// production store, Docker Hub, the runner): they are re-run once.
export const RETRYABLE_STEPS = /^(AVADOSDK build|Boots on its real network|Upgrades a box in place|Equivalence proof|Throwaway IPFS node|Teku image digest|Free disk space|Set up job|Run actions\/|Post Run actions\/|Complete job)/;

// The rules, as a pure function (tested in test/pipeline.test.mjs).
//   checks: 'success' | 'failure' | 'error' | 'pending' | 'missing'
//   dn: { level: 'GOOD' | 'WAIT' | 'BLOCK', verdict } or null when it could not be read
//   mandatory: set only when the release is required for EVERY network the PR releases
//   rerun: a re-run of checks that failed on an outside cause was just started
export function decide({ checks, dn, mandatory, releasedAt, now, upToDate, conflict, errors = [], unexpectedFiles = [], ownerFiles = [], rerun = null, fallbackHours = 72, headAt = null, silentHours = 6 }) {
  if (errors.length) return { action: 'block', cause: 'unclear', why: `could not read everything needed: ${errors.join('; ')}` };
  if (unexpectedFiles.length) return { action: 'block', cause: 'unexpected-files', why: `bot commits change files a bump never touches: ${unexpectedFiles.join(', ')}` };
  if (ownerFiles.length) return { action: 'block', cause: 'owner-merge', why: `a person changed files the gate never merges by itself (${ownerFiles.slice(0, 5).join(', ')}${ownerFiles.length > 5 ? ', ...' : ''}); the owner reviews and merges this PR` };
  if (conflict) return { action: 'block', cause: 'conflict', why: 'the PR conflicts with the default branch' };
  if (rerun) return { action: 'wait', cause: 'rerun', why: `our checks failed on something outside our package (${rerun}); they are being run once more` };
  if (checks === 'failure' || checks === 'error') return { action: 'block', cause: 'checks-failed', why: 'our checks failed' };
  if (!releasedAt) return { action: 'block', cause: 'unclear', why: 'there is no published Teku release for this version' };
  if (!dn) return { action: 'block', cause: 'unclear', why: "DAppNode's result could not be read" };
  if (dn.level === 'BLOCK') {
    return dn.verdict === 'client-fail'
      ? { action: 'block', cause: 'dappnode-failed', why: 'Teku failed DAppNode\'s real-node test' }
      : { action: 'block', cause: 'dappnode-unclear', why: 'DAppNode\'s real-node result for this version cannot be read as a pass' };
  }
  if (checks !== 'success') {
    // Checks that never report must not make the gate wait silently forever.
    const waited = headAt ? hoursBetween(headAt, now) : 0;
    if (waited >= silentHours) return { action: 'block', cause: 'unclear', why: `our checks have not reported a result ${Math.floor(waited)} h after the last push (status: ${checks})` };
    return { action: 'wait', cause: 'checks', why: checks === 'missing' ? 'our checks have not started yet' : 'our checks are running' };
  }
  if (!upToDate) return { action: 'wait', cause: 'behind', why: 'the branch is behind the default branch; the bump bot refreshes it' };
  if (dn.level === 'GOOD') return { action: 'merge', cause: 'dappnode-good', why: `our checks are green and DAppNode's real-node test passed (${dn.verdict})` };
  if (mandatory) return { action: 'merge', cause: 'mandatory', why: `our checks are green and Teku marks this release as required for every network it releases (${mandatory.source})` };
  const age = hoursBetween(releasedAt, now);
  if (age >= fallbackHours) return { action: 'merge', cause: 'fallback', why: `our checks are green, DAppNode has no usable result, and ${Math.floor(age)} h passed since the Teku release (fallback after ${fallbackHours} h)` };
  const at = new Date(new Date(releasedAt).getTime() + fallbackHours * 3600000);
  return { action: 'wait', cause: 'dappnode', why: `waiting for DAppNode's real-node test; merges without it after ${fmtUtc(at)}`, fallbackAt: at.toISOString() };
}

// Required-release hits per network -> the one "mandatory" decide() uses: only
// when EVERY network the PR releases is required. Otherwise the hits are only shown.
export function combineMandatory(nets, hits) {
  const found = nets.filter((n) => hits[n]);
  if (!nets.length || found.length !== nets.length) return { mandatory: null, partial: found.map((n) => ({ network: n, ...hits[n] })) };
  const sources = [...new Set(found.map((n) => hits[n].source))];
  return { mandatory: { tag: hits[found[0]].tag, source: sources.join('; ') }, partial: [] };
}

// A release required for SOME of the networks the PR releases (a Gnosis fork,
// for example) still waits for DAppNode or the fallback, because a required
// release skips DAppNode's second opinion only when every network needs it. It
// must not wait silently, though: once our checks are green and only DAppNode
// is missing, the owner gets an issue and can merge by hand. Returns what the
// issue is about, or null.
export function partialMandatoryNotice(decision, partial) {
  if (!partial?.length || decision?.action !== 'wait' || decision.cause !== 'dappnode') return null;
  const networks = partial.map((p) => p.network);
  const sources = [...new Set(partial.map((p) => p.source))].join('; ');
  return {
    action: 'notify',
    cause: 'partial-mandatory',
    networks,
    sources,
    fallbackAt: decision.fallbackAt,
    why: `Teku marks this release as required for ${networks.join(' and ')} only (${sources}); our checks are green, and the gate waits for DAppNode's real-node test until ${decision.fallbackAt ? fmtUtc(decision.fallbackAt) : 'the 72 h fallback'}`,
  };
}

// Which files make the PR the owner's to merge (people's commits only).
export function ownerMergeFiles(files, botOnly) {
  return botOnly ? [] : files.filter((f) => OWNER_MERGE_FILES.test(f));
}

// Did every failed job of a checks run fail only on outside steps? (A job lost
// without a failed step, for example a runner that went away, counts as outside.)
export function retryable(jobs) {
  return jobs.length > 0 && jobs.every((j) => {
    const steps = j.steps || (j.step ? [j.step] : []);
    return steps.every((s) => RETRYABLE_STEPS.test(s));
  });
}

// --- reading --------------------------------------------------------------------

// The "avado/checks" status on the PR head, accepted only from this repo's
// PR-checks workflow (a run in this repo, not a fork, for this commit).
async function checksState(gh, repo, sha) {
  const statuses = await gh.paginate(`repos/${repo}/commits/${sha}/statuses`, { maxPages: 3 });
  const mine = statuses.filter((s) => s.context === CHECKS_CONTEXT && s.creator?.login === 'github-actions[bot]');
  const latest = mine.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  if (!latest) return { state: 'missing' };
  const runId = /\/actions\/runs\/(\d+)/.exec(latest.target_url || '')?.[1];
  if (!runId) return { state: 'missing', note: 'the status does not link a PR-checks run' };
  let run;
  try {
    run = await gh.get(`repos/${repo}/actions/runs/${runId}`);
  } catch (err) {
    return { state: 'missing', note: `the linked run ${runId} could not be read (${err.message.slice(0, 80)})` };
  }
  if (run.path !== PR_CHECKS_PATH || !run.head_repository || run.head_repository.id !== run.repository?.id) {
    return { state: 'missing', note: `the status comes from ${run.path || 'an unknown workflow'}${run.head_repository?.id !== run.repository?.id ? ' in a fork' : ''}, not from this repo's PR checks` };
  }
  if (run.event === 'pull_request' && run.head_sha !== sha) return { state: 'missing', note: `the linked run checked ${run.head_sha.slice(0, 7)}` };
  let state = latest.state;
  // A run that is running again (a re-run) counts as running, whatever it said before.
  if (run.status !== 'completed') state = 'pending';
  return { state, url: latest.target_url, description: latest.description, runId, run };
}

// The useful part of a failed job's log: the lines that say what failed, and
// the last lines before the first error (setup and cleanup noise dropped).
export function logExcerpt(log) {
  const lines = String(log || '')
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, ''));
  const firstError = lines.findIndex((l) => l.startsWith('##[error]'));
  const upto = firstError === -1 ? lines : lines.slice(0, firstError + 1);
  const noise = /^(##\[(group|endgroup)\]|shell: |env:$|\s+[A-Z_]+: |\[command\]|Post job cleanup|Cleaning up orphan)/;
  const useful = upto.filter((l) => l.trim() && !noise.test(l));
  const key = useful.filter((l) => /(^|\s)FAIL\b|FAIL:|MISSING|^##\[error\]|^-{5} |^ {4}[-+]|\bError: |rc=[1-9]/.test(l)).slice(0, 30);
  const tail = useful.slice(-25).filter((l) => !key.includes(l));
  return [...key, ...(tail.length ? ['...', ...tail] : [])].join('\n').slice(0, 6000);
}

async function failedJobs(gh, repo, runId, { logs = true } = {}) {
  if (!runId) return { runId: null, jobs: [] };
  const data = await gh.get(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const jobs = [];
  // "avado/checks" only sums up the others.
  for (const j of (data?.jobs || []).filter((x) => x.conclusion === 'failure' && x.name !== CHECKS_CONTEXT)) {
    const steps = (j.steps || []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
    const step = steps.join('", "') || null;
    let excerpt = '';
    if (logs) {
      try {
        excerpt = logExcerpt(await gh.redirectedText(`repos/${repo}/actions/jobs/${j.id}/logs`));
      } catch (err) {
        excerpt = `(log not readable: ${err.message})`;
      }
    }
    jobs.push({ name: j.name, url: j.html_url, step, steps, excerpt });
  }
  return { runId, jobs };
}

// The watcher's URGENT issues for Teku, per network. Returns { hits, read }:
// read says whether the watcher could be read, so a broken read is shown.
async function watcherMandatory(names, from, to) {
  const tok = env('WATCHER_READ_TOKEN');
  const watcher = env('WATCHER_REPO', 'AvadoDServer/avado-release-control');
  if (!tok) return { hits: {}, read: 'not read (no WATCHER_READ_TOKEN)' };
  try {
    const gh = makeClient({ token: tok });
    const issues = await gh.get(`repos/${watcher}/issues?state=open&labels=urgent&per_page=100`);
    const hits = {};
    for (const i of issues || []) {
      const key = /<!-- avado-watch:urgent key=(\S+) -->/.exec(i.body || '')?.[1] || '';
      const m = /^(teku[a-z-]*\.avado\.dnp\.dappnode\.eth)@(v?\d+\.\d+\.\d+)$/.exec(key);
      const net = m && Object.keys(names).find((n) => names[n] === m[1]);
      if (net && !hits[net] && compareVersions(bare(m[2]), from) > 0 && compareVersions(bare(m[2]), to) <= 0) {
        hits[net] = { tag: m[2], source: `the release watcher: ${i.html_url}` };
      }
    }
    return { hits, read: 'read' };
  } catch (err) {
    console.log(`::warning::could not read the watcher's URGENT issues (${err.message}); using the release notes only`);
    return { hits: {}, read: `unreadable (${err.status ? `HTTP ${err.status}` : err.message.slice(0, 60)})` };
  }
}

// Every version on the default branch gets a release run: if a network that is
// not held has a version without a "Release ..." commit and no release run ran
// on the current head, start one (a gate merge made with GITHUB_TOKEN starts no
// push workflow, and the dispatch after it may have failed).
async function reconcileReleases(gh, repo, base, root, say) {
  const ref = `origin/${base}`;
  const head = git(root, ['rev-parse', ref]);
  const missing = [];
  for (const net of variantsAt(root, ref)) {
    if (holdReason(root, net, ref)) continue;
    const m = JSON.parse(git(root, ['show', `${ref}:package_variants/${net}/dappnode_package.json`]));
    let record = {};
    try { record = JSON.parse(git(root, ['show', `${ref}:package_variants/${net}/releases.json`])); } catch { /* none yet */ }
    if (record[m.version]?.hash || releasedVersions(root, m.name, ref).includes(m.version)) continue;
    missing.push(`${m.name} ${m.version}`);
  }
  if (!missing.length) return;
  const runs = await gh.get(`repos/${repo}/actions/workflows/release.yml/runs?per_page=30`);
  const onHead = (runs?.workflow_runs || []).find((r) => r.head_sha === head);
  if (onHead) {
    say(`- not released yet on ${base}: ${missing.join(', ')}; release run ${onHead.html_url} (${onHead.status}${onHead.conclusion ? `, ${onHead.conclusion}` : ''}) covers it${onHead.conclusion === 'failure' ? ' (its failure issue says what to do)' : ''}`);
    return;
  }
  await retry('starting release.yml', () => gh.post(`repos/${repo}/actions/workflows/release.yml/dispatches`, { ref: base }));
  say(`- not released yet on ${base}: ${missing.join(', ')}, and no release run ran on ${head.slice(0, 7)}: started release.yml`);
}

// --- the issue text ------------------------------------------------------------------

export function issueText({ repo, pr, target, mainTeku, decision, dn, dnText, checks, failed, runUrl, mandatoryHits }) {
  const server = env('GITHUB_SERVER_URL', 'https://github.com');
  const prUrl = `${server}/${repo}/pull/${pr.number}`;
  const headline = {
    'checks-failed': `our checks failed for Teku ${target}`,
    'dappnode-failed': `Teku ${target} failed DAppNode's real-node test`,
    'dappnode-unclear': `DAppNode's result for Teku ${target} is unclear`,
    'owner-merge': `a person changed the checks or the pipeline on the Teku ${target} PR: please review and merge`,
    conflict: `the Teku ${target} PR conflicts with main`,
    'unexpected-files': `the bump PR changes unexpected files`,
    unclear: `the gate could not decide on Teku ${target}`,
    'partial-mandatory': `required for ${(decision.networks || []).join(' and ')} only: merge it yourself if it cannot wait for DAppNode`,
  }[decision.cause] || decision.why;
  const title = `${decision.cause === 'partial-mandatory' ? '[your call]' : '[needs fix]'} Teku ${target}: ${headline}`;

  const facts = [
    `- Pull request: ${prUrl} (branch \`${BOT_BRANCH}\`, Teku ${mainTeku} → ${target})`,
    `- Our checks: **${checks.state}**${checks.url ? ` ([run](${checks.url}))` : ''}${checks.note ? ` (${checks.note})` : ''}`,
    `- DAppNode: ${dnText}${dn?.pr?.url ? ` ([their PR](${dn.pr.url}))` : ''}${dn?.summary?.url ? ` ([report](${dn.summary.url}))` : ''}`,
    `- Gate run: ${runUrl}`,
  ];
  const required = Object.entries(mandatoryHits || {}).map(([n, h]) => `${n} (${h.source})`);
  if (required.length) facts.push(`- Required upgrade for: ${required.join('; ')}`);

  let what = '';
  let prompt = '';
  const rules = `Rules:
- Never change package names, volumes, host ports or environment variable names in package_variants/*/dappnode_package.json, and keep the versions the bot set there.
- Keep Teku's command line the same except for what Teku ${target} requires (for example a renamed or removed option in build/startTeku.sh or build/teku-config*.template; compare with \`docker run --rm --entrypoint /opt/teku/bin/teku consensys/teku:${target} --help\`). Hidden \`--X...\` options (such as \`--Xp2p-quic-enabled=false\`, which keeps QUIC off for Gnosis; README "Gnosis") are not in --help: the equivalence proof checks them per network (candidate-hidden-options); look for them in Teku's release notes and source, and never drop one without keeping what it does (for Gnosis: no QUIC on a port the manifest does not publish). If Teku no longer lets QUIC be turned off, do not add a port and do not drop the option: stop and tell me to hold gnosis (README "Holds"), so mainnet keeps shipping.
- Do not edit .github/**, scripts/** (the checks, the proof and its expected differences) or package_variants/<network>/ files other than dappnode_package.json. If the fix really needs that (for example scripts/prove-equivalence.sh --update-expected after a start-script change), make the change in a separate commit, say so clearly, and tell me that I must review and merge the PR myself: the gate never merges such a PR by itself.
- Before pushing, run the checks that failed locally (README.md, section "Checks"), for example scripts/ci/check-flags.sh on an image built with scripts/render.sh, and scripts/prove-equivalence.sh --manifests-only.
- Commit with a clear message and push to ${BOT_BRANCH}. Do not merge the PR yourself: the checks run again and the gate merges when they are green.`;

  if (decision.cause === 'checks-failed') {
    const jobs = failed.jobs.length
      ? failed.jobs.map((j) => `### ${j.name}${j.step ? ` (step "${j.step}")` : ''}\n${j.url}\n\n\`\`\`text\n${j.excerpt}\n\`\`\``).join('\n\n')
      : '(the failed jobs could not be listed; open the run link)';
    const holdTip = required.length
      ? `\n\nThis release is **required** (${required.join('; ')}). If only one network fails and you need the others out now: hold the failing network (add \`package_variants/<network>/hold\` with a one-line reason in a PR you merge yourself); the other networks then pass and ship, and the held one keeps its current version.`
      : '';
    what = `The automatic update to Teku ${target} stopped because our checks failed. The gate already ran the failed checks once more if they looked like an outside problem. Nothing was merged or released; boxes are not affected.${holdTip}\n\n${jobs}`;
    prompt = `In the AVADO-DNP-Teku repository (${repo}), pull request #${pr.number} on branch ${BOT_BRANCH} moves the networks that are not held from Teku ${mainTeku} to Teku ${target}. Its checks failed:
${failed.jobs.map((j) => `- ${j.name}${j.step ? `, step "${j.step}"` : ''}: ${j.url}`).join('\n') || `- see ${checks.url}`}
Download the logs with: gh run download ${failed.runId || '<run id>'} -R ${repo}
First decide whether the cause is outside our package: the checkpoint endpoint, too few peers or a head that did not move on a GitHub runner, AVADO's IPFS node, bo.ava.do, Docker Hub or the runner itself. If so, do not change any files: run \`gh run rerun ${failed.runId || '<run id>'} -R ${repo} --failed\` and tell me.
Otherwise find why the check fails with Teku ${target} (read the Teku ${target} release notes: https://github.com/${UPSTREAM_REPO}/releases/tag/${target}) and fix it on this branch.
${rules}`;
  } else if (decision.cause === 'dappnode-failed' || decision.cause === 'dappnode-unclear') {
    const readerNote = decision.cause === 'dappnode-unclear' && /could not be read|does not show/.test(dn?.summary?.why || '')
      ? `\n\nOur reader says: "${dn.summary.why}". If every DAppNode result suddenly reads like this, DAppNode may have changed its report format: the reader is .github/pipeline/lib/dappnode.js, a copy of the release watcher's bot/lib/dappnode.js (fix it there first, then copy it here).`
      : '';
    what = `DAppNode's real-node test of Teku ${target} did not pass: ${dnText}. Our pipeline does not merge a version DAppNode saw fail. Nothing was merged or released; boxes are not affected.

It clears by itself when DAppNode posts a passing result (also when DAppNode merges its PR and its validator test passes), or when a newer Teku release replaces this one (the bump bot then updates the PR). If you decide Teku ${target} is safe anyway (for example the report shows that DAppNode's own machine failed), merge ${prUrl} yourself with **"Create a merge commit"**: the release workflow then publishes it to staging as usual. To skip this version, close the PR: the bump bot then waits for the next Teku release (reopen the PR to undo).${readerNote}`;
    prompt = `DAppNode's real-node test of Teku ${target} (their PR ${dn?.pr?.url || '(not found)'}, report ${dn?.summary?.url || '(none)'}) says: ${dnText}${dn?.summary?.error ? `; error: ${dn.summary.error}` : ''}.
Read their report and the Teku ${target} release notes (https://github.com/${UPSTREAM_REPO}/releases/tag/${target}) and tell me in plain words whether the failure is caused by Teku itself or by DAppNode's test setup, and whether AVADO boxes (Teku with our flags in ${repo} build/startTeku.sh) could be affected. If our reader in .github/pipeline/lib/dappnode.js misread a report whose format changed, say so. Do not change any files.`;
  } else if (decision.cause === 'owner-merge') {
    what = `Someone pushed commits to the bot's PR that change files the gate never merges by itself: the checks, the equivalence proof or its expected differences, the pipeline, a hold or a release record. Such a change can weaken the checks for every later release, so a person must read it. Nothing was merged or released; boxes are not affected.

**What to do:** open ${prUrl}, read the changes to those files, and if they are right, merge it yourself with **"Create a merge commit"** (the release then publishes it to staging as usual). If not, remove those commits from the branch.`;
    prompt = `In ${repo}, pull request #${pr.number} (branch ${BOT_BRANCH}, Teku ${mainTeku} → ${target}) has commits by people that change: ${decision.why}.
Show me those changes (gh pr diff ${pr.number} -R ${repo}) and explain in plain words what each one does and whether it weakens a check or changes what boxes run. Do not change any files and do not merge.`;
  } else if (decision.cause === 'partial-mandatory') {
    const nets = (decision.networks || []).join(' and ');
    const until = decision.fallbackAt ? fmtUtc(decision.fallbackAt) : 'the 72 h fallback';
    what = `Nothing is broken and nothing was released yet. Teku ${target} is marked as **required** for ${nets} (${decision.sources}), but not for every network in the PR. The gate skips DAppNode's second opinion only when a release is required for every network it releases, so it keeps waiting for DAppNode's real-node test (DAppNode tests Teku on Hoodi, not on Gnosis) and merges by itself at ${until} at the latest. Our checks are green.

This issue is here so a required upgrade never waits silently: decide whether ${until} is soon enough (for example for a fork date in the release notes).
- **It can wait:** do nothing. The gate merges when DAppNode's test passes or at ${until}, and this issue then closes by itself.
- **It cannot wait:** merge ${prUrl} yourself with **"Create a merge commit"**. Every network in the PR goes to staging, as after a gate merge; our checks tested all of them. The other networks then reach staging without DAppNode's second opinion: you can wait with promoting those in editstore until the PR comment shows DAppNode's result.${decision.shadow ? `

Note: PIPELINE_MODE is not "on", so the gate only comments and never merges: in this mode the PR is merged by hand either way.` : ''}`;
    prompt = `In ${repo}, pull request #${pr.number} (branch ${BOT_BRANCH}) moves Teku ${mainTeku} → ${target}. Teku ${target} is marked as required for ${nets}: ${decision.sources}. The gate waits for DAppNode's real-node test and merges by itself at ${until} at the latest.
Read the release notes of every Teku release after ${mainTeku} up to ${target} (https://github.com/${UPSTREAM_REPO}/releases) and tell me in plain words: why it is required for ${nets}, by when boxes on ${nets} must run it (a fork date or epoch, in UTC), and whether waiting until ${until}, plus the time I need to promote it from staging to production in editstore, is safe. Say clearly whether I should merge PR #${pr.number} myself now. Do not change any files and do not merge.`;
  } else if (decision.cause === 'conflict') {
    what = `The PR cannot be merged because it conflicts with the default branch, and it has commits by people, so the bot does not rebuild it.`;
    prompt = `In ${repo}, pull request #${pr.number} (branch ${BOT_BRANCH}) conflicts with main. Check it out (gh pr checkout ${pr.number} -R ${repo}), merge main into it, resolve the conflicts keeping TEKU_VERSION ${target}, its TEKU_DIGEST and the bot's package versions, and push.
${rules}`;
  } else {
    what = `The gate stopped: ${decision.why}. Nothing was merged or released; boxes are not affected.`;
    prompt = `In ${repo}, the release gate stopped on pull request #${pr.number} (Teku ${mainTeku} → ${target}) with: "${decision.why}". Gate run: ${runUrl}. Find out why and tell me what to do; change files only on branch ${BOT_BRANCH}.
${rules}`;
  }

  const body = `**What happened:** ${decision.why}.

${what}

**${decision.cause === 'partial-mandatory' ? 'How to decide with Claude Code' : 'How to fix it with Claude Code'}** (on your Mac):
\`\`\`bash
gh pr checkout ${pr.number} -R ${repo}
claude    # then paste the prompt below
\`\`\`

<details open><summary>Prompt for Claude Code</summary>

\`\`\`text
${prompt}
\`\`\`
</details>

**Facts**
${facts.join('\n')}

This issue updates itself on every gate run (every 4 hours and after each check run) and closes by itself when the cause is gone.`;
  return { title, body };
}

// --- main --------------------------------------------------------------------------------

async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const token = env('GITHUB_TOKEN');
  const mode = env('PIPELINE_MODE', 'shadow');
  const owner = env('PIPELINE_OWNER', 'flisko');
  const fallbackHours = Number(env('GATE_FALLBACK_HOURS', '72'));
  const runUrl = `${env('GITHUB_SERVER_URL', 'https://github.com')}/${repo}/actions/runs/${env('GITHUB_RUN_ID', '0')}`;
  const now = new Date(env('GATE_NOW', new Date().toISOString()));
  const root = process.cwd();
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  if (mode === 'off') return console.log('PIPELINE_MODE is off: nothing to do.');
  const merging = mode === 'on';
  const gh = makeClient({ token });
  const out = [];
  const say = (s) => { console.log(s); out.push(s); };
  if (!merging) say(`PIPELINE_MODE is ${env('PIPELINE_MODE') ? `"${mode}"` : 'not set'}: shadow mode, the gate decides and comments but never merges (set it to "on" to merge).`);

  const meta = await gh.get(`repos/${repo}`);
  const base = meta.default_branch;
  fetchBranch(root, token, base);
  await reconcileReleases(gh, repo, base, root, say);

  const prs = await gh.get(`repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${encodeURIComponent(BOT_BRANCH)}`);
  const pr = (prs || [])[0];

  // Issues of PRs that are gone close themselves.
  for (const i of await listOpenIssues(gh, repo)) {
    const n = /^pr-(\d+)$/.exec(i.key || '')?.[1];
    if (n && (!pr || Number(n) !== pr.number)) {
      const old = await gh.get(`repos/${repo}/pulls/${n}`);
      if (old.state !== 'open') await closeIssue(gh, repo, i, `Closed: PR #${n} is ${old.merged_at ? 'merged' : 'closed'}.`);
    }
  }
  if (!pr) {
    say('No open bump PR: nothing to gate.');
    return finish(out);
  }

  const full = await gh.get(`repos/${repo}/pulls/${pr.number}`);
  const sha = full.head.sha;
  const errors = [];
  const safe = async (what, fn) => { try { return await fn(); } catch (err) { errors.push(`${what}: ${err.message}`); return null; } };

  const target = readTekuVersion(await gh.file(repo, 'docker-compose.yml', sha));
  const mainTeku = readTekuVersion(await gh.file(repo, 'docker-compose.yml', base));
  const checks = await checksState(gh, repo, sha);
  const cmp = await gh.get(`repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`);
  const upToDate = cmp.behind_by === 0;
  const conflict = full.mergeable === false && full.mergeable_state === 'dirty';

  // Bot-only PRs may change only the bump's files; people's commits may not
  // change the checks or the pipeline without the owner's own merge.
  const commits = await gh.get(`repos/${repo}/pulls/${pr.number}/commits?per_page=100`);
  const botOnly = (commits || []).every((c) => c.commit?.author?.email === BOT_EMAIL);
  const headAt = (commits || []).at(-1)?.commit?.committer?.date || null;
  const files = ((await gh.paginate(`repos/${repo}/pulls/${pr.number}/files`, { maxPages: 30 })) || []).map((f) => f.filename);
  const unexpectedFiles = botOnly ? files.filter((f) => !ALLOWED_BOT_FILES.test(f)) : [];
  const ownerFiles = ownerMergeFiles(files, botOnly);

  // The networks this PR releases: those not held on the default branch (a PR
  // that adds or removes a hold is the owner's to merge anyway).
  const ref = `origin/${base}`;
  const nets = variantsAt(root, ref).filter((n) => !holdReason(root, n, ref));
  const names = Object.fromEntries(nets.map((n) => [n, JSON.parse(git(root, ['show', `${ref}:package_variants/${n}/dappnode_package.json`])).name]));

  // Upstream: the release of the target and everything between main and it.
  const rels = await safe('Teku releases', () => gh.get(`repos/${UPSTREAM_REPO}/releases?per_page=40`));
  const stable = stableReleases(rels || []);
  const release = stable.find((r) => bare(r.tag_name) === target) || null;
  const covered = stable.filter((r) => compareVersions(bare(r.tag_name), mainTeku) > 0 && compareVersions(bare(r.tag_name), target) <= 0);
  const hits = {};
  for (const r of covered) {
    for (const net of nets) {
      const hit = checkMandatory(r, ['release-wording'], { network: RULE_NETWORK[net] || 'ethereum-mainnet' });
      if (hit?.mandatory && !hits[net]) hits[net] = { tag: r.tag_name, source: `release notes of ${r.tag_name}: "${hit.quote}"` };
    }
  }
  const watcher = await watcherMandatory(names, mainTeku, target);
  for (const [net, h] of Object.entries(watcher.hits)) if (!hits[net]) hits[net] = h;
  const { mandatory, partial } = combineMandatory(nets, hits);

  const dn = await safe('DAppNode', () => readDappnode({ gh, cfg: DAPPNODE, tag: target, now: now.getTime() }));
  const dnText = dn ? `${describe(dn)}${dn.summary?.why ? `: ${dn.summary.why}` : ''}` : 'could not be read';

  // Checks that failed only on outside steps run once more (first attempt only).
  let rerun = null;
  if ((checks.state === 'failure' || checks.state === 'error') && checks.run) {
    const steps = await failedJobs(gh, repo, checks.runId, { logs: false });
    if (checks.run.run_attempt === 1 && retryable(steps.jobs)) {
      try {
        await gh.post(`repos/${repo}/actions/runs/${checks.runId}/rerun-failed-jobs`, {});
        rerun = steps.jobs.map((j) => `${j.name}: ${j.steps.join(', ') || 'no step'}`).join('; ');
      } catch (err) {
        console.log(`::warning::could not re-run the failed checks (${err.message})`);
      }
    }
  }

  const decision = decide({
    checks: checks.state,
    dn: dn ? { level: dn.summary.level, verdict: dn.summary.verdict } : null,
    mandatory,
    releasedAt: release?.published_at || null,
    now,
    upToDate,
    conflict,
    errors: errors.filter((e) => !e.startsWith('DAppNode')),
    unexpectedFiles,
    ownerFiles,
    rerun,
    fallbackHours,
    headAt,
  });

  const notice = partialMandatoryNotice(decision, partial);
  if (notice) notice.shadow = !merging;
  const requiredText = mandatory
    ? mandatory.source
    : partial.length
      ? `only for ${partial.map((p) => `${p.network} (${p.source})`).join('; ')}: waits for DAppNode as usual${notice ? ' (the owner has an issue to decide whether to merge by hand)' : ''}`
      : 'no';
  // DAppNode's real-node test (the gate's second opinion) runs Teku on Hoodi,
  // an Ethereum testnet: for the other chains nobody runs a real node before
  // staging, so the owner tests on the box before promoting (README).
  const noRealNode = nets.filter((n) => n !== 'mainnet');
  say(`PR #${pr.number} (${sha.slice(0, 7)}): Teku ${mainTeku} -> ${target}; networks: ${nets.join(', ') || 'none'}`);
  say(`- our checks: ${checks.state}${checks.url ? ` (${checks.url})` : ''}${checks.note ? ` (${checks.note})` : ''}`);
  say(`- DAppNode: ${dnText}${dn?.summary?.level ? ` [${dn.summary.level}]` : ''}`);
  say(`- Teku ${target} released: ${release ? fmtUtc(release.published_at) : 'no such release'}`);
  say(`- required upgrade: ${requiredText} (release watcher: ${watcher.read})`);
  say(`- branch contains ${base}: ${upToDate ? 'yes' : 'no'}${conflict ? ' (conflict)' : ''}`);
  if (ownerFiles.length) say(`- changed by people, owner merges: ${ownerFiles.join(', ')}`);
  say(`- DECISION: ${decision.action.toUpperCase()}: ${decision.why}${!merging && decision.action === 'merge' ? ' (shadow mode: not merging)' : ''}`);

  // Status on the PR head and one comment that is edited in place (no email).
  const statusState = { merge: 'success', wait: 'pending', block: 'failure' }[decision.action];
  const statusText = !merging && decision.action === 'merge' ? `shadow mode, would merge: ${decision.why}` : decision.why;
  await gh.post(`repos/${repo}/statuses/${sha}`, { state: statusState, context: GATE_CONTEXT, description: statusText.slice(0, 139), target_url: runUrl });
  const table = `${GATE_COMMENT}
### Gate: ${decision.action === 'merge' ? (!merging ? 'would merge (shadow mode)' : 'merging') : decision.action === 'wait' ? 'waiting' : 'stopped'}
${decision.why}.

| | |
|---|---|
| Networks released by this PR | ${nets.join(', ') || 'none'} |
| Our checks | ${checks.state}${checks.url ? ` ([run](${checks.url}))` : ''}${checks.note ? ` (${checks.note})` : ''} |
| DAppNode (Teku ${target}) | ${dnText}${dn?.pr?.url ? ` ([PR](${dn.pr.url}))` : ''} |
| Teku ${target} released | ${release ? fmtUtc(release.published_at) : '—'} |
| Fallback (no DAppNode answer) | ${release ? fmtUtc(new Date(release.published_at).getTime() + fallbackHours * 3600000) : '—'} |
| Required upgrade | ${requiredText} |
${noRealNode.map((n) => `| Real-node test of ${n} | none: DAppNode tests Teku on Hoodi only, and our checks run ${n} with a stand-in execution client. Test it on the box before you promote it in editstore (README "${n === 'gnosis' ? 'Gnosis' : 'How releases work now'}") |\n`).join('')}| Release watcher | ${watcher.read} |
| Up to date with ${base} | ${upToDate ? 'yes' : 'no'} |
| Mode | ${merging ? 'on (merges)' : 'shadow (never merges; set PIPELINE_MODE=on)'} |

Checked ${fmtUtc(now)} by ${runUrl}`;
  const comments = await gh.get(`repos/${repo}/issues/${pr.number}/comments?per_page=100`);
  const mine = (comments || []).find((c) => (c.body || '').startsWith(GATE_COMMENT));
  if (mine) await gh.patch(`repos/${repo}/issues/comments/${mine.id}`, { body: table });
  else await gh.post(`repos/${repo}/issues/${pr.number}/comments`, { body: table });

  const key = `pr-${pr.number}`;
  if (decision.action === 'block') {
    const failed = decision.cause === 'checks-failed' ? await failedJobs(gh, repo, checks.runId) : { runId: null, jobs: [] };
    const { title, body } = issueText({ repo, pr, target, mainTeku, decision, dn, dnText, checks, failed, runUrl, mandatoryHits: hits });
    const issue = await upsertIssue(gh, repo, {
      key, title, body, assignee: owner, state: `${decision.cause}@${target}@${sha.slice(0, 7)}`,
      changeNote: `New situation for Teku ${target} (head ${sha.slice(0, 7)}): ${decision.why}. The description above is up to date.`,
    });
    say(`- issue: ${issue.html_url}`);
  } else if (notice) {
    // Kept open while the gate waits (not closed as "resolved" by the branch
    // below); closed by the merge, or by the branch below once no network in
    // the PR is required any more. One comment (email) per Teku version.
    const { title, body } = issueText({ repo, pr, target, mainTeku, decision: notice, dn, dnText, checks, failed: { runId: null, jobs: [] }, runUrl, mandatoryHits: hits });
    const issue = await upsertIssue(gh, repo, {
      key, title, body, assignee: owner, state: `partial-mandatory@${target}`,
      changeNote: `Teku ${target} is required for ${notice.networks.join(' and ')} only; the gate waits for DAppNode until ${notice.fallbackAt ? fmtUtc(notice.fallbackAt) : 'the fallback'}. Merge the PR yourself if it cannot wait. The description above is up to date.`,
    });
    say(`- issue (required for ${notice.networks.join(' and ')} only; the owner decides whether to merge by hand): ${issue.html_url}`);
  } else if (decision.action === 'merge' || decision.cause === 'dappnode') {
    // Closed only when the problem is really gone: not while a fix is still
    // being checked (that would close and reopen it: two extra emails).
    const issue = await findIssue(gh, repo, key);
    if (issue?.state === 'open') {
      await closeIssue(gh, repo, issue, `Resolved: ${decision.why}.`);
      say(`- closed issue #${issue.number}`);
    }
  }

  if (decision.action === 'merge' && merging) {
    let merged;
    try {
      merged = await gh.put(`repos/${repo}/pulls/${pr.number}/merge`, {
        merge_method: 'merge',
        sha,
        commit_title: `Merge pull request #${pr.number} from ${BOT_BRANCH}: Teku ${target}`,
        commit_message: `${decision.why}.\nGate: ${runUrl}`,
      });
    } catch (err) {
      // 409: the branch moved during this run (the bump bot pushed); 405: GitHub
      // cannot merge it right now. The next run decides on the new state.
      if (err.status === 409 || err.status === 405) {
        say(`- not merged: GitHub answered HTTP ${err.status} (${String(err.message).slice(0, 160)}); the next gate run decides again`);
        return finish(out);
      }
      throw err;
    }
    say(`- merged: ${merged.sha}`);
    try { await gh.del(`repos/${repo}/git/refs/heads/${BOT_BRANCH}`); } catch { /* auto-deleted */ }
    // A merge made with GITHUB_TOKEN does not start push workflows; start the
    // release (retried; if it still fails, the next gate run starts it).
    try {
      await retry('starting release.yml', () => gh.post(`repos/${repo}/actions/workflows/release.yml/dispatches`, { ref: base }), { transient: isTransient });
      say('- started release.yml');
    } catch (err) {
      say(`- PR #${pr.number} MERGED, but release.yml could not be started (${err.message}); the next gate run starts it`);
      throw err;
    }
  }
  return finish(out);
}

function finish(lines) {
  const f = env('GITHUB_STEP_SUMMARY');
  if (f) appendFileSync(f, `${lines.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error::${err.stack || err.message}`);
    recordFailure(err.message);
    process.exitCode = 1;
  });
}
