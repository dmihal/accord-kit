# AccordKit

Real-time document synchronization between humans and AI agents, powered by [YJS](https://yjs.dev) CRDTs and [Hocuspocus](https://hocuspocus.dev).

An AI agent writes files to a local directory on a server; a human edits the same documents in [Obsidian](https://obsidian.md) on their laptop. Both see each other's changes in real time, with CRDT-based merging ensuring neither side loses work.

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

All clients connect to the Hocuspocus server over WebSocket. Text files are synced via YJS CRDTs with character-level merging. Binary files (images, PDFs, etc.) use last-write-wins via a REST API.

## Packages

| Package | npm Name | Description |
|---|---|---|
| [`packages/core`](packages/core) | `@accord-kit/core` | Shared utilities — path normalization, ignore patterns, text diffing, file-type detection, hashing |
| [`packages/server`](packages/server) | `@accord-kit/server` | Hocuspocus-based sync server with SQLite persistence and binary file REST API |
| [`packages/cli`](packages/cli) | `@accord-kit/cli` | File-system watcher that syncs a local directory — designed for AI agents and scripts |
| [`packages/obsidian-plugin`](packages/obsidian-plugin) | `accord-kit-obsidian` | Obsidian community plugin for Google Docs-style collaborative editing |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 9+

### Install & Build

```bash
pnpm install
pnpm build
```

### Start the Server

```bash
cd packages/server
node dist/index.js
```

The server binds to `127.0.0.1:1234` by default. Configure via a YAML config file or environment variables:

```yaml
# accord.config.yaml
address: 127.0.0.1
port: 1234
persistence:
  path: ./data.db
binary:
  storageDir: ./binary
```

### Start the CLI Watcher

```bash
cd packages/cli
node dist/index.js --server ws://localhost:1234 --dir /path/to/watch --name "my-agent"
```

The CLI watches a local directory, syncs file changes to the server, and writes remote changes back to disk. It handles startup reconciliation automatically — pulling new server files and pushing local-only files.

### Obsidian Plugin

Install the `accord-kit-obsidian` plugin in Obsidian and configure:

- **Server URL** — `ws://localhost:1234`
- **User name** — display name for cursor presence
- **Sync scope** — whole vault, specific folders, or exclusion patterns

## How It Works

### Text Files
Text files (Markdown, JSON, YAML, etc.) are synced using YJS's `Y.Text` CRDT. On each file change, the client computes a character-level diff (via `fast-diff`) and applies it as a YJS transaction. Concurrent edits from multiple clients merge deterministically — no conflicts, no manual resolution.

### Binary Files
Binary files bypass YJS entirely and use the server's REST API (`PUT`/`GET /binary/:path`). Sync is last-write-wins based on SHA-256 content hashing to skip unnecessary transfers.

### Deletion
Deleted files are moved to a local `.accord-trash/` directory (preserving the relative path) rather than permanently removed. The deletion event is propagated to all clients, each of which trashes its own copy. Trash contents are local-only and excluded from sync.

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

Extend via the `ignorePatterns` config option using gitignore syntax.

## Development

```bash
# Run all tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests only
pnpm test:integration

# Watch mode
pnpm test:watch

# Type-check all packages
pnpm typecheck
```

## Networking & Security

AccordKit v1 has **no authentication**. The server binds to `127.0.0.1` by default and should not be exposed to the public internet.

For remote access, the recommended setup is [Tailscale](https://tailscale.com):

1. Install Tailscale on the server and each client device.
2. Bind the server to its Tailscale IP (or `0.0.0.0` with firewall rules).
3. Connect clients to `ws://<tailscale-ip>:1234`.
4. Use Tailscale ACLs to restrict access.

## Documentation

- [Product Requirements](docs/product-requirements.md)
- [Technical Design](docs/technical-design.md)
- [Testing Strategy](docs/testing.md)

## License

Private — not yet published.
