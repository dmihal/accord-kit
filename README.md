# AccordKit

Real-time document synchronization between humans and AI agents, powered by [Yjs](https://yjs.dev) CRDTs and [Hocuspocus](https://hocuspocus.dev).

An AI agent writes files to a local directory; a human edits the same documents in [Obsidian](https://obsidian.md) on their laptop. Both see each other's changes in real time, with CRDT-based merging so neither side loses work.

## Architecture

```
┌─────────────────┐        WebSocket        ┌──────────────────────┐
│  Obsidian Plugin│◄──────────────────────►│                      │
└─────────────────┘                         │   AccordKit Server   │
                                            │   (Hocuspocus)       │
┌─────────────────┐        WebSocket        │                      │
│   CLI Watcher   │◄──────────────────────►│  Persistence:        │
│  (AI agent FS)  │                         │  SQLite              │
└─────────────────┘                         └──────────────────────┘
```

All clients connect to the server over WebSocket. Text files are synced via Yjs CRDTs with character-level merging. Concurrent edits from multiple clients merge deterministically — no conflicts, no manual resolution.

## Packages

| Package | Description |
|---|---|
| [`@accord-kit/server`](packages/server) | Sync server with SQLite persistence |
| [`@accord-kit/cli`](packages/cli) | CLI watcher plus auth, vault, invite, and plugin-install commands |
| [`@accord-kit/core`](packages/core) | Shared utilities (path normalization, ignore patterns, text diffing) |

## Quick Start

### 1. Start the server for local development

```bash
npm install -g @accord-kit/server
accord-server
```

Binds to `ws://127.0.0.1:1234` by default.

### 2. Install the Obsidian plugin

```bash
npm install -g @accord-kit/cli
accord install-plugin /path/to/your/vault
```

Restart Obsidian and enable AccordKit in Settings → Community plugins. Point it at `ws://localhost:1234`.

### 3. Watch a directory (for AI agents / scripts)

```bash
accord watch ./my-notes --server ws://localhost:1234 --user my-agent
```

Files written to `./my-notes` sync to the server and appear in Obsidian instantly. Files edited in Obsidian appear on disk just as fast.

This local flow uses the server default `auth.mode: open`, which is intended for loopback development.

## Key-Based Auth And Vaults

For shared or remote deployments, initialize the server and switch to key auth.

### 1. Initialize the server

```bash
accord-server init --name "David's laptop"
```

This creates the `default` vault and prints the first admin key once.

### 2. Start the server in key mode

Create `accord-server.yaml`:

```yaml
address: 127.0.0.1
port: 1234
auth:
  mode: key
persistence:
  path: ./data.db
binary:
  storageDir: ./binary
```

Then start the server:

```bash
accord-server start --config accord-server.yaml
```

### 3. Bootstrap the first admin client

`accord-server init` prints the first admin identity ID and key. Write those values into the CLI credentials file for the server host and port:

```bash
mkdir -p ~/.config/accord/credentials
```

Create `~/.config/accord/credentials/localhost-1234.json`:

```json
{
  "serverUrl": "ws://localhost:1234",
  "identityId": "01H...",
  "name": "David's laptop",
  "key": "accord_sk_..."
}
```

### 4. Issue an invite and redeem it on another client

From the bootstrap admin machine:

```bash
accord vault invite default
```

On the new client:

```bash
accord auth login ws://localhost:1234
```

`accord auth login` prompts for the invite code if you do not pass `--invite`.

If you already have credentials on that client and only want to add another vault, use:

```bash
accord token redeem accord_inv_...
```

### 5. Watch a specific vault

```bash
accord watch ./my-notes --server ws://localhost:1234 --vault default
```

The CLI also supports `--token <key>` for one-off agent processes that should not read from a local credentials file.

## CLI Overview

The CLI now includes these command groups:

- `accord watch <dir>` for syncing a local directory
- `accord auth login|status|logout` for local credentials
- `accord vault create|list|invite|invites|members|revoke` for vault access management
- `accord token redeem|revoke` for invite redemption and full identity revocation
- `accord install-plugin <vault>` for Obsidian installation

## Default Ignore Patterns

Both the CLI and Obsidian plugin ignore these paths by default:

```
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

Extend via `--ignore` (CLI) or the ignore patterns field (Obsidian settings).

## Deletion Behavior

By default, deleted files are moved to a local `.accord-trash/` directory rather than permanently removed. Each client trashes its own copy; trash contents are never synced. Pass `--delete` to the CLI watcher or set deletion behavior to "Delete permanently" in the Obsidian plugin for hard deletes.

## Networking & Security

AccordKit supports two server modes:

- `auth.mode: open` for local loopback development
- `auth.mode: key` for invite-based access control and vault-scoped authorization

For remote access, the recommended setup is [Tailscale](https://tailscale.com):

1. Install Tailscale on the server and each client device.
2. Bind the server to its Tailscale IP (or `0.0.0.0` with firewall rules).
3. Connect clients to `ws://<tailscale-ip>:1234`.
4. Use Tailscale ACLs to restrict access.

## Development

```bash
pnpm install
pnpm build

pnpm test:unit          # unit tests
pnpm test:integration   # integration tests
pnpm typecheck          # type-check all packages
```

## License

MIT
