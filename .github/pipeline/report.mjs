#!/usr/bin/env node
// Tells the owner when a pipeline workflow itself breaks, and says so when it
// works again. Used as the last step of bump.yml, gate.yml and release.yml:
//
//   node .github/pipeline/report.mjs failure "<workflow name>"
//   node .github/pipeline/report.mjs success "<workflow name>"
//
// failure: opens (or updates) one issue per workflow, assigned to the owner,
// with the run link and a ready-to-paste Claude Code prompt.
// success: closes that issue if it is open.

import { makeClient } from './lib/gh.js';
import { upsertIssue, findIssue, closeIssue } from './lib/issue.js';
import { env } from './lib/common.js';

const [outcome, workflow] = process.argv.slice(2);
const repo = env('GITHUB_REPOSITORY');
const runId = env('GITHUB_RUN_ID', '0');
const runUrl = `${env('GITHUB_SERVER_URL', 'https://github.com')}/${repo}/actions/runs/${runId}`;
const gh = makeClient({ token: env('GITHUB_TOKEN') });
const key = `workflow-${String(workflow).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const effect = {
  Release: 'A new version may not have reached the staging store. Boxes are not affected: production only changes when you publish it in editstore.',
  Gate: 'The bump PR is neither merged nor reported until this works again. Nothing reaches any box.',
  'Bump Teku': 'New Teku releases are not picked up until this works again. Nothing reaches any box.',
}[workflow] || 'Nothing reaches any box while this is broken.';

async function main() {
  if (outcome === 'success') {
    const issue = await findIssue(gh, repo, key);
    if (issue?.state === 'open') await closeIssue(gh, repo, issue, `Works again: ${runUrl}`);
    return;
  }
  const body = `**What happened:** the "${workflow}" workflow failed: ${runUrl}

**What it means:** ${effect}

**How to fix it with Claude Code** (on your Mac, in your AVADO-DNP-Teku checkout on the default branch):
\`\`\`bash
gh run view ${runId} -R ${repo} --log-failed | tail -80
claude    # then paste the prompt below
\`\`\`

<details open><summary>Prompt for Claude Code</summary>

\`\`\`text
In the AVADO-DNP-Teku repository (${repo}), the GitHub Actions workflow "${workflow}" failed in run ${runUrl}.
Read the failed log with: gh run view ${runId} -R ${repo} --log-failed
Explain the cause in plain words. If it is a bug in .github/workflows or .github/pipeline, fix it on a new branch and open a pull request (do not push to main).
If it is an outside problem (GitHub, Docker Hub, AVADO's IPFS node or store, DAppNode's repository), say so and say whether re-running the workflow is enough.
Never change package names, volumes, host ports or environment variable names in package_variants/*/dappnode_package.json.
\`\`\`
</details>

This issue closes by itself after the next successful run of "${workflow}".`;
  await upsertIssue(gh, repo, {
    key,
    title: `[pipeline broken] ${workflow} workflow failed`,
    body,
    assignee: env('PIPELINE_OWNER', 'flisko'),
    state: 'failed', // one email when it breaks; later failures only update the text
    changeNote: `Failed again: ${runUrl}`,
  });
}

main().catch((err) => {
  // Reporting must never hide the original failure.
  console.log(`::warning::could not report the ${outcome} of "${workflow}": ${err.message}`);
});
