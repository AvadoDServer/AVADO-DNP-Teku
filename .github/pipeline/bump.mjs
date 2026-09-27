#!/usr/bin/env node
// Bump bot (bump.yml, every 4 hours): when a newer stable Teku release exists,
// open or update ONE pull request on branch avado-bot/bump that moves every
// network to it: TEKU_VERSION and TEKU_DIGEST in the base docker-compose.yml,
// and the version of every package_variants/<network>/dappnode_package.json one
// patch up. A held network (package_variants/<network>/hold) is left alone.
// A version whose PR the owner closed without merging is skipped: the bot
// waits for a newer Teku release (reopening the PR undoes the skip).
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN   this repo; reads, and the fallback for writes
//   PAT_TOKEN                          optional: pushes and PRs made with it start
//                                      the PR checks (GITHUB_TOKEN ones do not);
//                                      without it, or when GitHub rejects it
//                                      (expired), the checks are started by hand
//                                      (workflow_dispatch of pr-checks.yml) and
//                                      the owner gets an issue to renew it
//   PIPELINE_OWNER                     who gets that issue (default flisko)
//   INPUT_VERSION                      TEST ONLY: pretend this is the newest Teku
//   DRY_RUN=true                       print what would happen, write nothing
//
// Run in a checkout of the default branch with full history (fetch-depth: 0).

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient } from './lib/gh.js';
import { checkMandatory } from './lib/mandatory.js';
import { upsertIssue, findIssue, closeIssue } from './lib/issue.js';
import {
  BOT_NAME, BOT_EMAIL, BOT_BRANCH, UPSTREAM_REPO, UPSTREAM_IMAGE, RULE_NETWORK, bumpMarker, markerTarget,
  compareVersions, bare, maxVersion, bumpPatch, stableReleases, readTekuVersion, setTekuVersion, setTekuDigest,
  setManifestVersion, variants, holdReason, git, fetchBranch, pushHead, remoteSha, releasedVersions, readProductionVersions,
  env, fmtUtc, hoursBetween, notice, warning, recordFailure,
} from './lib/common.js';

const root = process.cwd();
const repo = env('GITHUB_REPOSITORY');
const token = env('GITHUB_TOKEN');
const pat = env('PAT_TOKEN');
const pretend = env('INPUT_VERSION');
const dryRun = env('DRY_RUN') === 'true';
const owner = env('PIPELINE_OWNER', 'flisko');
// How long a released Teku may lack its Docker Hub image before the bot says so.
const IMAGE_WAIT_HOURS = 24;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const summary = [];
const say = (line) => { console.log(line); summary.push(line); };

function writeSummary() {
  const f = env('GITHUB_STEP_SUMMARY');
  if (f) appendFileSync(f, `${summary.join('\n')}\n`);
}

function isBotCommit(c) {
  const email = c.commit?.author?.email || '';
  const msg = c.commit?.message || '';
  return email === BOT_EMAIL && (/^Bump Teku to /.test(msg) || /^Merge .* into avado-bot\/bump/.test(msg));
}

// Is PAT_TOKEN still accepted? An expired or revoked token answers 401.
async function patWorks() {
  if (!pat) return false;
  try {
    await makeClient({ token: pat }).get(`repos/${repo}`);
    return true;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      warning(`PAT_TOKEN was rejected (HTTP ${err.status}: expired or revoked); using the built-in token and starting the checks by hand`);
      return false;
    }
    warning(`could not check PAT_TOKEN (${err.message}); trying it anyway`);
    return true;
  }
}

async function reportPat(gh, ok) {
  if (!pat || dryRun) return;
  const key = 'pat-token-rejected';
  try {
    if (ok) {
      const issue = await findIssue(gh, repo, key);
      if (issue?.state === 'open') await closeIssue(gh, repo, issue, 'PAT_TOKEN works again.');
      return;
    }
    await upsertIssue(gh, repo, {
      key,
      title: '[pipeline] PAT_TOKEN was rejected: renew it',
      assignee: owner,
      state: 'rejected',
      body: `GitHub rejected the repository secret \`PAT_TOKEN\` (a personal access token; they expire). The bump bot still works: it pushes with the built-in token and starts the PR checks itself, so the PR shows an extra "PR checks" run marked "action required" that can be ignored.

**To fix it:** create a fine-grained token at github.com/settings/personal-access-tokens: resource owner AvadoDServer, only this repository (${repo}), permissions Contents: read and write and Pull requests: read and write, with an expiry date. Then Settings -> Secrets and variables -> Actions -> \`PAT_TOKEN\` -> Update. This issue closes by itself on the next bump run after that.`,
    });
  } catch (err) {
    warning(`could not report the PAT_TOKEN state (${err.message})`);
  }
}

function renderBody({ target, from, release, rows, skipped, mandatory, pretendNote, checksNote, held, marker }) {
  const table = rows.map((r) => `| ${r.network} | \`${r.name}\` | ${r.from} | **${r.to}** |`).join('\n');
  const heldRows = held.map((h) => `| ${h.network} | \`${h.name}\` | ${h.version} | held: ${h.reason} |`).join('\n');
  const skippedText = skipped.length ? `\nThis also covers ${skipped.map((s) => `[${s}](https://github.com/${UPSTREAM_REPO}/releases/tag/${s})`).join(', ')}.` : '';
  const mandatoryText = mandatory
    ? `\n> **Marked as a required upgrade** by the release notes of Teku ${mandatory.tag} (${mandatory.network}): "${mandatory.quote}". The gate does not wait the 72 hours for this one.\n`
    : '';
  return `${marker}
## Teku ${target} for every network
${pretendNote || ''}
Teku ${from} → **${target}**${release ? ` ([release notes](${release.html_url}), published ${fmtUtc(release.published_at)})` : ''}.${skippedText}
${mandatoryText}
| Network | Package | Now | New |
|---|---|---|---|
${table}${heldRows ? `\n${heldRows}` : ''}

### What happens next (nothing to do unless you get an email)
1. **Checks** (\`avado/checks\`): every network is built with the AVADOSDK, the exact Teku version and every option we pass are checked, names/volumes/ports/settings are compared with main and production, the package boots on its real network for a few minutes, and the equivalence proof compares it with what boxes run today.${checksNote || ''}
2. **Gate** (\`avado/gate\`, every 4 hours and after the checks): merges this PR when the checks are green **and** DAppNode's real-node test of Teku ${target} passed, or when 72 hours have passed since the Teku release and our checks are green. If DAppNode's test failed, our checks failed, or anything is unclear, it does **not** merge and opens an issue assigned to the owner with a ready-to-paste Claude Code prompt.
3. **Release**: after the merge, every network whose version went up is published to the **staging** store. Production stays a manual click in editstore.

${held.length ? `Held networks are not changed, built or released; boxes keep what they have (see their \`package_variants/<network>/hold\` file).\n\n` : ''}Pushing a fix to \`${BOT_BRANCH}\` is fine: the bot keeps your commits (a fix that touches \`.github/\`, \`scripts/\` or a variant's other files is left for the owner to merge). **Closing this PR without merging skips Teku ${target}**: the bot waits for a newer Teku release (reopen the PR to undo). To pause the bot, set the repository variable \`PIPELINE_MODE\` to \`off\` (see README).
`;
}

async function main() {
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = makeClient({ token });
  const meta = await gh.get(`repos/${repo}`);
  const base = meta.default_branch;
  const repoOwner = repo.split('/')[0];

  // Checked on every run, so an expired PAT_TOKEN is noticed before a release waits.
  let patOk = await patWorks();
  await reportPat(gh, patOk || !pat);
  const writeToken = () => (patOk ? pat : token);

  fetchBranch(root, token, base);
  const mainTeku = readTekuVersion(git(root, ['show', `origin/${base}:docker-compose.yml`]));

  // --- the newest stable Teku -------------------------------------------------
  let target;
  let release = null;
  let upstreamList = [];
  if (pretend) {
    target = bare(pretend);
    compareVersions(target, '0.0.0');
    notice(`TEST: pretending Teku ${target} is the newest release (input "version")`);
  } else {
    const rels = await gh.get(`repos/${UPSTREAM_REPO}/releases?per_page=40`);
    upstreamList = stableReleases(rels);
    if (!upstreamList.length) throw new Error(`no stable ${UPSTREAM_REPO} release in the API answer; refusing to guess`);
    release = upstreamList[0];
    target = bare(release.tag_name);
  }
  say(`Teku on ${base}: ${mainTeku}. Newest stable Teku: ${target}${pretend ? ' (pretend)' : ''}.`);

  const openPrs = await gh.get(`repos/${repo}/pulls?state=open&head=${repoOwner}:${encodeURIComponent(BOT_BRANCH)}`);
  let pr = (openPrs || [])[0] || null;
  let prTeku = null;
  if (pr) {
    fetchBranch(root, token, BOT_BRANCH);
    prTeku = readTekuVersion(git(root, ['show', `origin/${BOT_BRANCH}:docker-compose.yml`]));
  }

  if (compareVersions(target, mainTeku) <= 0) {
    say(`Nothing to do: ${base} already has Teku ${mainTeku}.`);
    if (pr && compareVersions(prTeku, mainTeku) <= 0) {
      say(`Closing PR #${pr.number}: it offers Teku ${prTeku}, ${base} already has ${mainTeku}.`);
      if (!dryRun) {
        const ghw = makeClient({ token: writeToken() });
        await ghw.post(`repos/${repo}/issues/${pr.number}/comments`, { body: `Closed by the bump bot: \`${base}\` already has Teku ${mainTeku}.` });
        await ghw.patch(`repos/${repo}/pulls/${pr.number}`, { state: 'closed' });
        try { await ghw.del(`repos/${repo}/git/refs/heads/${BOT_BRANCH}`); } catch { /* already gone */ }
      }
    }
    return;
  }

  // A version whose PR the owner closed without merging is skipped.
  if (!pr && !pretend) {
    const closed = await gh.get(`repos/${repo}/pulls?state=closed&head=${repoOwner}:${encodeURIComponent(BOT_BRANCH)}&per_page=50`);
    const skippedBy = (closed || []).find((p) => !p.merged_at && markerTarget(p.body) === target);
    if (skippedBy) {
      say(`Teku ${target} was skipped by the owner (PR #${skippedBy.number} was closed without merging); waiting for a newer Teku release. Reopen PR #${skippedBy.number} to undo.`);
      return;
    }
  }

  // The upstream image must exist before anything is built from it; its digest is pinned.
  let digest = null;
  const tagUrl = `https://hub.docker.com/v2/repositories/${UPSTREAM_IMAGE}/tags/${encodeURIComponent(target)}`;
  const tag = await gh.http.json(tagUrl, { allow404: true });
  if (tag?.digest) {
    digest = tag.digest;
  } else if (pretend) {
    digest = ZERO_DIGEST;
    notice(`TEST: ${UPSTREAM_IMAGE}:${target} is not on Docker Hub; the PR pins a digest that does not exist, so the checks fail (that exercises the issue path)`);
  } else {
    const ageH = release?.published_at ? hoursBetween(release.published_at, new Date()) : 0;
    if (ageH > IMAGE_WAIT_HOURS) {
      throw new Error(`Teku ${target} was released on GitHub ${fmtUtc(release.published_at)} (${Math.floor(ageH)} h ago), but ${UPSTREAM_IMAGE}:${target} is still not on Docker Hub (${tagUrl} answers ${tag ? 'without a digest' : '404'}). Check whether Consensys moved the image, renamed the tag or skipped the push; the bump bot waits until the image exists.`);
    }
    say(`Waiting: Teku ${target} is released on GitHub but the image ${UPSTREAM_IMAGE}:${target} is not on Docker Hub yet. The next run tries again (the owner is told after ${IMAGE_WAIT_HOURS} h).`);
    return;
  }

  // --- new versions ---------------------------------------------------------------
  let prod = null;
  try {
    prod = await readProductionVersions({ http: gh.http });
  } catch (err) {
    warning(`production store unreadable (${err.message}); versions are based on git history only`);
  }
  const nets = variants(root);
  const held = [];
  const rows = [];
  for (const net of nets) {
    const v = JSON.parse(git(root, ['show', `origin/${base}:package_variants/${net}/dappnode_package.json`]));
    const reason = holdReason(root, net, `origin/${base}`);
    if (reason) {
      held.push({ network: net, name: v.name, version: v.version, reason });
      continue;
    }
    const released = releasedVersions(root, v.name, `origin/${base}`);
    const prodVersion = prod?.versions.get(v.name) || null;
    const highest = maxVersion([v.version, ...released, prodVersion].filter(Boolean));
    rows.push({ network: net, name: v.name, from: v.version, to: bumpPatch(highest), highest, prodVersion });
  }
  for (const h of held) say(`- ${h.network}: ${h.name} stays at ${h.version}: HELD (${h.reason})`);
  if (!rows.length) {
    say('Every network is held: nothing to bump.');
    return;
  }

  // Upstream releases this PR covers, and whether any is marked mandatory.
  const covered = upstreamList.filter((r) => compareVersions(bare(r.tag_name), mainTeku) > 0 && compareVersions(bare(r.tag_name), target) <= 0);
  const skipped = covered.filter((r) => bare(r.tag_name) !== target).map((r) => r.tag_name).reverse();
  let mandatory = null;
  for (const r of covered) {
    for (const row of rows) {
      const hit = checkMandatory(r, ['release-wording'], { network: RULE_NETWORK[row.network] || 'ethereum-mainnet' });
      if (hit?.mandatory && !mandatory) mandatory = { tag: r.tag_name, network: row.network, quote: hit.quote };
    }
  }

  // --- the commit -------------------------------------------------------------------
  let humanCommits = [];
  let upToDate = false;
  if (pr) {
    const commits = await gh.get(`repos/${repo}/pulls/${pr.number}/commits?per_page=100`);
    humanCommits = (commits || []).filter((c) => !isBotCommit(c));
    upToDate = (() => { try { git(root, ['merge-base', '--is-ancestor', `origin/${base}`, `origin/${BOT_BRANCH}`]); return true; } catch { return false; } })();
    const prVersions = Object.fromEntries(rows.map((r) => [r.network, JSON.parse(git(root, ['show', `origin/${BOT_BRANCH}:package_variants/${r.network}/dappnode_package.json`])).version]));
    const versionsOk = rows.every((r) => compareVersions(prVersions[r.network], r.to) >= 0);
    if (prTeku === target && upToDate && versionsOk) {
      say(`PR #${pr.number} already offers Teku ${target} on top of the current ${base}; nothing to push.`);
      return;
    }
  }

  const edit = () => {
    const compose = join(root, 'docker-compose.yml');
    writeFileSync(compose, setTekuDigest(setTekuVersion(readFileSync(compose, 'utf8'), target), digest));
    for (const r of rows) {
      const path = join(root, 'package_variants', r.network, 'dappnode_package.json');
      const cur = JSON.parse(readFileSync(path, 'utf8')).version;
      if (compareVersions(cur, r.to) < 0) writeFileSync(path, setManifestVersion(readFileSync(path, 'utf8'), r.to));
      else r.to = cur; // an owner commit on the branch already set a higher version
    }
  };
  const author = ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`];
  const message = [
    `Bump Teku to ${target}`,
    '',
    ...rows.map((r) => `${r.name} ${r.from} -> ${r.to}`),
    ...held.map((h) => `${h.name} stays at ${h.version} (held)`),
    `${UPSTREAM_IMAGE}:${target}@${digest}`,
    ...(pretend ? ['', 'TEST ONLY: pretend version (bump.yml input), not a real Teku release.'] : []),
  ].join('\n');

  // What the branch looks like on GitHub now: the push only overwrites exactly that.
  const lease = remoteSha(root, token, BOT_BRANCH);
  if (!pr || humanCommits.length === 0) {
    git(root, ['checkout', '-q', '-B', BOT_BRANCH, `origin/${base}`]);
    edit();
  } else {
    git(root, ['checkout', '-q', '-B', BOT_BRANCH, `origin/${BOT_BRANCH}`]);
    if (!upToDate) {
      try {
        git(root, [...author, 'merge', '--no-edit', '-m', `Merge ${base} into ${BOT_BRANCH}`, `origin/${base}`]);
      } catch (err) {
        git(root, ['merge', '--abort']);
        throw new Error(`PR #${pr.number} has commits by people and conflicts with ${base}; resolve the conflict on ${BOT_BRANCH} by hand (${err.message.split('\n')[0]})`);
      }
    }
    edit();
  }
  git(root, ['add', 'docker-compose.yml', ...rows.map((r) => `package_variants/${r.network}/dappnode_package.json`)]);
  const staged = git(root, ['diff', '--cached', '--name-only']);
  if (staged) git(root, [...author, 'commit', '-q', '-m', message]);
  say(`Branch ${BOT_BRANCH}: ${git(root, ['log', '--oneline', '-1'])}${!pr || humanCommits.length === 0 ? ` (recreated on the current ${base})` : ''}`);
  for (const r of rows) say(`- ${r.network}: ${r.name} ${r.from} -> ${r.to}${r.prodVersion ? ` (production ${r.prodVersion})` : ''}`);
  say(`- base image ${UPSTREAM_IMAGE}:${target}@${digest}`);
  if (mandatory) say(`Required upgrade per the release notes of ${mandatory.tag} (${mandatory.network}): "${mandatory.quote}"`);

  const title = `Teku ${target} for every network (${rows.map((r) => `${r.network} ${r.to}`).join(', ')})${pretend ? ' [TEST]' : ''}`;
  const body = () => renderBody({
    target,
    from: mainTeku,
    release,
    rows,
    skipped,
    mandatory,
    held,
    marker: bumpMarker(pretend ? null : target),
    pretendNote: pretend ? `\n> **TEST ONLY.** Teku ${target} was given by hand (bump.yml input "version"); it is not a real release. Close this PR when the test is done.\n` : '',
    checksNote: patOk ? '' : ' (Started by the bump bot through workflow_dispatch, because PAT_TOKEN is not set or was rejected.)',
  });

  if (dryRun) {
    say(`DRY RUN: would push ${BOT_BRANCH} and ${pr ? `update PR #${pr.number}` : 'open a PR'}: ${title}`);
    return;
  }

  // The gate may have merged or closed the PR while this run worked: start over next time.
  if (pr) {
    const now = await gh.get(`repos/${repo}/pulls/${pr.number}`);
    if (now.state !== 'open') {
      say(`PR #${pr.number} was ${now.merged_at ? 'merged' : 'closed'} while this run worked; nothing pushed. The next run starts over.`);
      return;
    }
  }

  try {
    pushHead(root, writeToken(), BOT_BRANCH, { lease });
  } catch (err) {
    if (!patOk) throw new Error(`could not push ${BOT_BRANCH} (${String(err.message).split('\n')[0]}); if the branch changed during this run, the next run tries again`);
    warning(`push with PAT_TOKEN failed (${String(err.message).split('\n')[0]}); trying the built-in token`);
    patOk = false;
    await reportPat(gh, false);
    pushHead(root, token, BOT_BRANCH, { lease });
  }

  const ghw = makeClient({ token: writeToken() });
  let number;
  if (pr) {
    await ghw.patch(`repos/${repo}/pulls/${pr.number}`, { title, body: body() });
    number = pr.number;
    say(`Updated PR #${number}.`);
  } else {
    const created = await ghw.post(`repos/${repo}/pulls`, { title, head: BOT_BRANCH, base, body: body(), maintainer_can_modify: true });
    number = created.number;
    say(`Opened PR #${number}: ${created.html_url}`);
  }
  try { await ghw.post(`repos/${repo}/issues/${number}/labels`, { labels: ['avado-bot'] }); } catch { /* labels are optional */ }

  if (!patOk) {
    // GITHUB_TOKEN pushes do not start workflows, but a workflow_dispatch does.
    await gh.post(`repos/${repo}/actions/workflows/pr-checks.yml/dispatches`, { ref: base, inputs: { pr: String(number) } });
    say(`Started the PR checks for #${number} through workflow_dispatch (PAT_TOKEN ${pat ? 'was rejected' : 'is not set'}).`);
  }
}

main()
  .catch((err) => {
    console.log(`::error::${err.message}`);
    summary.push(`**Bump failed:** ${err.message}`);
    recordFailure(err.message);
    process.exitCode = 1;
  })
  .finally(writeSummary);
