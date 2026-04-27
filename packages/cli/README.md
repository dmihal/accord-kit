# @accord-kit/cli

CLI for AccordKit — watches a local directory and syncs files with an AccordKit server in real time. It also manages local credentials, vault access, and Obsidian plugin installation.

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
  -s, --server <url>        AccordKit server WebSocket URL
  -u, --user <name>         Display name shown to other clients
  --vault <vault>           Vault name or ID to sync with  (default: default)
  --token <key>             API key (overrides credentials file)
  --delete                  Permanently delete files when the remote removes them
                            (default: move to .accord-trash/ instead)
  --ignore <patterns...>    Additional glob patterns to exclude from sync
```

**Example — AI agent writing to a notes directory:**

```bash
accord watch ./my-notes --server ws://localhost:1234 --user my-agent
```

Files created or modified under `./my-notes` sync to the server immediately. Changes from other clients (e.g. Obsidian) appear on disk just as fast.

In key-auth mode, log in first with `accord auth login <serverUrl>` or pass `--token` explicitly. If `--server`, `--user`, or `--token` are omitted, the CLI falls back to the local credentials file when available.

### `accord auth`

Manage local credentials for a server.

#### `accord auth login <serverUrl>`

Redeem an invite code and save the returned key for future commands.

```bash
accord auth login ws://localhost:1234
accord auth login ws://localhost:1234 --name "David's laptop" --invite accord_inv_...
```

If valid credentials already exist for that server, the CLI prints the current identity and exits.

#### `accord auth status`

Show the active server, identity, and accessible vaults.

```bash
accord auth status
accord auth status --server ws://localhost:1234
```

#### `accord auth logout`

Delete the local credentials file for a server.

```bash
accord auth logout
accord auth logout --server ws://localhost:1234 --yes
```

This removes local credentials only; it does not revoke the identity on the server.

### `accord vault`

Create vaults, issue invites, and inspect membership.

#### `accord vault create <name>`

Create a vault. The current identity is granted access automatically.

```bash
accord vault create team-notes
```

#### `accord vault list`

List vaults the current identity can access.

```bash
accord vault list
```

#### `accord vault invite <vault>`

Generate a single-use invite code for a vault.

```bash
accord vault invite default
accord vault invite team-notes --ttl 14
```

#### `accord vault invites <vault>`

List outstanding or redeemed invites for a vault.

```bash
accord vault invites default
```

#### `accord vault members <vault>`

List identities with access to a vault.

```bash
accord vault members default
```

#### `accord vault revoke <vault> <identityId>`

Remove an identity from a vault without deleting the identity itself.

```bash
accord vault revoke default 01H... --yes
```

### `accord token`

Redeem invites on an existing device or revoke identities entirely.

#### `accord token redeem <code>`

Redeem a vault invite. If local credentials already exist, the new vault is added to the current identity. Otherwise, a new identity is created and saved locally.

```bash
accord token redeem accord_inv_...
accord token redeem accord_inv_... --server ws://localhost:1234 --name "CI agent"
```

#### `accord token revoke <identityId>`

Admin-only command that revokes an identity completely.

```bash
accord token revoke 01H... --yes
```

### `accord install-plugin <vault>`

Copy the bundled Obsidian plugin into an existing vault and enable it.

```bash
accord install-plugin /path/to/your/vault
```

This copies `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/accord-kit/` and adds `accord-kit` to `community-plugins.json`. Restart Obsidian (or reload plugins in Settings) to activate it.

The vault must already exist and contain an `.obsidian/` directory (i.e. Obsidian must have opened it at least once).

## Credentials

When you log in, the CLI stores credentials under `~/.config/accord/credentials/<host>-<port>.json`. Commands that talk to the identity API read from that file by default. Pass `--token` to override the stored key for a single command.

For the first bootstrap admin created by `accord-server init`, create this file manually using the server URL you will connect to plus the printed `identityId`, `name`, and `key`. Subsequent devices should use invite redemption instead of manual file creation.

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
