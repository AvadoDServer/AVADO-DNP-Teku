# AVADO Teku

Teku beacon chain and validator for AVADO. One repo builds one package per network:

| Network | Package (unchanged name) | Variant folder |
|---|---|---|
| Ethereum mainnet | `teku.avado.dnp.dappnode.eth` | `package_variants/mainnet/` |
| Gnosis | `teku-gnosis.avado.dnp.dappnode.eth` | `package_variants/gnosis/` |

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
                               of every network, and the only place it is written
package_variants/<network>/
  dappnode_package.json        name, version, title, description, avatar hash, type,
                               ports, environment, ui, links
  docker-compose.yml           build arg NETWORK
  avatar.png                   the package's avatar
  releases.json                the release record (written by release.yml)
build/                         one Dockerfile and one set of scripts for every network
  ui-config.sh                 writes the wizard and monitor config and the default
                               settings for NETWORK (the Dockerfile runs it)
  monitor/settings/defaultsettings-<network>.json
scripts/render.sh              base + variant -> a folder the AVADOSDK can build
scripts/prove-equivalence.sh   proves the rendered packages equal production
scripts/ci/                    the checks (identity, version, options, boot test, AVADOSDK build)
.github/workflows/             pr-checks, bump, gate, release (see "How releases work now")
.github/pipeline/              the bump, gate and release logic (Node, no dependencies)
```

Keys that identify a package on the boxes (name, version, ports, environment,
title, links...) are only allowed in the variant folders; `render.sh` refuses a
base manifest that sets one. The manifest's `upstream` is not written anywhere:
`render.sh` copies it from `TEKU_VERSION`.

## How releases work now

In plain words: **a robot prepares every Teku update, our own checks test it,
DAppNode's real node is the second opinion, and a tested update goes to the
staging store by itself. Customers only get it when you publish it to
production in editstore, as before.**

1. **Bump** (every 4 hours, `bump.yml`). When Teku publishes a new stable
   release and its Docker image exists, the robot opens ONE pull request on
   branch `avado-bot/bump` that moves every network to it: `TEKU_VERSION` in
   `docker-compose.yml`, and the `version` of each
   `package_variants/<network>/dappnode_package.json` one step up. If an even
   newer Teku appears while the PR is open, the same PR is updated.
2. **Checks** (`pr-checks.yml`, status `avado/checks`), for every network, on
   free GitHub machines:
   - the package is built with the AVADOSDK exactly as before (files added to
     AVADO's IPFS node), and the image is loaded back from the uploaded file;
   - the Teku inside is exactly the new version;
   - every Teku option we pass (start script and config files) still exists in
     that Teku's `--help`;
   - the package name, volumes, host ports and settings names are the same as
     on `main` and in production, and the version goes up;
   - the package **boots on its real network** for a few minutes with its real
     command line: it loads a recent checkpoint, finds peers, follows the chain
     and logs no fatal error;
   - the **equivalence proof**: everything AVADO adds (start script, config,
     wizard, monitor, what Teku is started with) is the same as what boxes run
     today, apart from the reviewed differences in `scripts/proof/expected/`.
3. **Gate** (every 4 hours and after every check run, `gate.yml`, status
   `avado/gate`). It merges the PR (a merge commit) only when our checks are
   green **and**:
   - DAppNode's real-node test of the same Teku version passed (their pull
     request `tropibot/bump-teku-<version>` in
     `dappnode/DAppNodePackage-teku-generic`, read strictly: a report that says
     PASSED and shows the version, their test validator attesting, or their
     published release); or
   - DAppNode has given no usable answer and **72 hours** have passed since the
     Teku release; or
   - the Teku release notes (or the release watcher) say the upgrade is
     **required**: then it does not wait the 72 hours.

   It does **not** merge when our checks fail, when DAppNode's test shows the
   client failing, or when anything is unclear. Then it opens an issue for you
   (see "What the emails mean"). The gate writes its reasoning in a comment on
   the PR, updated on every run.
4. **Release** (`release.yml`, after the merge). Every network whose version is
   new is published to the **staging** store: the exact build the checks
   tested, its hash recorded in `package_variants/<network>/releases.json` and
   in a commit `Release <name> <version>` (the format the release watcher and
   editstore know), then `store.setPackageHash` for each package and one
   `store.releaseStore`, with the `RPC_TOKEN` secret, as the old
   `ci-release-action` did. A network whose version did not change is not
   published. Without `RPC_TOKEN` it only shows what it would do.
5. **Production**: unchanged. You publish it in editstore when you are happy
   with staging.

Human pull requests get the same checks. When you merge one yourself (always
with "Create a merge commit"), the release step publishes every network whose
version you raised.

### Pause the robot

Settings → Secrets and variables → Actions → **Variables** → repository
variable `PIPELINE_MODE`:

| Value | Effect |
|---|---|
| (not set) or `on` | Normal: bump, check, gate, merge, release to staging |
| `shadow` | Bump and checks run, the gate says what it *would* do (status and PR comment) but never merges |
| `off` | The bump robot and the gate do nothing. Checks still run on pull requests, and a merge you make yourself is still released to staging |

Other variables: `PIPELINE_OWNER` (who gets the issues, default `flisko`),
`IPFS_PROVIDER` (leave empty; `local` is only for a test copy of this repo, its
builds can never be released).

### What the emails mean

GitHub emails the person an issue is assigned to (`PIPELINE_OWNER`). Keep
**Email** ticked for "Participating, @mentions and custom" in
github.com/settings/notifications.

- **"[needs fix] Teku <version>: our checks failed ..."**: the new Teku broke
  something (for example an option we use was renamed). Nothing was merged or
  released. The issue has the failing check, its log lines, and a
  **ready-to-paste Claude Code prompt**: run `gh pr checkout <n>`, start
  `claude`, paste the prompt, review, push. The checks run again and the gate
  merges when they are green. The issue closes by itself.
- **"[needs fix] Teku <version>: ... failed DAppNode's real-node test"** or
  **"... DAppNode's result is unclear"**: DAppNode saw a problem with this
  version. Nothing was merged. It clears by itself if DAppNode later passes it
  or a newer Teku replaces it. The prompt asks Claude Code to explain whether
  it is Teku's fault or DAppNode's test setup. If you decide it is safe, merge
  the PR yourself with "Create a merge commit"; to skip the version, close it.
- **"[pipeline broken] <workflow> workflow failed"**: the robot itself broke
  (GitHub, Docker Hub, AVADO's IPFS node or store did not answer, or a bug).
  Nothing reaches any box. The issue has the run link and a prompt; it closes
  by itself after the next successful run.
- A comment on one of these issues means the situation changed (a new failure,
  or it came back). A problem that stays the same does not send more emails.

Also watch for: the release watcher (`AvadoDServer/avado-release-control`)
emails "URGENT: pipeline workflows stopped" when `bump.yml` or `gate.yml` is
disabled or keeps failing. GitHub switches off scheduled workflows in a public
repo after 60 days without commits ("disabled_inactivity"); the fix is
Actions → the workflow → **Enable workflow**.

### Secrets

- `RPC_TOKEN` (organisation secret, as before): used only by `release.yml` for
  `store.setPackageHash` and `store.releaseStore`.
- `PAT_TOKEN` (repository secret, as before): the bump robot pushes and opens
  its PR with it, so the checks start by themselves (GitHub does not start
  workflows for changes made with the built-in token). Without it the robot
  starts the checks through `workflow_dispatch`, which also works; the PR then
  also shows a "PR checks" run marked "action required" that can be ignored.
  The gate also uses it, if present, to read the release watcher's URGENT
  issues.

### Update Teku by hand

Change `TEKU_VERSION` in `docker-compose.yml` and raise `version` in every
`package_variants/<network>/dappnode_package.json`, open a pull request, merge
it when `avado/checks` is green. (Or run the Bump Teku workflow by hand.)

## Checks

The scripts the checks run also work on your Mac (Docker needed; an Apple
Silicon Mac runs the amd64 image slowly, the boot test is best left to CI):

```bash
scripts/ci/check-identity.sh mainnet origin/main       # names, volumes, ports, env keys, versions
dir=$(scripts/render.sh mainnet) && (cd "$dir" && docker compose build)
scripts/ci/check-version.sh teku.avado.dnp.dappnode.eth:0.0.75 26.9.0
scripts/ci/check-flags.sh teku.avado.dnp.dappnode.eth:0.0.75
scripts/ci/boot-test.sh teku.avado.dnp.dappnode.eth:0.0.75 "$dir" /tmp/boot
scripts/prove-equivalence.sh --manifests-only
node --test ".github/pipeline/test/*.test.mjs"          # the gate's rules
```

`scripts/ci/sdk-build.sh <network> <out> <ipfs api>` is the AVADOSDK build the
checks and the release use (AVADOSDK pinned at commit 23d6757).

The boot test starts the image with the manifest's environment, ports and a
fresh volume, plus a stand-in for the box: `dappmanager.my.ava.do` (JWT and
certificate) and an execution client that answers "still syncing", so Teku
follows the chain optimistically as on a new box. It proves checkpoint sync,
peers and a clean start, not block execution (no real execution client fits
on a GitHub machine).

## Build a package

```bash
dir=$(scripts/render.sh gnosis)        # or mainnet; prints the rendered folder
cd "$dir" && avadosdk build --provider <ipfs api>
```

The rendered folder is a normal single-network package (manifest, compose, avatar,
`build/`), so the AVADOSDK builds it unchanged. `render.sh` needs `git`, `jq` and
`yq` v4 (github.com/mikefarah/yq).

To try the image without the SDK:

```bash
docker build --platform linux/amd64 --build-arg TEKU_VERSION=26.9.0 --build-arg NETWORK=gnosis build/
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
compose with the production release, the avatar, and the production image with
the new one (image config, AVADO's files, the wizard and monitor builds, what
the start script hands to Teku for each `MODE` and for a box with existing
settings, and the running container's monitor and wizard).

What the Teku base image decides is set aside, so the proof also holds for a
Teku bump: the package version and `upstream`, the image tag and
`TEKU_VERSION`, `teku --version`, and the image labels, exposed ports and
Java environment of the Teku image. They are printed as INFO lines. Separate
checks make sure the Teku version is exact, the options exist and the identity
is unchanged.

`scripts/proof/expected/<network>/*.diff` lists the **allowed** differences
from production, reviewed in git: a check passes when every differing line is
in its file. When production catches up, fewer lines differ and the proof still
passes. When you change something AVADO adds (start script, config, UI), run
`--update-expected` for the affected networks and review the changed `.diff`
files in the same pull request.

## Test copy (dry run)

To try the pipeline without touching this repo or the store: push it to a
private repository, set the variable `IPFS_PROVIDER=local` there (builds go to a
throwaway IPFS node on the runner), do not add `RPC_TOKEN` (the release is a
dry run), and tick Settings → Actions → General → "Allow GitHub Actions to
create and approve pull requests" (needed without `PAT_TOKEN`). Run "Bump
Teku" by hand with a `version` to simulate a release; a version without a
Docker image makes the checks fail, which exercises the issue path. Set
`PIPELINE_MODE=off` there afterwards. The first copy is
`flisko/teku-pipeline-dryrun` (private, paused).
