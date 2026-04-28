# AccordKit Multi-Vault

This document describes the multi-vault behavior that exists on the current branch. It is not the older JWT/Postgres rollout plan.

## Current Scope

AccordKit now supports multiple vaults on one server process.

- Documents are isolated by vault.
- Invite redemption is vault-scoped.
- A single identity can belong to multiple vaults.
- The CLI watcher and Obsidian plugin both sync against a specific vault.

The same relative document path can exist in multiple vaults without collision.

## Auth Modes

The server currently supports three auth modes in `packages/server/src/config.ts`:

- `open`
- `key`
- `jwt`

### `open`

Development mode.

- No application-level key is required.
- Clients connect to vault-scoped URLs such as `ws://host:1234/vaults/default?user=Alice`.
- The server synthesizes a user identity from the `user` query param or falls back to `anon`.

### `key`

This is the implemented multi-vault onboarding flow.

- `accord-server init` bootstraps the SQLite DB, creates the `default` vault, and prints an admin key.
- Clients authenticate with `accord_sk_...` keys.
- New devices join vaults through invite redemption.
- Redeeming an invite with an existing bearer key adds vault access to that existing identity instead of creating a new identity.

This logic lives in:

- `packages/server/src/bin/init.ts`
- `packages/server/src/routes.ts`
- `packages/server/src/auth/key.ts`

`key` mode currently requires SQLite storage, because the identity and invite store is SQLite-backed in `packages/server/src/server.ts`.

### `jwt`

JWT mode exists and enforces vault membership from token claims.

- WebSocket auth works.
- `GET /vaults` works.
- `GET /vaults/:vaultId/documents` works.

JWT mode does not currently expose the invite/identity management flow. Those REST endpoints are only mounted in `key` mode.

## Connection Model

Watcher and plugin clients sync through vault-scoped WebSocket URLs.

- The watcher builds URLs like `/vaults/<vaultId>?user=<name>` in `packages/cli/src/watcher.ts`.
- The plugin passes the selected `vaultId` into the watcher in `packages/obsidian-plugin/src/main.ts`.

The server stores `vaultId` in connection context during authentication in `packages/server/src/auth/index.ts`.

## Document Storage Model

Documents are stored per vault through the storage driver abstraction in `packages/server/src/storage/index.ts`.

Current backends:

- SQLite
- Postgres

Each storage operation is keyed by:

- `vaultId`
- `documentId`

The client encodes document names with vault context using core helpers, and the server decodes them when needed.

This gives isolation for:

- document contents
- document listings
- deletion metadata

## Current REST Surface

### Routes active in all server modes

- `GET /vaults`
- `GET /vaults/<vaultId>/documents`

See `packages/server/src/routes.ts`.

### Routes active in `key` mode

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

These are implemented in `packages/server/src/routes.ts`.

## Invite Model

Invites are vault-scoped, not server-scoped.

The flow is:

1. A member with access to a vault creates an invite for that vault.
2. Another device redeems the invite.
3. If the device has no identity yet, a new identity and key are created.
4. If the device already has a key, the vault is added to that existing identity.

Relevant client/server code:

- `packages/cli/src/api.ts`
- `packages/cli/src/commands/token.ts`
- `packages/server/src/routes.ts`

## CLI Behavior

### `accord watch`

`accord watch` is vault-scoped and should be pointed at the vault ID you want to sync.

Example:

```bash
accord watch ./notes --server ws://localhost:1234 --vault <vault-id>
```

See `packages/cli/src/cli.ts`.

### Vault management commands

Vault management commands accept either a vault name or a vault ID and resolve names through `whoami`.

See `packages/cli/src/commands/vault.ts`.

### Login behavior

`accord auth login` supports both:

- vault invite codes: `accord_inv_...`
- direct admin keys: `accord_sk_...`

See `packages/cli/src/commands/auth.ts`.

## Obsidian Plugin Behavior

The plugin currently uses:

- `serverUrl`
- `apiKey`
- `vaultId`
- `userName`

See `packages/obsidian-plugin/src/main.ts`.

It also supports redeeming vault invites directly from settings:

- If there is no existing key, the redeemed key is saved.
- If there is an existing key, the redeem request includes it as a bearer token so the new vault is attached to the current identity.
- After redeem, the plugin switches its saved `vaultId` to the invited vault automatically.

See `packages/obsidian-plugin/src/main.ts`.

## Current Limits

These items are not fully implemented as part of the current branch:

- the older Redis clustering plan
- `accord-server migrate`
- binary REST endpoints
- admin vault-create/delete endpoints outside the key-mode identity API
- a Postgres-backed identity/invite store for `auth.mode=key`

Postgres exists today as a document storage backend, but the invite/identity flow is still SQLite-backed and tied to `key` mode.

## Summary

The current multi-vault implementation is centered on:

- vault-scoped document storage
- vault-scoped invite redemption
- one identity gaining access to many vaults
- watcher/plugin clients syncing one selected vault at a time

If a future JWT/Postgres/Redis rollout plan is needed again, it should live in a separate design doc so it does not get confused with the implemented behavior.
