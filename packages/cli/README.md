# @accord-kit/cli

CLI for AccordKit — watches a local directory and syncs files with an AccordKit server in real time. Also includes the `accord install-plugin` command for distributing the Obsidian plugin.

## Install

```bash
npm install -g @accord-kit/cli
```

## Commands

### `accord watch <dir>`

Watch a directory and sync all text files with an AccordKit server.

```
accord watch <dir> [options]

Options:
  -s, --server <url>        AccordKit server WebSocket URL  (default: ws://localhost:1234)
  -u, --user <name>         Display name shown to other clients  (default: CLI)
  --delete                  Permanently delete files when the remote removes them
                            (default: move to .accord-trash/ instead)
  --ignore <patterns...>    Additional glob patterns to exclude from sync
```

**Example — AI agent writing to a notes directory:**

```bash
accord watch ./my-notes --server ws://localhost:1234 --user my-agent
```

Files created or modified under `./my-notes` sync to the server immediately. Changes from other clients (e.g. Obsidian) appear on disk just as fast.

### `accord install-plugin <vault>`

Copy the bundled Obsidian plugin into an existing vault and enable it.

```bash
accord install-plugin /path/to/your/vault
```

This copies `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/accord-kit/` and adds `accord-kit` to `community-plugins.json`. Restart Obsidian (or reload plugins in Settings) to activate it.

The vault must already exist and contain an `.obsidian/` directory (i.e. Obsidian must have opened it at least once).

## Deletion behavior

By default deleted files are moved to a local `.accord-trash/` directory rather than permanently removed. Pass `--delete` to hard-delete instead. Trash contents are never synced to the server.

## Default ignore patterns

The watcher skips these paths automatically:

```
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

Add extra patterns with `--ignore`.

## License

MIT
