# @accord-kit/server

WebSocket sync server for AccordKit, built on [Hocuspocus](https://hocuspocus.dev).

The server stores text documents per vault. SQLite is the default storage backend; Postgres is also supported through the same storage interface. Clients connect over WebSocket and text files are synced via [Yjs](https://yjs.dev) CRDTs.

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

Binds to `ws://127.0.0.1:1234` by default and stores data in `./data.db`.

Options:

```
  -c, --config <path>    Path to a JSON or YAML config file
  --address <address>    Address to bind
  -p, --port <port>      Port to bind
  -v, --verbose          Log every document event
```

### `accord-server init`

Initialize the SQLite database for key-auth mode, create the `default` vault, and print the first admin key.

```bash
accord-server init
accord-server init --name "David's laptop"
accord-server init --config accord-server.yaml
```

`init` currently requires `storage.driver: sqlite`.

## Configuration

Create `accord-server.yaml` (or `.json`) next to the database:

```yaml
address: 127.0.0.1
port: 1234
auth:
  mode: open
  jwt:
    publicKeys: []
storage:
  driver: sqlite
  sqlite:
    path: ./data.db
  postgres:
    url: ''
    poolSize: 10
quiet: false
verbose: false
```

Environment variables override file values:

| Variable | Field |
|---|---|
| `ACCORD_ADDRESS` | `address` |
| `ACCORD_PORT` | `port` |
| `ACCORD_AUTH_MODE` | `auth.mode` |
| `ACCORD_DB_PATH` | `storage.sqlite.path` |
| `ACCORD_STORAGE_DRIVER` | `storage.driver` |
| `ACCORD_PG_URL` | `storage.postgres.url` |
| `ACCORD_PG_POOL_SIZE` | `storage.postgres.poolSize` |
| `ACCORD_JWT_ISSUER` | `auth.jwt.issuer` |
| `ACCORD_JWT_AUDIENCE` | `auth.jwt.audience` |
| `ACCORD_JWT_PUBLIC_KEY_PATH` | `auth.jwt.publicKeys[0].publicKeyPath` |
| `ACCORD_JWT_KID` | `auth.jwt.publicKeys[0].kid` |

`auth.mode` supports:

- `open`: loopback/dev mode. No application-level auth; the server accepts vault URLs and synthesizes an anonymous identity.
- `key`: invite-based identity and vault access control. This is the current multi-vault onboarding flow.
- `jwt`: token-based vault authorization using configured public keys.

## Auth Modes

### `open`

Local development mode. Clients can connect without a key. Vaults are still explicit in the URL path, and the server warns if `auth.mode=open` is bound to a non-loopback address.

### `key`

Invite-based multi-vault mode.

1. Run `accord-server init` once and save the printed admin key.
2. Start the server with `auth.mode: key`.
3. Log in on the admin machine with the printed key:

```bash
accord auth login ws://localhost:1234 --invite accord_sk_...
```

4. Create vault-scoped invites:

```bash
accord vault invite default
accord vault invite team-notes
```

5. Redeem invites on clients:

```bash
accord auth login ws://localhost:1234 --invite accord_inv_...
accord token redeem accord_inv_...
```

If a client already has a key, redeeming another invite adds access to that vault on the same identity instead of creating a new identity.

`key` mode currently requires `storage.driver: sqlite`, because the identity and invite store lives in the same SQLite database.

### `jwt`

JWT mode validates bearer tokens and enforces vault membership from the `vaults` claim. It supports sync, document listing, and `GET /vaults`, but the invite/identity management endpoints are not used in this mode.

Example JWT config:

```yaml
address: 0.0.0.0
port: 1234
auth:
  mode: jwt
  jwt:
    issuer: accord-kit
    audience: accord-kit
    publicKeys:
      - kid: default
        algorithm: ES256
        publicKeyPath: ./jwt.pub.pem
storage:
  driver: postgres
  sqlite:
    path: ./data.db
  postgres:
    url: postgres://accord:secret@localhost:5432/accord
    poolSize: 10
```

## Vault Behavior

- WebSocket clients connect to vault-scoped URLs such as `ws://host:1234/vaults/<vaultId>?user=<name>`.
- The server stores documents by `(vaultId, documentId)`, so two vaults can both contain `notes/today.md` without collision.
- `GET /vaults` lists vault IDs the current caller can access.
- `GET /vaults/<vaultId>/documents` lists text documents for that vault.

In `key` mode the following management endpoints are also active:

- `POST /auth/redeem`
- `GET /auth/whoami`
- `POST /vaults`
- `POST /vaults/<vaultId>/invites`
- `GET /vaults/<vaultId>/invites`
- `DELETE /vaults/<vaultId>/invites/<code>`
- `GET /vaults/<vaultId>/members`
- `DELETE /vaults/<vaultId>/members/<identityId>`
- `GET /identities`
- `DELETE /identities/<identityId>`

## Programmatic Use

```typescript
import { createAccordServer } from '@accord-kit/server'

const server = createAccordServer({
  address: '127.0.0.1',
  port: 1234,
  auth: {
    mode: 'open',
    jwt: {
      publicKeys: [],
    },
  },
  storage: {
    driver: 'sqlite',
    sqlite: {
      path: './data.db',
    },
    postgres: {
      url: '',
      poolSize: 10,
    },
  },
  quiet: false,
  verbose: false,
})

await server.listen()
```

## License

MIT
