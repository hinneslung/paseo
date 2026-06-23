# Paseo for VS Code (Unofficial)

> **Unofficial, third-party, community-built extension.** Not affiliated with or
> endorsed by Paseo. Use at your own discretion.

Chat with and manage your local AI coding agents — **Claude Code, Codex, GitHub
Copilot, OpenCode, and Pi** — without leaving VS Code. The extension embeds the
Paseo app in a side panel and connects to the Paseo daemon running on your
machine.

## Features

- **Auto-opens your workspace.** Opens the Paseo workspace that matches the
  folder you have open in VS Code — including the exact **git worktree** when you
  open a worktree directory.
- **Drag files to mention them.** Drag a file from the Explorer or your OS file
  manager into the chat. **Hold Shift while dropping** to insert it as an
  `@`-mention instead of attaching or opening it.
- **Full agent chat & management** — start agents, follow their turns, review and
  reply, all inside the editor.

## Requirements

- A running **Paseo daemon** on your machine (or reachable over your LAN). The
  extension discovers it from `~/.paseo/config.json`, or set `paseo.endpoint`
  (e.g. `127.0.0.1:6768`).
- Socket/pipe daemon targets are not supported in VS Code v1 — use a **TCP**
  endpoint.
- For **Remote SSH / WSL**, install the extension on the remote host so it can
  reach the daemon and `~/.paseo` state there.

## Commands

- **Paseo: Open** — open the Paseo panel.
- **Paseo: Set Daemon Password** / **Paseo: Clear Daemon Password**.

## Install

From the Marketplace: search **"Paseo (Unofficial)"** or install `hinnes.paseo`.

Or sideload from source:

```bash
npm run build:vscode
code --install-extension packages/vscode/paseo.vsix
```

See
[docs/vscode-extension.md](https://github.com/hinneslung/paseo/blob/vscode-extension/docs/vscode-extension.md)
for full setup, daemon discovery, the security model, and known limitations.

## License

AGPL-3.0-or-later — follows the Paseo repository.
