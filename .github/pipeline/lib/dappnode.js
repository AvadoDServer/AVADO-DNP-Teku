// Vendored unchanged from AvadoDServer/avado-release-control bot/lib/dappnode.js at 1313db3
// (the release watcher). Keep the two copies the same; fix bugs there first.

// DAppNode's public test result for the same client and upstream version.
// INFORMATION ONLY in stage 1: it never decides anything.
//
// Reading rules (report section 2.5), strict and structure-based:
//  1. Find DAppNode's bump PR by branch tropibot/bump-<name>-<tag>
//     (else by the title "chore: bump <name> to <tag>" from tropibot[bot]).
//  2. Bind TropiBot test reports (comments with <!-- tropibot-test-report -->).
//     A report with a head-sha marker binds only if it equals the PR head.
//     An older report without the marker binds if it was written after the
//     head commit, and a PASSED one only if it shows our version running.
//  3. Read a bound report by its structure only:
//     PASSED + the tested client's "After" cell shows the tag -> pass;
//     PASSED without it -> unverified-fail.
//     FAILED: only the FIRST red row of the Timing table and the text inside
//     the Error Details block count. Red SetStakerConfig/PackageInstall with a
//     DAppNode-side cause -> infra. Red WaitForSync/WaitForValidatorLiveness
//     or a version check -> client-fail. Anything else -> unverified-fail.
//  4. No bound report: the check runs on the PR head (Build / Sync Test).
//  5. After DAppNode merged: the "release / Test" (attestation) check run.
//  6. Shipped: a DAppNode GitHub release that links the PR and is no
//     longer a pre-release (all variants on-chain).

const REPORT_MARKER = '<!-- tropibot-test-report -->';
const DN_SIDE = /my\.dappnode:7000|stakerConfigSet|packageInstall|dappGet|^(Setup|Install) failed/m;
const GITHUB_ACTIONS_APP = 15368;

export function reportHeadSha(body) {
  const m = /<!--\s*tropibot-test-context head-sha:\s*([0-9a-f]{40})\s*-->/.exec(body || '');
  return m ? m[1] : null;
}

function timingRows(body) {
  const sec = /###[^\n]*Timing\s*\n([\s\S]*?)(\n\s*\n|\n\*\*|\n###|$)/.exec(body);
  if (!sec) return [];
  return sec[1]
    .split('\n')
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((c) => c.length >= 4 && c[1] && !/^-+$/.test(c[1]) && c[1] !== 'Operation')
    .map((c) => ({ op: c[1], status: c[3] }));
}

function errorDetails(body) {
  const m = /###[^\n]*Error Details\s*\n+```[a-z]*\n([\s\S]*?)```/.exec(body);
  return m ? m[1] : null;
}

function versionAfter(body, kind) {
  const sec = /###[^\n]*Version Tracking\s*\n([\s\S]*?)(\n\s*\n|\n###|$)/.exec(body);
  if (!sec) return null;
  const want = kind === 'el' ? 'Execution' : 'Consensus';
  for (const line of sec[1].split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    if (c[1] === want) return c[3] || null;
  }
  return null;
}

function tagInText(text, tag) {
  if (!text) return false;
  const bare = tag.replace(/^v/, '');
  return new RegExp(`(^|[^0-9.])v?${bare.replace(/\./g, '\\.')}([^0-9.]|$)`).test(text);
}

export function reportVerdict(body, tag, kind) {
  const status = /SYNC TEST REPORT - (PASSED|FAILED)/.exec(body || '')?.[1];
  if (status === 'PASSED') {
    return tagInText(versionAfter(body, kind), tag)
      ? { verdict: 'pass' }
      : { verdict: 'unverified-fail', why: `the report says PASSED but does not show ${tag} running` };
  }
  if (status !== 'FAILED') return { verdict: 'unverified-fail', why: 'the report could not be read' };
  const red = timingRows(body).find((r) => r.status.includes('❌'));
  const err = errorDetails(body);
  const errLine = err ? err.trim().split('\n')[0].slice(0, 200) : null;
  if (!red) return { verdict: 'unverified-fail', why: 'FAILED report without a red Timing row', error: errLine };
  if (['SetStakerConfig', 'PackageInstall'].includes(red.op) && err && DN_SIDE.test(err)) {
    return { verdict: 'infra', why: `DAppNode's own setup failed at ${red.op}`, step: red.op, error: errLine };
  }
  if (/^WaitFor(Sync|ValidatorLiveness)$|Version/i.test(red.op)) {
    return { verdict: 'client-fail', why: `the client failed at ${red.op}`, step: red.op, error: errLine };
  }
  return { verdict: 'unverified-fail', why: `failed at ${red.op} with no clear cause`, step: red.op, error: errLine };
}

// Picks the newest bound report for the PR head.
export function bindReports(comments, pr, headDate, tag, kind) {
  const bound = [];
  for (const c of comments || []) {
    if (c.user?.login !== 'tropibot[bot]' || !(c.body || '').includes(REPORT_MARKER)) continue;
    const sha = reportHeadSha(c.body);
    if (sha) {
      if (sha !== pr.head.sha) continue;
    } else {
      if (!headDate || new Date(c.created_at) < new Date(headDate)) continue;
      const v = reportVerdict(c.body, tag, kind);
      if (/PASSED/.test(c.body) && v.verdict !== 'pass') continue;
    }
    bound.push(c);
  }
  bound.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return bound[0] || null;
}

function latestByName(runs) {
  const by = new Map();
  for (const r of runs) {
    if (r.app && r.app.id !== undefined && r.app.id !== GITHUB_ACTIONS_APP) continue;
    const prev = by.get(r.name);
    if (!prev || new Date(r.started_at || 0) > new Date(prev.started_at || 0)) by.set(r.name, r);
  }
  return by;
}

export function checkRunVerdict(runs, now) {
  const by = latestByName(runs || []);
  const build = by.get('sync-test / Build Package') || by.get('Build Package') || by.get('Build');
  const sync = by.get('sync-test / Sync Test') || by.get('Sync Test') || by.get('Execution Client Sync Test');
  if (build && build.status === 'completed' && build.conclusion !== 'success') return { verdict: 'infra', why: "DAppNode's package build failed" };
  if (!sync) return { verdict: 'pending', why: 'DAppNode has not run its sync test yet' };
  if (sync.status !== 'completed') {
    const age = now - new Date(sync.started_at || sync.created_at || now);
    return age > 24 * 3600 * 1000 ? { verdict: 'infra', why: 'the sync test is stuck for more than 24 h' } : { verdict: 'pending', why: 'the sync test is running' };
  }
  if (['skipped', 'cancelled'].includes(sync.conclusion)) return { verdict: 'infra', why: `the sync test was ${sync.conclusion}` };
  if (sync.conclusion === 'success') return { verdict: 'no-signal', why: 'the sync test is green but no TropiBot report was posted' };
  return { verdict: 'unverified-fail', why: 'the sync test failed and no report explains why' };
}

export function attestationVerdict(runs) {
  const by = latestByName(runs || []);
  const t = by.get('release / Test') || by.get('Test');
  if (!t) return null;
  if (t.status !== 'completed') return { verdict: 'pending', why: 'the attestation test is running' };
  if (t.conclusion === 'success') return { verdict: 'attest-pass', why: "DAppNode's test validator attested with this version" };
  if (['skipped', 'cancelled'].includes(t.conclusion)) return { verdict: 'infra', why: `the attestation test was ${t.conclusion}` };
  return { verdict: 'unverified-fail', why: 'the attestation test failed (logs not read in stage 1)' };
}

const LEVEL = {
  pass: 'GOOD', 'attest-pass': 'GOOD', shipped: 'GOOD',
  'client-fail': 'BLOCK', 'unverified-fail': 'BLOCK',
  pending: 'WAIT', infra: 'WAIT', 'no-signal': 'WAIT', absent: 'WAIT',
};

export function summarize(result) {
  // The newest definitive result wins; otherwise shipped > pending > infra > no-signal > absent.
  const definitive = ['attest', 'report'].map((k) => result[k]).filter((x) => x && ['pass', 'attest-pass', 'client-fail', 'unverified-fail'].includes(x.verdict));
  let main = definitive[0] || null;
  // Only a release that is no longer a pre-release counts (rule 6): a
  // pre-release after an infra failure proves nothing about the client.
  if (!main && result.shipped?.onchain) main = { verdict: 'shipped', why: 'DAppNode published this version on-chain' };
  if (!main) main = result.checks || result.report || { verdict: 'absent', why: 'DAppNode has no bump PR for this version yet' };
  return { ...main, level: LEVEL[main.verdict] || 'WAIT' };
}

export async function readDappnode({ gh, cfg, tag, now }) {
  const repo = cfg.repo;
  const kind = cfg.kind || 'cl';
  const tags = [...new Set([tag, tag.startsWith('v') ? tag.slice(1) : `v${tag}`])];
  let pr = null;
  for (const t of tags) {
    const list = await gh.get(`repos/${repo}/pulls?state=all&head=${encodeURIComponent(`dappnode:tropibot/bump-${cfg.bump_name}-${t}`)}`);
    if (list && list.length) { pr = list[0]; break; }
  }
  if (!pr) {
    const recent = await gh.get(`repos/${repo}/pulls?state=all&per_page=50`);
    pr = (recent || []).find((p) => p.user?.login === 'tropibot[bot]' && tags.some((t) => p.title === `chore: bump ${cfg.bump_name} to ${t}`)) || null;
  }
  const result = { repo, tag, pr: pr ? { number: pr.number, url: pr.html_url, state: pr.state, merged_at: pr.merged_at, created_at: pr.created_at } : null };
  if (!pr) {
    // Maybe DAppNode never bumped this tag but released it anyway.
    result.shipped = await findShipped(gh, repo, null, tags);
    result.summary = summarize(result);
    return result;
  }
  const comments = await gh.get(`repos/${repo}/issues/${pr.number}/comments?per_page=100`);
  let headDate = null;
  const needsDate = (comments || []).some((c) => c.user?.login === 'tropibot[bot]' && (c.body || '').includes(REPORT_MARKER) && !reportHeadSha(c.body));
  if (needsDate) {
    const head = await gh.get(`repos/${repo}/commits/${pr.head.sha}`);
    headDate = head?.commit?.committer?.date || null;
  }
  const report = bindReports(comments, pr, headDate, tag, kind);
  if (report) {
    result.report = { ...reportVerdict(report.body, tag, kind), at: report.created_at, url: report.html_url || pr.html_url };
  } else {
    const runs = await gh.get(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`);
    result.checks = checkRunVerdict(runs?.check_runs, now);
  }
  if (pr.merged_at && pr.merge_commit_sha) {
    const runs = await gh.get(`repos/${repo}/commits/${pr.merge_commit_sha}/check-runs?per_page=100`);
    const a = attestationVerdict(runs?.check_runs);
    if (a) result.attest = a;
  }
  result.shipped = await findShipped(gh, repo, pr.html_url, tags);
  result.summary = summarize(result);
  return result;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Does a release body link this PR? ".../pull/6" must not match ".../pull/69".
export function linksPr(body, prUrl) {
  return new RegExp(`${escapeRe(prUrl)}(?![0-9])`).test(body || '');
}

// The DAppNode release that ships the PR: an on-chain (non-pre-release) one
// if there is one, else the pre-release (shown as "not yet on-chain").
export async function findShipped(gh, repo, prUrl, tags) {
  const rels = await gh.get(`repos/${repo}/releases?per_page=15`);
  let pre = null;
  for (const r of rels || []) {
    const body = r.body || '';
    const linked = prUrl ? linksPr(body, prUrl) : tags.some((t) => body.includes(`bump ${t}`) || body.includes(` to ${t} `));
    if (!linked) continue;
    const found = { url: r.html_url, onchain: !r.prerelease, published_at: r.published_at };
    if (found.onchain) return found;
    pre = pre || found;
  }
  return pre;
}

// One line of plain English for the digest.
export function describe(dn) {
  if (!dn) return 'no DAppNode package';
  if (dn.error) return `could not read (${dn.error})`;
  const s = dn.summary;
  const words = {
    pass: 'passed their real-node test',
    'attest-pass': 'passed their validator test',
    shipped: 'released it',
    'client-fail': 'client FAILED their test',
    'unverified-fail': 'test result unclear',
    infra: 'their test machine had a problem',
    pending: 'test not finished',
    'no-signal': 'test green, no report',
    absent: 'no bump PR yet',
  };
  let text = words[s.verdict] || s.verdict;
  if (dn.shipped && s.verdict !== 'shipped') text += dn.shipped.onchain ? '; released' : '; release not yet on-chain';
  if (dn.pr) text += dn.pr.merged_at ? ` (PR #${dn.pr.number} merged)` : ` (PR #${dn.pr.number} ${dn.pr.state})`;
  return text;
}
