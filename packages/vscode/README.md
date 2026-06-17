# Paseo for VS Code

Paseo surfaces agent chat and agent management inside VS Code, connected to the
Paseo daemon running with your workspace.

## Install

Build the sideload package from the repo root:

```bash
npm run build:vscode
```

Install the generated VSIX:

```bash
code --install-extension packages/vscode/paseo.vsix
```

For Remote SSH or WSL, install the extension on the remote host so the workspace
extension host can reach the daemon and `~/.paseo` state there.

See [docs/vscode-extension.md](../../docs/vscode-extension.md) for full setup,
daemon discovery, limitations, and developer notes.
