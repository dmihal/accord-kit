# @accord-kit/cli

CLI for AccordKit. It watches a local directory and syncs files with an
AccordKit server in real time, and it manages local credentials, vault access,
invite redemption, and Obsidian plugin installation.

## Install

```bash
npm install -g @accord-kit/cli
```

## Commands

### `accord watch <dir>`

Watch a directory and sync all text files with an AccordKit server.

```text
accord watch <dir> [options]

Options:
  -s, --server <url>        AccordKit server WebSocket URL
  -u, --user <name>         Display name shown to other clients
  --vault <vault>           Vault ID to sync with
  --token <key>             API key (overrides credentials file)
  --delete                  Permanently delete files when the remote removes them
                            (default: move to .accord-trash/ instead)
  --ignore <patterns...>    Additional glob patterns to exclude from sync
```

Example:

```bash
accord watch ./my-notes --server ws://localhost:1234 --user my-agent --vault team-notes
```

If local credentials exist for that server and include an `activeVaultId`,
`--vault` can be omitted. If no vault is explicit or saved locally, the command
fails instead of assuming `default`.

### `accord auth`

Manage local credentials for a server.

#### `accord auth login <serverUrl>`

Redeem an invite code or save a direct key for future commands.

```bash
accord auth login ws://localhost:1234
accord auth login ws://localhost:1234 --name "David's laptop" --invite accord_inv_...
accord auth login ws://localhost:1234 --invite accord_sk_...
```

If you pass an `accord_sk_...` key, the CLI treats it as a direct login key and
saves it after verifying `whoami`.

#### `accord auth status`

Show the active server, identity, API key, and accessible vaults.

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

This removes local credentials only; it does not revoke the key on the server.

### `accord vault`

Create vaults, issue invites, and inspect membership.

#### `accord vault create <name> [path]`

Create a vault.

- If local credentials already exist, the new vault is granted to the current
  identity.
- If no credentials exist yet, pass `--server` and `--user` to bootstrap the
  first identity and first vault.
- If `path` is provided, the AccordKit Obsidian plugin is installed into that
  folder and pre-configured with the server URL, API key, and vault ID — so
  opening the folder in Obsidian is all that's needed to start syncing.

```bash
accord vault create team-notes
accord vault create team-notes --server ws://localhost:1234 --user "David's laptop"
accord vault create team-notes ~/Documents/MyVault --server ws://localhost:1234 --user "David's laptop"
```

#### `accord vault list`

List vaults the current identity can access.

```bash
accord vault list
```

#### `accord vault invite <vault>`

Generate a single-use invite for a vault. This accepts either a vault name or
vault ID.

```bash
accord vault invite team-notes
accord vault invite team-notes --ttl 14
```

This prints both:

- an `accord://...` join token
- the raw `accord_inv_...` code

#### `accord vault invites <vault>`

List outstanding or redeemed invites for a vault.

```bash
accord vault invites team-notes
```

#### `accord vault members <vault>`

List identities with access to a vault.

```bash
accord vault members team-notes
```

### `accord join <token> [path]`

Redeem a bundled `accord://...` join token.

```bash
accord join 'accord://host:1234/team-notes?invite=accord_inv_...&tls=0'
accord join 'accord://host:1234/team-notes?invite=accord_inv_...&tls=0' /path/to/vault
```

Without `path`, this just saves credentials locally and sets the local
`activeVaultId`.

With `path`:

- if the folder is missing or empty, the CLI scaffolds an Obsidian vault
- if the folder is already an Obsidian vault, the CLI installs the plugin into
  it
- in both cases, the plugin settings are pre-populated

### `accord token redeem <code>`

Redeem a raw invite code.

If local credentials already exist, the new vault is added to the current
identity and becomes the local `activeVaultId`. Otherwise, a new identity is
created and saved locally.

```bash
accord token redeem accord_inv_...
accord token redeem accord_inv_... --server ws://localhost:1234 --name "CI agent"
```

### `accord install-plugin <vault>`

Copy the bundled Obsidian plugin into an existing Obsidian vault and enable it.

```bash
accord install-plugin /path/to/your/vault
```

This copies `main.js` and `manifest.json` into
`<vault>/.obsidian/plugins/accord-kit/` and adds `accord-kit` to
`community-plugins.json`.

## Credentials

The CLI stores credentials under:

```text
~/.config/accord/credentials/<host>-<port>.json
```

The file includes:

- `serverUrl`
- `identityId`
- `name`
- `key`
- `activeVaultId`

The default `~/.config/accord/credentials.json` alias is also updated so
commands without `--server` can keep working.

## Deletion Behavior

By default, deleted files are moved to a local `.accord-trash/` directory
rather than permanently removed. Pass `--delete` to hard-delete instead. Trash
contents are never synced to the server.

## Default Ignore Patterns

The watcher skips these paths automatically:

```text
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
