# @accord-kit/server

WebSocket sync server for AccordKit, built on [Hocuspocus](https://hocuspocus.dev) with SQLite persistence.

Clients (the Obsidian plugin and `accord watch`) connect over WebSocket. Text files are synced via [Yjs](https://yjs.dev) CRDTs — concurrent edits merge deterministically with no conflicts.

## Install

```bash
npm install -g @accord-kit/server
```

## Start

```bash
accord-server
```

Binds to `ws://127.0.0.1:1234` by default and stores documents in `./data.db`.

## Options

```
Options:
  -p, --port <number>    Port to listen on  (default: 1234)
  -a, --address <addr>   Address to bind   (default: 127.0.0.1)
  --db <path>            SQLite database path  (default: ./data.db)
  --binary-dir <path>    Directory for binary file storage  (default: ./binary)
  -v, --verbose          Log every connect, disconnect, and document change
  -q, --quiet            Suppress all non-error output
  -c, --config <file>    Path to YAML or JSON config file
```

## Configuration file

Create `accord-server.yaml` (or `.json`) next to the database:

```yaml
address: 127.0.0.1
port: 1234
persistence:
  path: ./data.db
binary:
  storageDir: ./binary
quiet: false
verbose: false
```

Environment variables override file values:

| Variable | Field |
|---|---|
| `ACCORD_ADDRESS` | `address` |
| `ACCORD_PORT` | `port` |
| `ACCORD_DB_PATH` | `persistence.path` |
| `ACCORD_BINARY_DIR` | `binary.storageDir` |

## Networking & security

AccordKit v1 has **no application-level authentication**. The server binds to `127.0.0.1` by default and should not be exposed to the public internet.

For remote access, use [Tailscale](https://tailscale.com):

1. Install Tailscale on the server and each client device.
2. Bind the server to its Tailscale IP (or `0.0.0.0` with firewall rules).
3. Connect clients to `ws://<tailscale-ip>:1234`.
4. Use Tailscale ACLs to restrict access.

## Programmatic use

```typescript
import { createAccordServer } from '@accord-kit/server'

const server = createAccordServer({
  address: '127.0.0.1',
  port: 1234,
  persistence: { path: './data.db' },
  binary: { storageDir: './binary' },
  quiet: false,
  verbose: false,
})

await server.listen()
```

## License

MIT
