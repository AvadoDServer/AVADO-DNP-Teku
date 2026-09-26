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
build/                         one Dockerfile and one set of scripts for every network
  ui-config.sh                 writes the wizard and monitor config and the default
                               settings for NETWORK (the Dockerfile runs it)
  monitor/settings/defaultsettings-<network>.json
scripts/render.sh              base + variant -> a folder the AVADOSDK can build
scripts/prove-equivalence.sh   proves the rendered packages equal production
```

Keys that identify a package on the boxes (name, version, ports, environment,
title, links...) are only allowed in the variant folders; `render.sh` refuses a
base manifest that sets one. The manifest's `upstream` is not written anywhere:
`render.sh` copies it from `TEKU_VERSION`.

## Update Teku

1. Change `TEKU_VERSION` in `docker-compose.yml`. Every network gets it.
2. Raise `version` in `package_variants/<network>/dappnode_package.json` for every
   network that gets the new build.

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
```

It reads the live production store (`bo.ava.do/value/store`, every IPFS file
checked against its hash) and compares, per network: the rendered manifest and
compose with the production release, the avatar, and the production image with a
freshly built one (`teku --version`, image config with ports and volumes, AVADO's
files, the wizard and monitor builds, what the start script hands to Teku for each
`MODE`, and the running container's monitor and wizard). Differences that are
intended are written down in `scripts/proof/expected/<network>/*.diff`; any other
difference fails. The Build workflow runs it on every pull request.

After a production release, or when a difference is intended, run it with
`--update-expected` and review the changed `.diff` files before committing them.

## Releasing

The old release workflow (`ci-build-action` / `ci-release-action`) and the
`update_upstream` bot build from the repo root and cannot build this layout. They
are replaced by the Teku pilot pipeline (one bump pull request for every network,
our own checks, release to staging). Production promotion stays a manual step in
editstore.
