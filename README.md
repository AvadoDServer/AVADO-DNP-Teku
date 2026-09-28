# AVADO Teku

Teku beacon chain and validator for AVADO. One repo builds one package per network:

| Network | Package (unchanged name) | Variant folder |
|---|---|---|
| Ethereum mainnet | `teku.avado.dnp.dappnode.eth` | `package_variants/mainnet/` |
| Gnosis | `teku-gnosis.avado.dnp.dappnode.eth` | `package_variants/gnosis/` (existing customers only, until the GIP-153 sunset; see "Gnosis") |

**Hoodi is deferred.** A Hoodi variant is added once AVADO has a Hoodi execution
client (Teku needs one to follow the chain). It will be a new package name with
host ports that no other AVADO package uses.

The layout follows DAppNode's generic packages (for example
`dappnode/DAppNodePackage-teku-generic`): one base package plus a folder per
network. `main` is never switched between networks (the old `setNetwork.sh` is gone).

## Layout

```
dappnode_package.json          base manifest: only what every network shares
                               (autoupdate, volume data:/data, restart, author, license)
docker-compose.yml             base compose; TEKU_VERSION is the upstream Teku version
                               of every network (the only place it is written) and
                               TEKU_DIGEST its Docker Hub digest
package_variants/<network>/
  dappnode_package.json        name, version, title, description, avatar hash, type,
                               ports, environment, ui, links
  docker-compose.yml           build arg NETWORK
  avatar.png                   the package's avatar
  hold                         only while the owner holds this network back (see "Holds")
  releases.json                the release record (written by release.yml)
build/                         one Dockerfile and one set of scripts for every network
  ui-config.sh                 writes the wizard and monitor config and the default
                               settings for NETWORK (the Dockerfile runs it)
  monitor/settings/defaultsettings-<network>.json
scripts/render.sh              base + variant -> a folder the AVADOSDK can build
scripts/prove-equivalence.sh   proves the rendered packages equal production
scripts/ci/                    the checks (identity, digest, version, options, boot test,
                               upgrade test, AVADOSDK build, content id)
.github/workflows/             pr-checks, bump, gate, release (see "How releases work now")
.github/pipeline/              the bump, gate and release logic (Node, no dependencies)
```

Keys that identify a package on the boxes (name, version, ports, environment,
title, links...) are only allowed in the variant folders; `render.sh` refuses a
base manifest that sets one. The manifest's `upstream` is not written anywhere:
`render.sh` copies it from `TEKU_VERSION`.

The Dockerfile builds `FROM consensys/teku:<TEKU_VERSION>@<TEKU_DIGEST>`, the node
builder image by digest, the nvm installer by commit and sha256, and the wizard
and monitor with `yarn install --frozen-lockfile`, so a moved tag or a changed
dependency cannot slip into a package.

## How releases work now

In plain words: **a robot prepares every Teku update, our own checks test it,
DAppNode's real node is the second opinion, and a tested update goes to the
staging store by itself. Customers only get it when you publish it to
production in editstore, as before.** Until you set `PIPELINE_MODE` to `on`,
the robot only prepares and comments; it never merges (see "Modes").

1. **Bump** (every 4 hours, `bump.yml`). When Teku publishes a new stable
   release and its Docker image exists, the robot opens ONE pull request on
   branch `avado-bot/bump` that moves every network that is not held to it:
   `TEKU_VERSION` and `TEKU_DIGEST` in `docker-compose.yml`, and the `version`
   of each `package_variants/<network>/dappnode_package.json` one step up. If
   an even newer Teku appears while the PR is open, the same PR is updated.
   If you close the PR without merging, that Teku version is skipped and the
   robot waits for the next release (reopen the PR to undo).
2. **Checks** (`pr-checks.yml`, status `avado/checks`), for every network that
   is not held, on free GitHub machines:
   - the Teku image digest is still what Docker Hub serves for that version;
   - the package is built with the AVADOSDK exactly as before (files added to
     AVADO's IPFS node, about 0.43 GB per network and run; as with
     ci-build-action, nothing removes the builds that are never released), and
     the image is loaded back from the uploaded file;
   - the Teku inside is exactly the new version;
   - every Teku option we pass (start script and config files) still exists in
     that Teku's `--help` (hidden `--X...` options, which `--help` never lists,
     are checked by the equivalence proof, per network);
   - the package name, volumes, host ports and settings names are the same as
     on `main` and in production, and the version goes up;
   - the package **boots on its real network** for a few minutes with its real
     command line: it loads a recent checkpoint, finds peers, follows the chain,
     logs no fatal error, every UDP port it listens on is published by the
     manifest, and every libp2p port it advertises to peers (TCP, QUIC) is one
     the manifest publishes (peers must reach it);
   - the **equivalence proof**: everything AVADO adds (start script, config,
     wizard, monitor, what Teku is started with, argument by argument and in
     order) is the same as what boxes run today, apart from the reviewed
     differences in `scripts/proof/expected/`; and Teku accepts every hidden
     `--X...` option the start script passes to that network (it is started
     with each one: it refuses an unknown option or value), so an option only
     Gnosis uses never blocks mainnet;
   - the **upgrade in place**: the production image runs on a data volume and
     follows the chain, a throwaway validator key (new and random for every
     run, so there is no fixed key anyone could deposit to; the node also
     confirms it is no validator) is imported into it with a slashing
     protection record, it is stopped, and the new build starts on the same
     volume the way a box auto-updates; it must keep Teku's database (no fresh
     start, no database error), keep `/data/settings.json`, still list the
     validator key, keep the slashing protection record (read back with the
     new Teku's own export), and follow the chain. Then, for information only,
     the production image starts once more on that volume ("going back" in the
     log): it tells you whether the older Teku can still open the newer
     database or would need a resync (see "Gnosis").
   A check that fails only because of the public network (checkpoint, peers)
   is tried once more on the spot.
3. **Gate** (every 4 hours and after every check run, `gate.yml`, status
   `avado/gate`). It merges the PR (a merge commit) only when our checks are
   green, the branch contains `main`, **and**:
   - DAppNode's real-node test of the same Teku version passed (their pull
     request `tropibot/bump-teku-<version>` in
     `dappnode/DAppNodePackage-teku-generic`, read strictly: a report that says
     PASSED and shows the version, their test validator attesting, or their
     published release); or
   - DAppNode has given no usable answer and **72 hours** have passed since the
     Teku release; or
   - the Teku release notes (or the release watcher) say the upgrade is
     **required for every network the PR releases**: then it does not wait the
     72 hours. Required for one network only (a sentence that names Gnosis, for
     example): it waits as usual, the PR comment says so, and once our checks
     are green you get an issue ("[your call] ...", below) so you can merge by
     hand if it cannot wait.

   It does **not** merge when our checks fail, when DAppNode's test shows the
   client failing, when anything is unclear, or when a person pushed changes to
   the checks, the proof or the pipeline onto the robot's branch (those are
   yours to review and merge). Then it opens an issue for you (see "What the
   emails mean"). Checks that failed on an outside step (the build, the boot or
   upgrade test, the proof) are first run once more, without an email. The gate
   writes its reasoning in a comment on the PR, updated on every run. It also
   starts the release when a version on `main` never got a release run.
4. **Release** (`release.yml`, after the merge). Every network whose version is
   new and that is not held is published to the **staging** store: **only the
   exact build the checks tested for these files** (found by a content id that
   ignores release records; a merge commit, a squash and a re-run all find it),
   its hash recorded in `package_variants/<network>/releases.json` and in a
   commit `Release <name> <version>` (the format the release watcher and
   editstore know), then `store.setPackageHash` for each package and one
   `store.releaseStore`, with the `RPC_TOKEN` secret, as the old
   `ci-release-action` did. It never builds anything itself. A network without
   a tested build is not published, and you get an issue that says what to do
   (below). A network whose version did not change is not published. Without
   `RPC_TOKEN` it only shows what it would do.
5. **Production**: unchanged. You publish it in editstore when you are happy
   with staging.

Human pull requests get the same checks. **Open them from a branch in this
repo** (not a fork) and merge them yourself with **"Create a merge commit"**
when the branch is up to date with `main`: the release then publishes every
network whose version you raised, from the build the checks tested. Pull
requests from forks are checked on a throwaway IPFS node and their builds are
never released; after merging one, run the checks for `main` (below).

**"Release: NOT published ... no tested build"**: `main` has files the checks
never tested (a merge while the branch was behind `main`, a fork PR, a direct
push). Actions → **PR checks** → Run workflow with `pr` = `main`; when it is
green, Actions → **Release** → Run workflow.

### Modes

Settings → Secrets and variables → Actions → **Variables** → repository
variable `PIPELINE_MODE`:

| Value | Effect |
|---|---|
| (not set) or `shadow` | The robot bumps and the checks run; the gate says what it *would* do (status and PR comment) but never merges. This is the default. |
| `on` | Normal: bump, check, gate, merge, release to staging |
| `off` | The bump robot and the gate do nothing. Checks still run on pull requests, and a merge you make yourself is still released to staging |

A merge you make yourself is released to staging in every mode.

Other variables: `PIPELINE_OWNER` (who gets the issues, default `flisko`),
`IPFS_PROVIDER` (leave empty; `local` is only for a test copy of this repo, its
builds can never be released).

### Holds

A network can stay behind the others: a file `package_variants/<network>/hold`
whose first line says why. A held network is not bumped, built, tested,
counted by the gate or released; boxes keep the version they have. You end a
hold by removing the file in a pull request you merge yourself; its checks then
build and test that network, and the merge publishes it to staging. A hold is
also the way to ship a required release for one network when another network
fails its checks.

Gnosis is not held any more: its catch-up from production `teku-gnosis` 0.0.27
(Teku 26.4.0) is 0.0.29 on Teku 26.9.0, published to staging by the merge that
removed the hold; production moves when you promote it in editstore. See
"Gnosis" below.

### Gnosis

`teku-gnosis` is kept safe for the customers who run it today and gets the same
Teku updates as mainnet, but it is no longer sold and gets no new features:
GnosisDAO passed **GIP-153** on 2026-08-19, which retires the Gnosis validator
set when Gnosis becomes an Ethereum rollup (target Dec 2026 / Jan 2027, may
slip). When the sunset date is fixed: hold the gnosis variant after its last
needed release, move `teku-gnosis` to the "Sunset" category in editstore, and
remove `package_variants/gnosis/` once no box needs it. If a Teku release ever
breaks only Gnosis before then (for example Gnosis support is dropped around
the sunset), hold gnosis (a `package_variants/gnosis/hold` file with the
reason, in a PR you merge yourself) so mainnet keeps shipping.

**QUIC is off for Gnosis** (decided at the catch-up, 2026-09-27). Teku turns
QUIC on by default since 26.7.0 and listens and advertises it on 9001/udp. For
Gnosis `build/startTeku.sh` passes `--Xp2p-quic-enabled=false` (a hidden Teku
option; the equivalence proof starts the gnosis build's Teku with it, so a Teku
that drops or renames it fails gnosis's checks; mainnet never passes it, so
with gnosis held mainnet keeps shipping), because:
- it keeps what Gnosis boxes do today: Teku 26.4.0 (production 0.0.27) has no
  QUIC at all, and the package publishes only 9006 tcp/udp;
- on a box that also runs mainnet Teku, host port 9001/udp belongs to the
  mainnet package, so Gnosis peers dialling an advertised 9001 would reach the
  wrong node; a new Gnosis port would be a new host port on customer boxes (a
  port clash can stop the package), which is not worth it for a network that
  is being retired;
- Gnosis peers without it: TCP stays a required transport in the consensus
  spec (ethereum/consensus-specs #5330, 2026-07, made QUIC required and
  primary, but kept TCP a MUST), every Gnosis client speaks TCP, and DAppNode's
  own teku-gnosis also publishes no QUIC port.
Mainnet is unchanged: it publishes 9001/udp and runs QUIC. The boot test fails
when Teku listens on or advertises a port the manifest does not publish, and the
equivalence proof (`candidate-quic`) checks every start profile, so neither
network can drift. Revisit only if a Teku release or the spec drops TCP; the
alternative then is a Gnosis-owned QUIC port (`--p2p-quic-port=<port>` plus
`<port>:<port>/udp` in `package_variants/gnosis/dappnode_package.json`, a
deliberate identity change).

**Before you promote a Gnosis version to production.** Nobody runs Gnosis on a
real node before staging: DAppNode's test (the gate's second opinion) runs
Teku on Hoodi, and our checks run Gnosis with a stand-in execution client that
always answers "syncing" and a database a few minutes old. So, for the
catch-up to 0.0.29 and whenever a Teku update changes something for Gnosis,
test it on the test box first:
1. On the test box (on the staging store), have `teku-gnosis` on the
   production version with `nethermind-gnosis`, synced and following the head.
2. Update `teku-gnosis` to the staging version from the DAPPMANAGER.
3. Check that its head keeps moving with the box's Nethermind, the validator
   keys are still listed, and a test key attests (if one is loaded).
4. Then promote it in editstore.

There is no quick way back once boxes have it, which is why the box test
comes first: the DAPPMANAGER auto-updates only to a HIGHER version, so
promoting the previous version again in editstore stops further updates but
does not move boxes back. A way back for boxes that already updated is a new,
higher version built with the older Teku, and because every network shares
`TEKU_VERSION`, that is separate work, not a setting. Whether the older Teku
can still open the newer database (for such a version, or for a user who
reinstalls the old one) is the upgrade test's "going back" line: PR checks
run, artifact `checks-gnosis`, file `upgrade/result.tsv`.

### What the emails mean

GitHub emails the person an issue is assigned to (`PIPELINE_OWNER`). Keep
**Email** ticked for "Participating, @mentions and custom" in
github.com/settings/notifications.

- **"[needs fix] Teku <version>: our checks failed ..."**: the new Teku broke
  something (for example an option we use was renamed), and the automatic
  re-run did not help. Nothing was merged or released. The issue has the
  failing check, its log lines, and a **ready-to-paste Claude Code prompt**:
  run `gh pr checkout <n>`, start `claude`, paste the prompt, review, push. The
  checks run again and the gate merges when they are green. The issue closes by
  itself.
- **"[needs fix] Teku <version>: ... failed DAppNode's real-node test"** or
  **"... DAppNode's result is unclear"**: DAppNode saw a problem with this
  version. Nothing was merged. It clears by itself if DAppNode later passes it
  or a newer Teku replaces it. The prompt asks Claude Code to explain whether
  it is Teku's fault or DAppNode's test setup. If you decide it is safe, merge
  the PR yourself with "Create a merge commit"; to skip the version, close it.
- **"[needs fix] Teku <version>: a person changed the checks or the pipeline
  ..."**: someone (or Claude Code) pushed changes to the checks, the proof or
  the pipeline onto the robot's PR. Read them, and merge the PR yourself if
  they are right.
- **"[your call] Teku <version>: required for gnosis only ..."**: nothing is
  broken. Teku marks the release as required for one network only, our checks
  are green, and the gate waits for DAppNode's test (at most 72 hours after the
  Teku release). If that is soon enough (the prompt asks Claude Code to find
  the fork date), do nothing: the gate merges and the issue closes by itself.
  If not, merge the PR yourself with "Create a merge commit".
- **"[pipeline broken] <workflow> workflow failed"**: the robot itself broke
  (GitHub, Docker Hub, AVADO's IPFS node or store did not answer, or a bug), or
  the release found no tested build. Nothing reaches any box. The issue shows
  the error, the run link and a prompt; it closes by itself after the next
  successful run.
- **"[pipeline] PAT_TOKEN was rejected: renew it"**: the personal token expired.
  The robot keeps working without it; renew it when convenient (see "Secrets").
- A comment on one of these issues means the situation changed (a new failure,
  or it came back). A problem that stays the same does not send more emails.

Also watch for: the release watcher (`AvadoDServer/avado-release-control`)
emails "URGENT: pipeline workflows stopped" when `bump.yml` or `gate.yml` is
disabled or keeps failing. GitHub switches off scheduled workflows in a public
repo after 60 days without commits ("disabled_inactivity"); the fix is
Actions → the workflow → **Enable workflow**.

### Secrets

- `RPC_TOKEN` (organisation secret, as before): used only by `release.yml` for
  `store.setPackageHash` and `store.releaseStore`. The release job runs no build
  and no third-party code next to it.
- `PAT_TOKEN` (repository secret, as before, optional): the bump robot pushes
  and opens its PR with it, so the checks start by themselves (GitHub does not
  start workflows for changes made with the built-in token). Use a
  **fine-grained** token: resource owner AvadoDServer, only this repository,
  Contents and Pull requests read and write, with an expiry date. Not a classic
  `repo` token: it would open every AvadoDServer repository. When it is missing
  or expired, the robot starts the checks itself through `workflow_dispatch`
  (the PR then also shows a "PR checks" run marked "action required" that can
  be ignored) and emails you once to renew it.
- `WATCHER_READ_TOKEN` (optional, recommended now that Gnosis ships): lets the
  gate read the release watcher's URGENT issues, including its fork-schedule
  check for `teku-gnosis`. A fine-grained token for
  `AvadoDServer/avado-release-control` with Issues: read only. Without it the
  gate uses the Teku release notes' wording only, and the PR comment says
  "release watcher: not read".

### Update Teku by hand

Change `TEKU_VERSION` and `TEKU_DIGEST` (Docker Hub: the tag's digest) in
`docker-compose.yml` and raise `version` in every
`package_variants/<network>/dappnode_package.json` that is not held, open a
pull request from a branch in this repo, merge it when `avado/checks` is green.
(Or run the Bump Teku workflow by hand.)

## Checks

The scripts the checks run also work on your Mac (Docker needed; an Apple
Silicon Mac runs the amd64 image slowly, the boot and upgrade tests are best
left to CI):

```bash
scripts/ci/check-identity.sh mainnet origin/main       # names, volumes, ports, env keys, versions
scripts/ci/check-digest.sh                              # TEKU_DIGEST is what Docker Hub serves
dir=$(scripts/render.sh mainnet) && (cd "$dir" && docker compose build)
scripts/ci/check-version.sh teku.avado.dnp.dappnode.eth:0.0.75 26.9.0
scripts/ci/check-flags.sh teku.avado.dnp.dappnode.eth:0.0.75
scripts/ci/boot-test.sh teku.avado.dnp.dappnode.eth:0.0.75 "$dir" /tmp/boot
scripts/prove-equivalence.sh --manifests-only
scripts/ci/upgrade-test.sh avado-proof/production-mainnet:latest avado-proof/candidate-mainnet:latest "$dir" /tmp/upgrade   # after a full proof
node --test ".github/pipeline/test/*.test.mjs"          # the gate's rules (Node 22)
```

`scripts/ci/sdk-build.sh <network> <out> <ipfs api>` is the AVADOSDK build the
checks use (AVADOSDK pinned at commit 23d6757). `scripts/ci/content-id.sh`
prints the content id the tested build is named after.

The boot test starts the image with the manifest's environment, ports and a
fresh volume, plus a stand-in for the box: `dappmanager.my.ava.do` (JWT and
certificate) and an execution client that answers "still syncing", so Teku
follows the chain optimistically as on a new box. It proves checkpoint sync,
peers and a clean start, not block execution (no real execution client fits
on a GitHub machine). The upgrade test uses the same stand-in.

## Build a package

```bash
dir=$(scripts/render.sh mainnet)       # or gnosis; prints the rendered folder
cd "$dir" && avadosdk build --provider <ipfs api>
```

The rendered folder is a normal single-network package (manifest, compose, avatar,
`build/`), so the AVADOSDK builds it unchanged. `render.sh` needs `git`, `jq` and
`yq` v4 (github.com/mikefarah/yq).

To try the image without the SDK (the two values are in `docker-compose.yml`):

```bash
docker build --platform linux/amd64 --build-arg TEKU_VERSION=26.9.0 \
  --build-arg TEKU_DIGEST=sha256:6bfef491dc2714b8c4ed4af2c05decb78b2058d77dad50a3fb2d3df167b5fde6 \
  --build-arg NETWORK=mainnet build/
```

For UI development, write the per-network UI files first (they are generated,
not committed): `build/ui-config.sh mainnet`.

## Equivalence proof

```bash
scripts/prove-equivalence.sh                   # every network, builds both images
scripts/prove-equivalence.sh --manifests-only  # manifests, compose and avatar only
scripts/prove-equivalence.sh gnosis            # one network
scripts/prove-equivalence.sh --candidate-image teku.avado.dnp.dappnode.eth:0.0.76 mainnet   # an image already built
```

It reads the live production store (`bo.ava.do/value/store`, every IPFS file
checked against its hash) and compares, per network: the rendered manifest and
compose with the production release (for a release this pipeline made, the
variant rendered from that release commit), the avatar, and the production
image with the new one (image config, AVADO's files, the wizard and monitor
builds, what the start script hands to Teku for each `MODE` and for a box with
existing settings, and the running container's monitor and wizard).

What the Teku base image decides is set aside, so the proof also holds for a
Teku bump: the package version and `upstream`, the image tag, `TEKU_VERSION`
and `TEKU_DIGEST`, `teku --version`, and the image labels, exposed ports and
Java environment of the Teku image. They are printed as INFO lines. Separate
checks make sure the Teku version is exact, the options exist and the identity
is unchanged.

`scripts/proof/expected/<network>/*.diff` lists the **allowed** differences
from production, reviewed in git: a check passes when every differing line is
in its file. When production catches up, fewer lines differ and the proof still
passes. When you change something AVADO adds (start script, config, UI), run
`--update-expected` for the affected networks and review the changed `.diff`
files in the same pull request (the gate leaves such a PR to you).

## Test copy (dry run)

To try the pipeline without touching this repo or the store: push it to a
private repository, set the variable `IPFS_PROVIDER=local` there (builds go to a
throwaway IPFS node on the runner), do not add `RPC_TOKEN` (the release is a
dry run), set `PIPELINE_MODE=on` if the gate should merge, and tick Settings →
Actions → General → "Allow GitHub Actions to create and approve pull requests"
(needed without `PAT_TOKEN`). Run "Bump Teku" by hand with a `version` to
simulate a release; a version without a Docker image makes the checks fail,
which exercises the issue path. Set `PIPELINE_MODE=off` there afterwards. The
first copy is `flisko/teku-pipeline-dryrun` (private, paused).
