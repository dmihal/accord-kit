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
| [`@accord-kit/cli`](packages/cli) | CLI watcher for AI agents and scripts; includes `accord install-plugin` |
| [`@accord-kit/core`](packages/core) | Shared utilities (path normalization, ignore patterns, text diffing) |

## Quick Start

### 1. Start the server

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

AccordKit v1 has **no application-level authentication**. The server binds to `127.0.0.1` by default and should not be exposed to the public internet.

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
