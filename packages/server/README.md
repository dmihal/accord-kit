# @accord-kit/server

WebSocket sync server for AccordKit, built on
[Hocuspocus](https://hocuspocus.dev).

The server stores text documents per vault. SQLite is the default storage
backend; Postgres is also supported for document storage. Clients connect over
WebSocket and text files are synced via [Yjs](https://yjs.dev) CRDTs.

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

```text
  -c, --config <path>    Path to a JSON or YAML config file
  --address <address>    Address to bind
  -p, --port <port>      Port to bind
  -v, --verbose          Log every document event
```

There is no `accord-server init`. In `auth.mode: key`, the first identity and
first vault are created by the first unauthenticated `POST /vaults` request
from a client.

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

## Auth Modes

### `open`

Local development mode.

- No application-level key is required.
- Clients still connect to explicit vault URLs such as
  `ws://host:1234/vaults/<vaultId>?user=Alice`.
- The server warns if `auth.mode=open` is bound to a non-loopback address.

### `key`

Invite-based identity and vault access control.

- There is no special `default` vault.
- There is no server-wide admin role.
- Any user can create a vault.
- Any vault member can invite more users into that vault.
- Redeeming an invite with an existing key adds vault access to the existing
  identity instead of creating a new one.

Typical flow:

1. Start the server with `auth.mode: key`.
2. First user creates a vault:

```bash
accord vault create team-notes --server ws://localhost:1234 --user "David's laptop"
```

3. Existing member generates an invite:

```bash
accord vault invite team-notes
```

4. New client joins:

```bash
accord join 'accord://host:1234/<vaultId>?invite=accord_inv_...&tls=0'
```

`key` mode currently requires `storage.driver: sqlite`, because the identity
and invite store is SQLite-backed.

### `jwt`

JWT mode validates bearer tokens and enforces vault membership from the
`vaults` claim. It supports sync, document listing, and `GET /vaults`, but not
the invite/identity onboarding API.

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

- WebSocket clients connect to explicit vault URLs such as
  `ws://host:1234/vaults/<vaultId>?user=<name>`.
- The server stores documents by `(vaultId, documentId)`, so two vaults can
  both contain `notes/today.md` without collision.
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
