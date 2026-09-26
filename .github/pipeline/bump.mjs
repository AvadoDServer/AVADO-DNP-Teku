#!/usr/bin/env node
// Bump bot (bump.yml, every 4 hours): when a newer stable Teku release exists,
// open or update ONE pull request on branch avado-bot/bump that moves every
// network to it: TEKU_VERSION in the base docker-compose.yml, and the version
// of every package_variants/<network>/dappnode_package.json one patch up.
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN   this repo; reads, and the fallback for writes
//   PAT_TOKEN                          optional: pushes and PRs made with it start
//                                      the PR checks (GITHUB_TOKEN ones do not);
//                                      without it the checks are started by hand
//                                      (workflow_dispatch of pr-checks.yml)
//   INPUT_VERSION                      TEST ONLY: pretend this is the newest Teku
//   DRY_RUN=true                       print what would happen, write nothing
//
// Run in a checkout of the default branch with full history (fetch-depth: 0).

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient } from './lib/gh.js';
import { checkMandatory } from './lib/mandatory.js';
import {
  BOT_NAME, BOT_EMAIL, BOT_BRANCH, BUMP_MARKER, UPSTREAM_REPO, UPSTREAM_IMAGE, RULE_NETWORK,
  compareVersions, bare, maxVersion, bumpPatch, stableReleases, readTekuVersion, setTekuVersion,
  setManifestVersion, variants, git, fetchBranch, pushHead, releasedVersions, readProductionVersions, env, fmtUtc, notice, warning,
} from './lib/common.js';

const root = process.cwd();
const repo = env('GITHUB_REPOSITORY');
const token = env('GITHUB_TOKEN');
const pat = env('PAT_TOKEN');
const pretend = env('INPUT_VERSION');
const dryRun = env('DRY_RUN') === 'true';
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

function renderBody({ target, from, release, rows, skipped, mandatory, pretendNote, checksNote }) {
  const table = rows.map((r) => `| ${r.network} | \`${r.name}\` | ${r.from} | **${r.to}** |`).join('\n');
  const skippedText = skipped.length ? `\nThis also covers ${skipped.map((s) => `[${s}](https://github.com/${UPSTREAM_REPO}/releases/tag/${s})`).join(', ')}.` : '';
  const mandatoryText = mandatory
    ? `\n> **Marked as a required upgrade** by the release notes of Teku ${mandatory.tag} (${mandatory.network}): "${mandatory.quote}". The gate does not wait the 72 hours for this one.\n`
    : '';
  return `${BUMP_MARKER}
## Teku ${target} for every network
${pretendNote || ''}
Teku ${from} → **${target}**${release ? ` ([release notes](${release.html_url}), published ${fmtUtc(release.published_at)})` : ''}.${skippedText}
${mandatoryText}
| Network | Package | Now | New |
|---|---|---|---|
${table}

### What happens next (nothing to do unless you get an email)
1. **Checks** (\`avado/checks\`): every network is built with the AVADOSDK, the exact Teku version and every option we pass are checked, names/volumes/ports/settings are compared with main and production, the package boots on its real network for a few minutes, and the equivalence proof compares it with what boxes run today.${checksNote || ''}
2. **Gate** (\`avado/gate\`, every 4 hours and after the checks): merges this PR when the checks are green **and** DAppNode's real-node test of Teku ${target} passed, or when 72 hours have passed since the Teku release and our checks are green. If DAppNode's test failed, our checks failed, or anything is unclear, it does **not** merge and opens an issue assigned to the owner with a ready-to-paste Claude Code prompt.
3. **Release**: after the merge, every network whose version went up is published to the **staging** store. Production stays a manual click in editstore.

Pushing a fix to \`${BOT_BRANCH}\` is fine: the bot keeps your commits. To pause the bot, set the repository variable \`PIPELINE_MODE\` to \`off\` (see README).
`;
}

async function main() {
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = makeClient({ token });
  const ghw = makeClient({ token: pat || token });
  const meta = await gh.get(`repos/${repo}`);
  const base = meta.default_branch;
  const owner = repo.split('/')[0];

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

  const openPrs = await gh.get(`repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(BOT_BRANCH)}`);
  const pr = (openPrs || [])[0] || null;
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
        await ghw.post(`repos/${repo}/issues/${pr.number}/comments`, { body: `Closed by the bump bot: \`${base}\` already has Teku ${mainTeku}.` });
        await ghw.patch(`repos/${repo}/pulls/${pr.number}`, { state: 'closed' });
        try { await ghw.del(`repos/${repo}/git/refs/heads/${BOT_BRANCH}`); } catch { /* already gone */ }
      }
    }
    return;
  }

  if (!pretend) {
    // The upstream image must exist before anything is built from it.
    const tagUrl = `https://hub.docker.com/v2/repositories/${UPSTREAM_IMAGE}/tags/${encodeURIComponent(target)}`;
    const tag = await gh.http.json(tagUrl, { allow404: true });
    if (!tag) {
      say(`Waiting: Teku ${target} is released on GitHub but the image ${UPSTREAM_IMAGE}:${target} is not on Docker Hub yet. The next run tries again.`);
      return;
    }
  }

  // --- new versions ---------------------------------------------------------------
  let prod = null;
  try {
    prod = await readProductionVersions({ http: gh.http });
  } catch (err) {
    warning(`production store unreadable (${err.message}); versions are based on git history only`);
  }
  const nets = variants(root);
  const rows = nets.map((net) => {
    const v = JSON.parse(git(root, ['show', `origin/${base}:package_variants/${net}/dappnode_package.json`]));
    const released = releasedVersions(root, v.name, `origin/${base}`);
    const prodVersion = prod?.versions.get(v.name) || null;
    const highest = maxVersion([v.version, ...released, prodVersion].filter(Boolean));
    return { network: net, name: v.name, from: v.version, to: bumpPatch(highest), highest, prodVersion };
  });

  // Upstream releases this PR covers, and whether any is marked mandatory.
  const covered = upstreamList.filter((r) => compareVersions(bare(r.tag_name), mainTeku) > 0 && compareVersions(bare(r.tag_name), target) <= 0);
  const skipped = covered.filter((r) => bare(r.tag_name) !== target).map((r) => r.tag_name).reverse();
  let mandatory = null;
  for (const r of covered) {
    for (const net of nets) {
      const hit = checkMandatory(r, ['release-wording'], { network: RULE_NETWORK[net] || 'ethereum-mainnet' });
      if (hit?.mandatory && !mandatory) mandatory = { tag: r.tag_name, network: net, quote: hit.quote };
    }
  }

  // --- the commit -------------------------------------------------------------------
  let humanCommits = [];
  let upToDate = false;
  if (pr) {
    const commits = await gh.get(`repos/${repo}/pulls/${pr.number}/commits?per_page=100`);
    humanCommits = (commits || []).filter((c) => !isBotCommit(c));
    upToDate = (() => { try { git(root, ['merge-base', '--is-ancestor', `origin/${base}`, `origin/${BOT_BRANCH}`]); return true; } catch { return false; } })();
    const prVersions = Object.fromEntries(nets.map((net) => [net, JSON.parse(git(root, ['show', `origin/${BOT_BRANCH}:package_variants/${net}/dappnode_package.json`])).version]));
    const versionsOk = rows.every((r) => compareVersions(prVersions[r.network], r.to) >= 0);
    if (prTeku === target && upToDate && versionsOk) {
      say(`PR #${pr.number} already offers Teku ${target} on top of the current ${base}; nothing to push.`);
      return;
    }
  }

  const edit = () => {
    const compose = join(root, 'docker-compose.yml');
    writeFileSync(compose, setTekuVersion(readFileSync(compose, 'utf8'), target));
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
    ...(pretend ? ['', 'TEST ONLY: pretend version (bump.yml input), not a real Teku release.'] : []),
  ].join('\n');

  let force = false;
  if (!pr || humanCommits.length === 0) {
    git(root, ['checkout', '-q', '-B', BOT_BRANCH, `origin/${base}`]);
    edit();
    force = true;
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
  say(`Branch ${BOT_BRANCH}: ${git(root, ['log', '--oneline', '-1'])}${force ? ' (recreated on the current ' + base + ')' : ''}`);
  for (const r of rows) say(`- ${r.network}: ${r.name} ${r.from} -> ${r.to}${r.prodVersion ? ` (production ${r.prodVersion})` : ''}`);
  if (mandatory) say(`Required upgrade per the release notes of ${mandatory.tag}: "${mandatory.quote}"`);

  const title = `Teku ${target} for every network (${rows.map((r) => `${r.network} ${r.to}`).join(', ')})${pretend ? ' [TEST]' : ''}`;
  const body = renderBody({
    target,
    from: mainTeku,
    release,
    rows,
    skipped,
    mandatory,
    pretendNote: pretend ? `\n> **TEST ONLY.** Teku ${target} was given by hand (bump.yml input "version"); it is not a real release. Close this PR when the test is done.\n` : '',
    checksNote: pat ? '' : ' (Started by the bump bot through workflow_dispatch, because no PAT_TOKEN is set.)',
  });

  if (dryRun) {
    say(`DRY RUN: would push ${BOT_BRANCH}${force ? ' (force)' : ''} and ${pr ? `update PR #${pr.number}` : 'open a PR'}: ${title}`);
    return;
  }

  pushHead(root, pat || token, BOT_BRANCH, { force });

  let number;
  if (pr) {
    await ghw.patch(`repos/${repo}/pulls/${pr.number}`, { title, body });
    number = pr.number;
    say(`Updated PR #${number}.`);
  } else {
    const created = await ghw.post(`repos/${repo}/pulls`, { title, head: BOT_BRANCH, base, body, maintainer_can_modify: true });
    number = created.number;
    say(`Opened PR #${number}: ${created.html_url}`);
  }
  try { await ghw.post(`repos/${repo}/issues/${number}/labels`, { labels: ['avado-bot'] }); } catch { /* labels are optional */ }

  if (!pat) {
    // GITHUB_TOKEN pushes do not start workflows, but a workflow_dispatch does.
    await gh.post(`repos/${repo}/actions/workflows/pr-checks.yml/dispatches`, { ref: base, inputs: { pr: String(number) } });
    say(`No PAT_TOKEN: started the PR checks for #${number} through workflow_dispatch.`);
  }
}

main()
  .catch((err) => {
    console.log(`::error::${err.message}`);
    summary.push(`**Bump failed:** ${err.message}`);
    process.exitCode = 1;
  })
  .finally(writeSummary);
