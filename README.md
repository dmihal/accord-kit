# AccordKit

Real-time document synchronization between humans and AI agents, powered by
[Yjs](https://yjs.dev) CRDTs and [Hocuspocus](https://hocuspocus.dev).

An AI agent writes files to a local directory; a human edits the same
documents in [Obsidian](https://obsidian.md). Both see each other's changes in
real time, with CRDT-based merging so neither side loses work.

## Architecture

```text
┌─────────────────┐        WebSocket        ┌──────────────────────┐
│  Obsidian Plugin│◄──────────────────────►│                      │
└─────────────────┘                         │   AccordKit Server   │
                                            │   (Hocuspocus)       │
┌─────────────────┐        WebSocket        │                      │
│   CLI Watcher   │◄──────────────────────►│  Storage:            │
│  (AI agent FS)  │                         │  SQLite / Postgres   │
└─────────────────┘                         └──────────────────────┘
```

All clients connect over WebSocket. Text files are synced via Yjs CRDTs with
character-level merging. Concurrent edits from multiple clients merge
deterministically.

## Packages

| Package | Description |
|---|---|
| [`@accord-kit/server`](packages/server) | Sync server with explicit vaults and pluggable auth modes |
| [`@accord-kit/cli`](packages/cli) | CLI watcher plus auth, vault, invite, join, and Obsidian install commands |
| [`@accord-kit/core`](packages/core) | Shared utilities for paths, tokens, ignore patterns, and vault helpers |

## Quick Start

### 1. Start the server for local development

```bash
npm install -g @accord-kit/server
accord-server
```

This starts the server on `ws://127.0.0.1:1234` with `auth.mode: open`.

### 2. Create a vault

For local dev in `open` mode, first create a vault once:

```bash
npm install -g @accord-kit/cli
accord vault create my-notes --server ws://localhost:1234 --user "David's laptop"
```

This creates your first identity and vault and writes local credentials.

### 3. Install the Obsidian plugin

```bash
accord install-plugin /path/to/your/vault
```

Then either:

- configure the plugin manually with `serverUrl`, `apiKey`, and `vaultId`, or
- use `accord join <token> /path/to/your/vault` on a fresh/empty folder to
  scaffold an Obsidian vault that is already preconfigured.

### 4. Watch a directory

```bash
accord watch ./my-notes --server ws://localhost:1234 --vault <vault-id>
```

If you already created or joined a vault through the CLI, `accord watch` can
reuse the saved local `activeVaultId`, so `--vault` becomes optional.

Files written to `./my-notes` sync to the server and appear in Obsidian
instantly. Files edited in Obsidian appear on disk just as fast.

## Key-Based Auth And Vaults

For shared or remote deployments, run the server in `auth.mode: key`.

Create `accord-server.yaml`:

```yaml
address: 127.0.0.1
port: 1234
auth:
  mode: key
  jwt:
    publicKeys: []
storage:
  driver: sqlite
  sqlite:
    path: ./data.db
  postgres:
    url: ''
    poolSize: 10
```

Then start the server:

```bash
accord-server start --config accord-server.yaml
```

### First user / first vault

There is no server bootstrap admin key and no implicit `default` vault.

The first user creates a vault directly from the client:

```bash
accord vault create team-notes --server ws://localhost:1234 --user "David's laptop"
```

That request:

- creates a new identity
- generates a normal `accord_sk_...` key
- creates a new vault
- grants that identity access
- saves the credentials locally

### Invite another device or user

On an existing member device:

```bash
accord vault invite team-notes
```

This prints both:

- a shareable `accord://...` join token
- the raw `accord_inv_...` code

On the new client:

```bash
accord join 'accord://host:1234/<vaultId>?invite=accord_inv_...&tls=0'
```

Or, if you want to scaffold an Obsidian vault at the same time:

```bash
accord join 'accord://host:1234/<vaultId>?invite=accord_inv_...&tls=0' /path/to/vault
```

If a client already has credentials and you only want to add another vault to
the same identity, you can also use:

```bash
accord token redeem accord_inv_...
```

## Auth Modes

AccordKit currently supports:

- `auth.mode: open` for local loopback development
- `auth.mode: key` for invite-based access control and vault-scoped identities
- `auth.mode: jwt` for operator-managed bearer-token auth

`key` mode is the current onboarding flow. JWT mode supports sync and
vault-scoped document listing, but not the invite/identity management API.

## CLI Overview

- `accord watch <dir>` syncs a local directory into one vault
- `accord auth login|status|logout` manages local credentials
- `accord vault create|list|invite|invites|members` manages vault access
- `accord join <token> [path]` redeems a bundled invite token
- `accord token redeem <code>` redeems a raw invite code
- `accord install-plugin <vault>` installs the Obsidian plugin into an existing
  Obsidian vault

## Default Ignore Patterns

Both the CLI and Obsidian plugin ignore these paths by default:

```text
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

Extend via `--ignore` in the CLI or the ignored-folders field in the plugin.

## Deletion Behavior

By default, deleted files are moved to a local `.accord-trash/` directory
rather than permanently removed. Each client trashes its own copy; trash
contents are never synced. Pass `--delete` to the CLI watcher or set deletion
behavior to `Delete permanently` in the Obsidian plugin for hard deletes.

## Networking & Security

For remote access, the recommended setup is
[Tailscale](https://tailscale.com):

1. Install Tailscale on the server and each client device.
2. Bind the server to its Tailscale IP, or to `0.0.0.0` with firewall rules.
3. Connect clients to `ws://<tailscale-ip>:1234` or `wss://...` behind TLS.
4. Use Tailscale ACLs or equivalent network controls to restrict access.

## Development

```bash
pnpm install
pnpm build

pnpm test:unit
pnpm test:integration
pnpm typecheck
```

## License

MIT
