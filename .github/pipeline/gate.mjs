#!/usr/bin/env node
// Gate (gate.yml, every 4 hours and whenever the PR checks finish): decides
// whether the bump bot's PR may be merged, and merges it.
//
// Merge (a merge commit, never squash) only when our checks ("avado/checks")
// are green on the PR head, the branch contains the current default branch, and
//   - DAppNode's real-node result for the same Teku version is good (their
//     bump PR tropibot/bump-teku-<version>: a bound PASSED report showing the
//     version, their validator attesting after the merge, or their published
//     release), read strictly by the watcher's rules (report section 2.5), or
//   - DAppNode has no usable answer (none yet, their machine or build broke)
//     and 72 hours have passed since the Teku release, or
//   - the release notes (or the watcher) mark the release as required.
// Never merge when our checks failed, DAppNode says the client failed or its
// result cannot be read, or anything else is unclear: then an issue assigned
// to the owner explains it and carries a ready-to-paste Claude Code prompt.
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN   this repo (contents, pull requests, issues,
//                                      statuses write; actions write to start release.yml)
//   PAT_TOKEN                          optional: also reads the watcher's URGENT
//                                      issues (AvadoDServer/avado-release-control)
//   PIPELINE_MODE                      on (default) | shadow (decide, never merge)
//   PIPELINE_OWNER                     who gets the issues (default flisko)
//   GATE_FALLBACK_HOURS                default 72
//   GITHUB_SERVER_URL, GITHUB_RUN_ID   for links to this run

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeClient } from './lib/gh.js';
import { readDappnode, describe } from './lib/dappnode.js';
import { checkMandatory } from './lib/mandatory.js';
import { upsertIssue, closeIssue, findIssue, listOpenIssues } from './lib/issue.js';
import {
  BOT_EMAIL, BOT_BRANCH, UPSTREAM_REPO, DAPPNODE, RULE_NETWORK, compareVersions, bare, stableReleases,
  readTekuVersion, env, hoursBetween, fmtUtc,
} from './lib/common.js';

export const CHECKS_CONTEXT = 'avado/checks';
export const GATE_CONTEXT = 'avado/gate';
const GATE_COMMENT = '<!-- avado-bot:gate -->';
const ALLOWED_BOT_FILES = /^(docker-compose\.yml|package_variants\/[a-z0-9-]+\/dappnode_package\.json)$/;

// The rules, as a pure function (tested in test/gate.test.mjs).
//   checks: 'success' | 'failure' | 'error' | 'pending' | 'missing'
//   dn: { level: 'GOOD' | 'WAIT' | 'BLOCK', verdict } or null when it could not be read
export function decide({ checks, dn, mandatory, releasedAt, now, upToDate, conflict, errors = [], unexpectedFiles = [], fallbackHours = 72, headAt = null, silentHours = 6 }) {
  if (errors.length) return { action: 'block', cause: 'unclear', why: `could not read everything needed: ${errors.join('; ')}` };
  if (unexpectedFiles.length) return { action: 'block', cause: 'unexpected-files', why: `bot commits change files a bump never touches: ${unexpectedFiles.join(', ')}` };
  if (conflict) return { action: 'block', cause: 'conflict', why: 'the PR conflicts with the default branch' };
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
  if (mandatory) return { action: 'merge', cause: 'mandatory', why: `our checks are green and Teku marks this release as required (${mandatory.source})` };
  const age = hoursBetween(releasedAt, now);
  if (age >= fallbackHours) return { action: 'merge', cause: 'fallback', why: `our checks are green, DAppNode has no usable result, and ${Math.floor(age)} h passed since the Teku release (fallback after ${fallbackHours} h)` };
  const at = new Date(new Date(releasedAt).getTime() + fallbackHours * 3600000);
  return { action: 'wait', cause: 'dappnode', why: `waiting for DAppNode's real-node test; merges without it after ${fmtUtc(at)}`, fallbackAt: at.toISOString() };
}

// --- reading --------------------------------------------------------------------

async function checksState(gh, repo, sha) {
  const statuses = await gh.paginate(`repos/${repo}/commits/${sha}/statuses`, { maxPages: 3 });
  const mine = statuses.filter((s) => s.context === CHECKS_CONTEXT && (s.creator?.type === 'Bot' || s.creator?.login === 'github-actions[bot]'));
  const latest = mine.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  return latest ? { state: latest.state, url: latest.target_url, description: latest.description } : { state: 'missing' };
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

async function failedJobs(gh, repo, runUrl) {
  const runId = /\/runs\/(\d+)/.exec(runUrl || '')?.[1];
  if (!runId) return { runId: null, jobs: [] };
  const data = await gh.get(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const jobs = [];
  // "avado/checks" only sums up the others.
  for (const j of (data?.jobs || []).filter((x) => x.conclusion === 'failure' && x.name !== CHECKS_CONTEXT)) {
    const step = (j.steps || []).find((s) => s.conclusion === 'failure')?.name || null;
    let excerpt = '';
    try {
      excerpt = logExcerpt(await gh.redirectedText(`repos/${repo}/actions/jobs/${j.id}/logs`));
    } catch (err) {
      excerpt = `(log not readable: ${err.message})`;
    }
    jobs.push({ name: j.name, url: j.html_url, step, excerpt });
  }
  return { runId, jobs };
}

async function watcherMandatory(repoName, from, to) {
  const pat = env('PAT_TOKEN');
  const watcher = env('WATCHER_REPO', 'AvadoDServer/avado-release-control');
  if (!pat) return null;
  try {
    const gh = makeClient({ token: pat });
    const issues = await gh.get(`repos/${watcher}/issues?state=open&labels=urgent&per_page=100`);
    for (const i of issues || []) {
      const key = /<!-- avado-watch:urgent key=(\S+) -->/.exec(i.body || '')?.[1] || '';
      const m = /^(teku[a-z-]*\.avado\.dnp\.dappnode\.eth)@(v?\d+\.\d+\.\d+)$/.exec(key);
      if (m && compareVersions(bare(m[2]), from) > 0 && compareVersions(bare(m[2]), to) <= 0) {
        return { tag: m[2], source: `the release watcher: ${i.html_url}` };
      }
    }
  } catch (err) {
    console.log(`::warning::could not read the watcher's URGENT issues (${err.message}); using the release notes only`);
  }
  return null;
}

// --- the issue text ------------------------------------------------------------------

function issueText({ repo, pr, target, mainTeku, decision, dn, dnText, checks, failed, runUrl }) {
  const server = env('GITHUB_SERVER_URL', 'https://github.com');
  const prUrl = `${server}/${repo}/pull/${pr.number}`;
  const headline = {
    'checks-failed': `our checks failed for Teku ${target}`,
    'dappnode-failed': `Teku ${target} failed DAppNode's real-node test`,
    'dappnode-unclear': `DAppNode's result for Teku ${target} is unclear`,
    conflict: `the Teku ${target} PR conflicts with main`,
    'unexpected-files': `the bump PR changes unexpected files`,
    unclear: `the gate could not decide on Teku ${target}`,
  }[decision.cause] || decision.why;
  const title = `[needs fix] Teku ${target}: ${headline}`;

  const facts = [
    `- Pull request: ${prUrl} (branch \`${BOT_BRANCH}\`, Teku ${mainTeku} → ${target})`,
    `- Our checks: **${checks.state}**${checks.url ? ` ([run](${checks.url}))` : ''}`,
    `- DAppNode: ${dnText}${dn?.pr?.url ? ` ([their PR](${dn.pr.url}))` : ''}${dn?.summary?.url ? ` ([report](${dn.summary.url}))` : ''}`,
    `- Gate run: ${runUrl}`,
  ];

  let what = '';
  let prompt = '';
  const rules = `Rules:
- Never change package names, volumes, host ports or environment variable names in package_variants/*/dappnode_package.json, and keep the versions the bot set there.
- Keep Teku's command line the same except for what Teku ${target} requires (for example a renamed or removed option in build/startTeku.sh or build/teku-config*.template; compare with \`docker run --rm --entrypoint /opt/teku/bin/teku consensys/teku:${target} --help\`).
- Before pushing, run the checks that failed locally (README.md, section "Checks"), for example scripts/ci/check-flags.sh on an image built with scripts/render.sh, and scripts/prove-equivalence.sh --manifests-only.
- Commit with a clear message and push to ${BOT_BRANCH}. Do not merge the PR yourself: the checks run again and the gate merges when they are green.`;

  if (decision.cause === 'checks-failed') {
    const jobs = failed.jobs.length
      ? failed.jobs.map((j) => `### ${j.name}${j.step ? ` (step "${j.step}")` : ''}\n${j.url}\n\n\`\`\`text\n${j.excerpt}\n\`\`\``).join('\n\n')
      : '(the failed jobs could not be listed; open the run link)';
    what = `The automatic update to Teku ${target} stopped because our checks failed. Nothing was merged or released; boxes are not affected.\n\n${jobs}`;
    prompt = `In the AVADO-DNP-Teku repository (${repo}), pull request #${pr.number} on branch ${BOT_BRANCH} moves every network (mainnet, gnosis) from Teku ${mainTeku} to Teku ${target}. Its checks failed:
${failed.jobs.map((j) => `- ${j.name}${j.step ? `, step "${j.step}"` : ''}: ${j.url}`).join('\n') || `- see ${checks.url}`}
Download the logs with: gh run download ${failed.runId || '<run id>'} -R ${repo}
Read the logs, find why the check fails with Teku ${target} (read the Teku ${target} release notes: https://github.com/${UPSTREAM_REPO}/releases/tag/${target}) and fix it on this branch.
${rules}`;
  } else if (decision.cause === 'dappnode-failed' || decision.cause === 'dappnode-unclear') {
    what = `DAppNode's real-node test of Teku ${target} did not pass: ${dnText}. Our pipeline does not merge a version DAppNode saw fail. Nothing was merged or released; boxes are not affected.

It clears by itself when DAppNode posts a passing result, or when a newer Teku release replaces this one (the bump bot then updates the PR). If you decide Teku ${target} is safe anyway (for example the report shows that DAppNode's own machine failed), merge ${prUrl} yourself with **"Create a merge commit"**: the release workflow then publishes it to staging as usual. To skip this version, close the PR.`;
    prompt = `DAppNode's real-node test of Teku ${target} (their PR ${dn?.pr?.url || '(not found)'}, report ${dn?.summary?.url || '(none)'}) says: ${dnText}${dn?.summary?.error ? `; error: ${dn.summary.error}` : ''}.
Read their report and the Teku ${target} release notes (https://github.com/${UPSTREAM_REPO}/releases/tag/${target}) and tell me in plain words whether the failure is caused by Teku itself or by DAppNode's test setup, and whether AVADO boxes (mainnet and gnosis, Teku with our flags in ${repo} build/startTeku.sh) could be affected. Do not change any files.`;
  } else if (decision.cause === 'conflict') {
    what = `The PR cannot be merged because it conflicts with the default branch, and it has commits by people, so the bot does not rebuild it.`;
    prompt = `In ${repo}, pull request #${pr.number} (branch ${BOT_BRANCH}) conflicts with main. Check it out (gh pr checkout ${pr.number} -R ${repo}), merge main into it, resolve the conflicts keeping TEKU_VERSION ${target} and the bot's package versions, and push.
${rules}`;
  } else {
    what = `The gate stopped: ${decision.why}. Nothing was merged or released; boxes are not affected.`;
    prompt = `In ${repo}, the release gate stopped on pull request #${pr.number} (Teku ${mainTeku} → ${target}) with: "${decision.why}". Gate run: ${runUrl}. Find out why and tell me what to do; change files only on branch ${BOT_BRANCH}.
${rules}`;
  }

  const body = `**What happened:** ${decision.why}.

${what}

**How to fix it with Claude Code** (on your Mac):
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
  const mode = env('PIPELINE_MODE', 'on');
  const owner = env('PIPELINE_OWNER', 'flisko');
  const fallbackHours = Number(env('GATE_FALLBACK_HOURS', '72'));
  const runUrl = `${env('GITHUB_SERVER_URL', 'https://github.com')}/${repo}/actions/runs/${env('GITHUB_RUN_ID', '0')}`;
  const now = new Date(env('GATE_NOW', new Date().toISOString()));
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  if (mode === 'off') return console.log('PIPELINE_MODE is off: nothing to do.');
  const gh = makeClient({ token });
  const out = [];
  const say = (s) => { console.log(s); out.push(s); };

  const meta = await gh.get(`repos/${repo}`);
  const base = meta.default_branch;
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

  // Files changed by bot-only PRs must be the bump's files.
  const commits = await gh.get(`repos/${repo}/pulls/${pr.number}/commits?per_page=100`);
  const botOnly = (commits || []).every((c) => c.commit?.author?.email === BOT_EMAIL);
  const headAt = (commits || []).at(-1)?.commit?.committer?.date || null;
  const files = botOnly ? await gh.get(`repos/${repo}/pulls/${pr.number}/files?per_page=100`) : [];
  const unexpectedFiles = (files || []).map((f) => f.filename).filter((f) => !ALLOWED_BOT_FILES.test(f));

  // Upstream: the release of the target and everything between main and it.
  const rels = await safe('Teku releases', () => gh.get(`repos/${UPSTREAM_REPO}/releases?per_page=40`));
  const stable = stableReleases(rels || []);
  const release = stable.find((r) => bare(r.tag_name) === target) || null;
  const covered = stable.filter((r) => compareVersions(bare(r.tag_name), mainTeku) > 0 && compareVersions(bare(r.tag_name), target) <= 0);
  let mandatory = null;
  for (const r of covered) {
    for (const net of Object.keys(RULE_NETWORK)) {
      const hit = checkMandatory(r, ['release-wording'], { network: RULE_NETWORK[net] });
      if (hit?.mandatory && !mandatory) mandatory = { tag: r.tag_name, source: `release notes of ${r.tag_name}: "${hit.quote}"` };
    }
  }
  mandatory = mandatory || (await watcherMandatory(repo, mainTeku, target));

  const dn = await safe('DAppNode', () => readDappnode({ gh, cfg: DAPPNODE, tag: target, now: now.getTime() }));
  const dnText = dn ? describe(dn) : 'could not be read';

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
    fallbackHours,
    headAt,
  });

  say(`PR #${pr.number} (${sha.slice(0, 7)}): Teku ${mainTeku} -> ${target}`);
  say(`- our checks: ${checks.state}${checks.url ? ` (${checks.url})` : ''}`);
  say(`- DAppNode: ${dnText}${dn?.summary?.level ? ` [${dn.summary.level}]` : ''}`);
  say(`- Teku ${target} released: ${release ? fmtUtc(release.published_at) : 'no such release'}`);
  say(`- required upgrade: ${mandatory ? mandatory.source : 'no'}`);
  say(`- branch contains ${base}: ${upToDate ? 'yes' : 'no'}${conflict ? ' (conflict)' : ''}`);
  say(`- DECISION: ${decision.action.toUpperCase()}: ${decision.why}${mode === 'shadow' && decision.action === 'merge' ? ' (shadow mode: not merging)' : ''}`);

  // Status on the PR head and one comment that is edited in place (no email).
  const statusState = { merge: 'success', wait: 'pending', block: 'failure' }[decision.action];
  const statusText = mode === 'shadow' && decision.action === 'merge' ? `shadow mode, would merge: ${decision.why}` : decision.why;
  await gh.post(`repos/${repo}/statuses/${sha}`, { state: statusState, context: GATE_CONTEXT, description: statusText.slice(0, 139), target_url: runUrl });
  const table = `${GATE_COMMENT}
### Gate: ${decision.action === 'merge' ? (mode === 'shadow' ? 'would merge (shadow mode)' : 'merging') : decision.action === 'wait' ? 'waiting' : 'stopped'}
${decision.why}.

| | |
|---|---|
| Our checks | ${checks.state}${checks.url ? ` ([run](${checks.url}))` : ''} |
| DAppNode (Teku ${target}) | ${dnText}${dn?.pr?.url ? ` ([PR](${dn.pr.url}))` : ''} |
| Teku ${target} released | ${release ? fmtUtc(release.published_at) : '—'} |
| Fallback (no DAppNode answer) | ${release ? fmtUtc(new Date(release.published_at).getTime() + fallbackHours * 3600000) : '—'} |
| Required upgrade | ${mandatory ? mandatory.source : 'no'} |
| Up to date with ${base} | ${upToDate ? 'yes' : 'no'} |

Checked ${fmtUtc(now)} by ${runUrl}`;
  const comments = await gh.get(`repos/${repo}/issues/${pr.number}/comments?per_page=100`);
  const mine = (comments || []).find((c) => (c.body || '').startsWith(GATE_COMMENT));
  if (mine) await gh.patch(`repos/${repo}/issues/comments/${mine.id}`, { body: table });
  else await gh.post(`repos/${repo}/issues/${pr.number}/comments`, { body: table });

  const key = `pr-${pr.number}`;
  if (decision.action === 'block') {
    const failed = decision.cause === 'checks-failed' ? await failedJobs(gh, repo, checks.url) : { runId: null, jobs: [] };
    const { title, body } = issueText({ repo, pr, target, mainTeku, decision, dn, dnText, checks, failed, runUrl });
    const issue = await upsertIssue(gh, repo, {
      key, title, body, assignee: owner, state: `${decision.cause}@${target}@${sha.slice(0, 7)}`,
      changeNote: `New situation for Teku ${target} (head ${sha.slice(0, 7)}): ${decision.why}. The description above is up to date.`,
    });
    say(`- issue: ${issue.html_url}`);
  } else {
    const issue = await findIssue(gh, repo, key);
    if (issue?.state === 'open') {
      await closeIssue(gh, repo, issue, `Resolved: ${decision.why}.`);
      say(`- closed issue #${issue.number}`);
    }
  }

  if (decision.action === 'merge' && mode === 'on') {
    const merged = await gh.put(`repos/${repo}/pulls/${pr.number}/merge`, {
      merge_method: 'merge',
      sha,
      commit_title: `Merge pull request #${pr.number} from ${BOT_BRANCH}: Teku ${target}`,
      commit_message: `${decision.why}.\nGate: ${runUrl}`,
    });
    say(`- merged: ${merged.sha}`);
    try { await gh.del(`repos/${repo}/git/refs/heads/${BOT_BRANCH}`); } catch { /* auto-deleted */ }
    // A merge made with GITHUB_TOKEN does not start push workflows; start the release.
    await gh.post(`repos/${repo}/actions/workflows/release.yml/dispatches`, { ref: base });
    say('- started release.yml');
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
    process.exitCode = 1;
  });
}
