# @accord-kit/server

WebSocket sync server for AccordKit, built on [Hocuspocus](https://hocuspocus.dev) with SQLite persistence.

Clients (the Obsidian plugin and `accord watch`) connect over WebSocket. Text files are synced via [Yjs](https://yjs.dev) CRDTs — concurrent edits merge deterministically with no conflicts.

## Install

```bash
npm install -g @accord-kit/server
```

## Commands

### `accord-server start`

```bash
accord-server
accord-server start
```

Binds to `ws://127.0.0.1:1234` by default and stores documents in `./data.db`.

Options:

```
  -c, --config <path>    Path to a JSON or YAML config file
  --address <address>    Address to bind
  -p, --port <port>      Port to bind
  -v, --verbose          Log every document event
```

### `accord-server init`

Initialize the database, create the `default` vault, and print the first admin key.

```bash
accord-server init
accord-server init --name "David's laptop"
accord-server init --config accord-server.yaml
```

Run this once before switching the server to `auth.mode: key`.

## Configuration file

Create `accord-server.yaml` (or `.json`) next to the database:

```yaml
address: 127.0.0.1
port: 1234
auth:
  mode: open
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

`auth.mode` is configured in the file and supports:

- `open`: no key check; useful for local development and single-user loopback setups
- `key`: require an API key on HTTP requests and WebSocket connections, with vault-scoped access control

## Networking & security

AccordKit defaults to `auth.mode: open`, which is appropriate for local development on loopback only. For shared or remote deployments, initialize the database and switch to `auth.mode: key`.

Example authenticated config:

```yaml
address: 0.0.0.0
port: 1234
auth:
  mode: key
persistence:
  path: ./data.db
binary:
  storageDir: ./binary
```

For remote access, use [Tailscale](https://tailscale.com):

1. Install Tailscale on the server and each client device.
2. Bind the server to its Tailscale IP (or `0.0.0.0` with firewall rules).
3. Connect clients to `ws://<tailscale-ip>:1234`.
4. Use Tailscale ACLs to restrict access.

In key mode, clients authenticate with an invite-redeem flow:

1. Run `accord-server init` and save the printed admin key.
2. Start the server with `auth.mode: key`.
3. Create `~/.config/accord/credentials/<host>-<port>.json` on the admin machine with the printed `identityId`, `name`, and `key`.
4. Use the CLI with that admin credential to create invites, for example `accord vault invite default`.
5. Redeem invites on each client with `accord auth login <serverUrl>` or `accord token redeem <code>`.

## Programmatic use

```typescript
import { createAccordServer } from '@accord-kit/server'

const server = createAccordServer({
  address: '127.0.0.1',
  port: 1234,
  auth: { mode: 'open' },
  persistence: { path: './data.db' },
  binary: { storageDir: './binary' },
  quiet: false,
  verbose: false,
})

await server.listen()
```

## License

MIT
