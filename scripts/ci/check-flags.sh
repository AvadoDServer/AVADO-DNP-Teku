#!/usr/bin/env bash
# Every Teku option AVADO passes still exists in the Teku inside the image.
#
#   scripts/ci/check-flags.sh <image> [out-dir]
#
# Reads the image's own start script and config templates (the files boxes
# run), collects
#   - every --option on a `/opt/teku/bin/teku ...` command line in
#     /opt/teku/startTeku.sh, including the ones used only in some cases
#     (fee recipient, MEV-Boost, bootnodes), and
#   - every key of the YAML config templates (/opt/teku/teku-config*.template).
#     Teku stops with "Unknown option in yaml configuration file" on a key it
#     does not know, so the keys count as options too,
# and checks each command-line option against `teku --help` (beacon node) or
# `teku validator-client --help` (the dual-process validator). YAML keys are
# checked against both help texts together: the validator client accepts
# beacon-node keys in its file (checked with Teku 26.9.0) and refuses only
# unknown ones. Options users add through EXTRA_OPTS cannot be checked here.
set -euo pipefail

IMAGE=${1:?usage: check-flags.sh <image> [out-dir]}
OUT=${2:-$(mktemp -d "${TMPDIR:-/tmp}/check-flags.XXXXXX")}
mkdir -p "$OUT/files"

run() { docker run --rm --platform linux/amd64 "$@"; }

run --entrypoint /bin/sh "$IMAGE" -c 'cd /opt/teku && tar -cf - startTeku.sh teku-config*.template' | tar -C "$OUT/files" -xf -
run --entrypoint /opt/teku/bin/teku "$IMAGE" --help >"$OUT/help-beacon.txt" 2>&1 ||
  { cat "$OUT/help-beacon.txt" >&2; echo "FAIL: teku --help did not run" >&2; exit 1; }
run --entrypoint /opt/teku/bin/teku "$IMAGE" validator-client --help >"$OUT/help-validator-client.txt" 2>&1 ||
  { cat "$OUT/help-validator-client.txt" >&2; echo "FAIL: teku validator-client --help did not run" >&2; exit 1; }

# Option names of a picocli help text: only the names at the start of an option
# line ("  -c, --config-file=<FILENAME>", "      --a, --b=<X>"), never names that
# are merely mentioned in a description.
help_options() {
  sed -nE 's/^ {2,8}((-[A-Za-z], )?--[A-Za-z0-9][A-Za-z0-9-]*(\[?=[^ ]*)?(, --[A-Za-z0-9][A-Za-z0-9-]*(\[?=[^ ]*)?)*).*/\1/p' "$1" |
    grep -oE -- '--[A-Za-z0-9][A-Za-z0-9-]*' | sort -u
}
help_options "$OUT/help-beacon.txt" >"$OUT/options-beacon.txt"
help_options "$OUT/help-validator-client.txt" >"$OUT/options-validator-client.txt"
sort -u "$OUT/options-beacon.txt" "$OUT/options-validator-client.txt" >"$OUT/options-config-file.txt"
[ -s "$OUT/options-beacon.txt" ] && [ -s "$OUT/options-validator-client.txt" ] ||
  { echo "FAIL: could not read any option from teku --help" >&2; exit 1; }

# used.tsv: <checked against> <option> <where>
: >"$OUT/used.tsv"
awk '
  /\/opt\/teku\/bin\/teku/ { inblk = 1; cmd = ($0 ~ /validator-client/) ? "validator-client" : "beacon"; start = NR; buf = "" }
  inblk {
    line = $0; sub(/#.*/, "", line); buf = buf " " line
    if ($0 !~ /\\[ \t]*$/) {
      n = split(buf, words, /[ \t"=}{:+$]+/)
      for (i = 1; i <= n; i++) if (words[i] ~ /^--[a-z0-9][a-z0-9-]*$/) print cmd "\t" words[i] "\tstartTeku.sh:" start
      inblk = 0
    }
  }
' "$OUT/files/startTeku.sh" >>"$OUT/used.tsv"
for t in "$OUT"/files/teku-config*.template; do
  cmd=config-file
  grep -nE '^[a-z][a-z0-9-]*:' "$t" | while IFS=: read -r line key _; do
    printf '%s\t--%s\t%s:%s\n' "$cmd" "$key" "$(basename "$t")" "$line"
  done >>"$OUT/used.tsv"
done
[ -s "$OUT/used.tsv" ] || { echo "FAIL: found no Teku option in the start script or templates" >&2; exit 1; }

missing=0
printf '%-17s %-52s %-8s %s\n' "CHECKED AGAINST" OPTION RESULT "USED IN"
sort -u "$OUT/used.tsv" | while IFS=$'\t' read -r cmd opt where; do
  if grep -qxF -- "$opt" "$OUT/options-$cmd.txt"; then r=ok; else r=MISSING; fi
  printf '%-17s %-52s %-8s %s\n' "$cmd" "$opt" "$r" "$where"
done | tee "$OUT/result.txt"
missing=$(grep -c ' MISSING ' "$OUT/result.txt" || true)
total=$(wc -l <"$OUT/result.txt" | tr -d ' ')
if [ "$missing" != 0 ]; then
  echo "FAIL: $missing of $total options AVADO passes to Teku do not exist in this Teku version (see MISSING above; help texts in $OUT)" >&2
  exit 1
fi
echo "PASS: all $total options AVADO passes to Teku exist in this Teku version"
