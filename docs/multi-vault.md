# AccordKit Multi-Vault

This document describes the multi-vault behavior implemented on the current
branch.

## Current Scope

AccordKit supports multiple explicit vaults on one server process.

- Documents are isolated by vault.
- Invite redemption is vault-scoped.
- A single identity can belong to multiple vaults.
- The CLI watcher and Obsidian plugin both sync against one selected vault at a
  time.
- There is no implicit `default` vault.

The same relative document path can exist in multiple vaults without collision.

## Auth Modes

The server currently supports three auth modes in
`packages/server/src/config.ts`:

- `open`
- `key`
- `jwt`

### `open`

Development mode.

- No application-level key is required.
- Clients still connect to explicit vault URLs such as
  `ws://host:1234/vaults/team-notes?user=Alice`.
- The server synthesizes a user identity from the `user` query param or falls
  back to `anon`.

### `key`

This is the implemented onboarding flow.

- There is no bootstrap admin key.
- There is no server-wide admin role.
- The first user creates a vault directly from the client.
- Clients authenticate with `accord_sk_...` keys.
- New devices join vaults through invite redemption.
- Redeeming an invite with an existing bearer key adds vault access to the
  existing identity instead of creating a new identity.

This logic lives in:

- `packages/server/src/routes.ts`
- `packages/server/src/auth/key.ts`
- `packages/server/src/auth/key-store.ts`

`key` mode currently requires SQLite storage because the identity and invite
store is SQLite-backed in `packages/server/src/server.ts`.

### `jwt`

JWT mode exists and enforces vault membership from token claims.

- WebSocket auth works.
- `GET /vaults` works.
- `GET /vaults/:vaultId/documents` works.

JWT mode does not expose the invite/identity onboarding flow. Those REST
endpoints are only mounted in `key` mode.

## Connection Model

Watcher and plugin clients sync through vault-scoped WebSocket URLs.

- The watcher builds URLs like `/vaults/<vaultId>?user=<name>` in
  `packages/cli/src/watcher.ts`.
- The plugin passes the selected `vaultId` into the watcher in
  `packages/obsidian-plugin/src/main.ts`.

The server stores `vaultId` in connection context during authentication in
`packages/server/src/auth/index.ts`.

## Document Storage Model

Documents are stored per vault through the storage driver abstraction in
`packages/server/src/storage/index.ts`.

Current backends:

- SQLite
- Postgres

Each storage operation is keyed by:

- `vaultId`
- `documentId`

The client encodes document names with vault context using core helpers, and
the server decodes them when needed.

This gives isolation for:

- document contents
- document listings
- deletion metadata

## Current REST Surface

### Routes active in all server modes

- `GET /vaults`
- `GET /vaults/<vaultId>/documents`

### Routes active in `key` mode

- `POST /auth/redeem`
- `GET /auth/whoami`
- `POST /vaults`
- `POST /vaults/<vaultId>/invites`
- `GET /vaults/<vaultId>/invites`
- `DELETE /vaults/<vaultId>/invites/<code>`
- `GET /vaults/<vaultId>/members`

## Invite Model

Invites are vault-scoped, not server-scoped.

The flow is:

1. A member with access to a vault creates an invite for that vault.
2. Another device redeems the invite.
3. If the device has no identity yet, a new identity and key are created.
4. If the device already has a key, the vault is added to that existing
   identity.

The bundled join-token format is:

```text
accord://<host>[:<port>]/<vaultId>?invite=<code>[&tls=0]
```

Relevant code:

- `packages/core/src/join-token.ts`
- `packages/cli/src/commands/join.ts`
- `packages/server/src/routes.ts`

## CLI Behavior

### `accord watch`

`accord watch` is vault-scoped.

It resolves the vault in this order:

1. `--vault`
2. saved client-local `activeVaultId`
3. otherwise error

Example:

```bash
accord watch ./notes --server ws://localhost:1234 --vault <vault-id>
```

### Vault management commands

Vault management commands accept either a vault name or a vault ID and resolve
names through `whoami`.

### Login and join behavior

`accord auth login` supports both:

- vault invite codes: `accord_inv_...`
- direct keys: `accord_sk_...`

`accord join` accepts the bundled `accord://...` format and optionally
scaffolds an Obsidian vault.

## Obsidian Plugin Behavior

The plugin stores:

- `serverUrl`
- `apiKey`
- `vaultId`
- `userName`

When it has no `vaultId`, it stays in an unconfigured onboarding state. The
settings UI offers:

- **Create a new vault**
- **Join with an invite**

The watcher does not start until both `serverUrl` and `vaultId` are configured.

Once configured, the plugin also exposes invite generation and listing in the
settings tab.

## Current Limits

These items are not implemented as part of the current branch:

- Redis clustering
- binary REST endpoints
- a Postgres-backed identity/invite store for `auth.mode=key`
- vault-level roles such as owner/admin/member
- member-removal APIs

Postgres exists today as a document storage backend, but the invite/identity
flow is still SQLite-backed and tied to `key` mode.

## Summary

The current multi-vault implementation is centered on:

- explicit vault-scoped document storage
- explicit vault-scoped invite redemption
- one identity gaining access to many vaults
- watcher/plugin clients syncing one selected vault at a time
- no special `default` vault and no server-wide admin role
