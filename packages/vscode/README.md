# Paseo for VS Code (Unofficial)

> **Unofficial, third-party, community-built extension.**
> Use at your own discretion.

This extension is designed to work with [Paseo](https://paseo.sh), an open-sourced desktop & mobile app for working with and managing AI coding agents - **Claude Code, Codex, GitHub Copilot, OpenCode, Pi, and more**.

It embeds the Paseo UI in a VS Code tab or side panel and connects to the Paseo daemon running on your machine. [Paseo daemon to be installed separately](https://paseo.sh/download).

## Features

- **Open chat files in VS Code.** Click linked files in chat to open
  them in the editor, including line navigation when available.
- **Drag files to mention them.** Drag a file from the Explorer or your OS file
  manager into the chat. **Hold Shift while dropping** to insert it as an
  `@`-mention.
- **Auto-opens your workspace and host.** Automatically opens the Paseo workspace
  that matches the current VS Code window - including the exact **git worktree**
  when you open a worktree directory.
- **Works with WSL and remote SSH.** When the VS Code window is connected to WSL
  or a remote SSH host, it connects the Paseo daemon running on the connected host.

## Requirements

- A separate **Paseo daemon** installation is required. Download Paseo from the
  [official download page](https://paseo.sh/download), then run the daemon on
  your machine or on a host your VS Code is connecting to. The extension discovers
  it from `~/.paseo/config.json`, or set `paseo.endpoint` (e.g. `127.0.0.1:6767`).
- For **Remote SSH / WSL**, install the extension and run the Paseo daemon on the
  remote host.
- The extension currently connects only to TCP daemon endpoints such as
  `127.0.0.1:6767`.

## Commands

- **Paseo: Open** - open the Paseo panel.
- **Paseo: Set Daemon Password** / **Paseo: Clear Daemon Password**.

## Development

See
[docs/vscode-extension.md](https://github.com/hinneslung/paseo/blob/vscode-extension/docs/vscode-extension.md)
for full setup, daemon discovery, the security model, and known limitations.

## License

AGPL-3.0 - follows the upstream [Paseo](https://github.com/getpaseo/paseo) repository.
