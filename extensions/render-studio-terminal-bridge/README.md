# Render Studio Terminal Bridge

Local publisher on the machine running **Cursor or VS Code** — same idea as wrist USB cams (JPEGs on `:8001` from this Mac). Studio at https://render3d.app talks to **this computer**, not the Mini PTY.

Does **not** bind Studio `:8001`. Default listen: `127.0.0.1:8765`.

## Install (Cursor)

```bash
# symlink so Cursor loads it on next launch
mkdir -p "$HOME/.cursor/extensions"
ln -sfn "/Users/sam/Render-Studio/extensions/render-studio-terminal-bridge" \
  "$HOME/.cursor/extensions/render3d.render-studio-terminal-bridge-0.1.0"
```

Reload Cursor (Command Palette → **Developer: Reload Window**). Confirm with **Render Studio: Terminal Bridge Status**.

VS Code: same folder under `~/.vscode/extensions/`.

## Studio discovery

1. Open Robotics → **Terminal · local**.
2. Host defaults to `127.0.0.1:8765` (the browser PC).
3. **Connect** → `GET http://127.0.0.1:8765/health` then `/v1/status`.
4. **Pick root** runs Cursor’s folder dialog.
5. Click a live Cursor terminal to stream into the Studio xterm; **New terminal** calls `createTerminal` in Cursor and `sendText` for input.

Handshake header/query is the local token (`X-Term-Bridge`). It is not a cloud secret.

Proposed API `terminalDataWriteEvent` (`onDidWriteTerminalData`) is enabled in `package.json` so output can stream. If Cursor ignores proposed APIs, you can still send commands; replay of output needs that event.
