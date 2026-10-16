#!/usr/bin/env bash
# Stage a Paseo VS Code QA run on the Windows CUA VM.
#
#   stage.sh <repo-checkout> <run-name> <ssh-target>
#
# Packs the daemon packages and the VSIX from <repo-checkout> (already built), copies them with
# the launch scripts into %USERPROFILE%\paseo-qa\<run-name> on the VM, unpacks the cached portable
# toolchain (VS Code, Node, MinGit) from %USERPROFILE%\paseo-qa\cache (vscode-win.zip,
# node-win.zip, mingit.zip) and installs the daemon packages and the VSIX. Nothing on the VM
# outside that run directory is modified. Start the daemon and VS Code afterwards through cua-driver
# `launch_app` (see vcua.sh) so they land in the interactive desktop session.
set -euo pipefail

repo=$(cd "$1" && pwd)
run=$2
target=$3
here=$(cd "$(dirname "$0")" && pwd)
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10)
remote_home=$(ssh "${ssh_opts[@]}" "$target" "echo %USERPROFILE%" | tr -d '\r')
# The VM's SSH shell must be cmd; PowerShell would echo %USERPROFILE% unexpanded.
[[ $remote_home == [A-Za-z]:\\* ]] || { echo "unexpected VM home '$remote_home'; the SSH shell must be cmd" >&2; exit 1; }
remote_root="$remote_home\\paseo-qa"
remote_run="$remote_root\\$run"
remote_run_scp="${remote_home//\\//}/paseo-qa/$run"
cache="$remote_root\\cache"

vsix="$repo/packages/vscode/paseo.vsix"
[[ -f $vsix ]] || { echo "missing $vsix; build the extension first" >&2; exit 1; }

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
for pkg in highlight relay protocol client plugin server; do
  # Dists are built beforehand; prepack would rebuild (and the client build nests --workspace).
  (cd "$repo/packages/$pkg" && npm pack --ignore-scripts --silent --pack-destination "$staging" >/dev/null)
done
version=$(node -p "require('$repo/packages/server/package.json').version")
node - "$staging" "$version" <<'JS'
const fs = require("node:fs");
const [dir, version] = process.argv.slice(2);
const deps = {};
for (const name of ["highlight", "relay", "protocol", "client", "plugin", "server"]) {
  deps[`@getpaseo/${name}`] = `file:./getpaseo-${name}-${version}.tgz`;
}
// npm resolves the transitive @getpaseo/* ranges from these local tarballs.
const pkg = { private: true, name: "paseo-vm-qa", type: "module", dependencies: deps, overrides: deps };
fs.writeFileSync(`${dir}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
JS
cp "$vsix" "$staging/paseo.vsix"
cp "$here"/start-daemon.cmd "$here"/run-code.cmd "$here"/seed-agent.mjs "$staging/"
sed -i 's/\r\?$/\r/' "$staging"/*.cmd

ssh "${ssh_opts[@]}" "$target" "if not exist $remote_run\\daemon mkdir $remote_run\\daemon"
scp -q "${ssh_opts[@]}" "$staging"/*.tgz "$staging/package.json" "$target:$remote_run_scp/daemon/"
scp -q "${ssh_opts[@]}" "$staging/seed-agent.mjs" "$target:$remote_run_scp/daemon/"
scp -q "${ssh_opts[@]}" "$staging/paseo.vsix" "$staging"/*.cmd "$target:$remote_run_scp/"

scp -q "${ssh_opts[@]}" "$here/vm-setup.ps1" "$target:$remote_run_scp/vm-setup.ps1"
ssh "${ssh_opts[@]}" "$target" "powershell -NoProfile -ExecutionPolicy Bypass -File $remote_run\\vm-setup.ps1 -RunDir $remote_run -CacheDir $cache"
echo "staged $run at $remote_run (paseo $version)"
