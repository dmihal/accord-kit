# AccordKit — Identity & Access

## Motivation

The multi-vault plan (`docs/multi-vault.md`) introduced per-connection auth via JWTs signed by an operator-managed key, with a custom `vaults` claim. That works, but it leaves three operational gaps:

1. **No way to issue tokens.** Operators must mint JWTs out of band — there is no command, endpoint, or workflow for it.
2. **No identity story for humans.** Every client (CLI, Obsidian plugin) wants a token; today the operator hand-crafts one per device.
3. **No identity story for agents.** Agents are first-class users of Accord — they run `accord watch` against shared vaults — but they cannot do interactive auth flows.

We want a model where humans and agents are the same kind of citizen — both hold a long-lived credential — and where invites, not signups, are the bootstrapping primitive. No external identity provider, no web app, no email/password.

This is intentionally scoped for small, trusted teams. A future iteration can layer Clerk (or any IdP) on top by replacing the bootstrap path; the vault authorization layer designed here doesn't need to change.

---

## Goals & Non-Goals

**Goals**

- A single CLI bootstrap path for both humans and agents: redeem an invite, get a key, watch.
- One key per device with a human-readable name. The same key can hold access to many vaults.
- Vault owners can issue invites, list members, and revoke access — all from the CLI.
- The server is the source of truth for identity ↔ vault mappings. Clients hold only an opaque key.
- The bootstrap step (`accord-server init`) is a single command that produces the first key and the `default` vault.

**Non-Goals**

- Email-based signup, password authentication, MFA, account recovery flows.
- Web-app login. Everything is CLI-driven for v1; a web app can come later without changing the protocol.
- External identity providers (Clerk, Auth0, OIDC). Designed-out of v1, designed-in as a future replacement of the bootstrap path.
- Per-document ACLs within a vault. Same as the multi-vault plan: vault membership grants full access.
- Org/team grouping. Identities and vaults are flat; groups can be added later.

---

## Model

### Concepts

- **Identity** — a named principal, server-side row. Created when an invite is redeemed. Has exactly one active key at a time. Examples: "David's laptop", "release-bot agent".
- **Key** — the long-lived credential held by a client. Stored locally as plaintext, stored server-side as a hash. The client identifies itself by presenting the key on every connection. Format: `accord_sk_<32 random bytes base64url>`.
- **Vault access** — a row mapping `(identity_id, vault_id)`. An identity can have access to many vaults; a vault can have many identities.
- **Invite code** — a single-use, vault-scoped string. Format: `accord_inv_<24 random bytes base64url>`. Created by a member of the vault, redeemed by anyone with the code.

There is no distinction in the data model between human identities and agent identities — only the name differs. The CLI does not care which one a key belongs to.

### Bootstrap

The first identity is created by the operator running `accord-server init` on the server host. That command:

1. Initializes the database schema.
2. Creates the `default` vault.
3. Generates the first identity ("admin" or whatever `--name` specifies) and prints its key once.
4. Grants that identity access to `default`.

After that, every subsequent identity comes from an invite-redeem cycle. There is no other way to create an identity.

### Invite-redeem flow

```
Alice (existing member of vault foo)
   │
   │ accord vault invite foo
   │  → server: insert invite_codes(code, vault_id=foo, created_by=alice)
   │  ← code: accord_inv_xxxxx
   │
   ▼
Bob (new device, no key yet)
   │
   │ accord token redeem accord_inv_xxxxx --name "Bob's laptop"
   │  → no local key found
   │  → POST /auth/redeem { code, name }
   │     server: verify code unredeemed, create identity, create key,
   │             grant identity → vault foo, mark code redeemed
   │  ← key: accord_sk_yyyyy
   │  → write ~/.config/accord/credentials.json
   │
   ▼
Bob can now run: accord watch ./folder --vault foo
```

If Bob already has a local key when he runs `redeem`, the server adds vault access to his existing identity instead of creating a new one. This is how a single device picks up access to additional vaults.

### Re-registration

If a key exists locally but the server has no record of it (DB wiped, server moved), the CLI re-registers automatically: it treats the situation like a fresh redeem. The user is prompted for a new invite code (and a name, if not stored in the credentials file). The old local key file is overwritten.

---

## Schema

```sql
-- One row per device/agent. Keys hash to this row.
CREATE TABLE identities (
  id          text        PRIMARY KEY,        -- ulid
  name        text        NOT NULL,
  key_hash    text        NOT NULL UNIQUE,    -- sha256 of the raw key
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz                      -- soft delete; revoked keys reject
);

-- Many-to-many: identities ↔ vaults.
CREATE TABLE vault_access (
  identity_id text        NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  vault_id    text        NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  granted_by  text        NOT NULL REFERENCES identities(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, vault_id)
);

-- Single-use vault invitations.
CREATE TABLE invite_codes (
  code         text        PRIMARY KEY,        -- the literal accord_inv_... string
  vault_id     text        NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  created_by   text        NOT NULL REFERENCES identities(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,           -- default: created_at + 7 days
  redeemed_at  timestamptz,
  redeemed_by  text        REFERENCES identities(id)
);
CREATE INDEX invite_codes_vault ON invite_codes (vault_id);
```

Notes:

- `key_hash` is sha256 of the raw key bytes. The server never stores the raw key; the client never sends anything else. Comparison is constant-time.
- `revoked_at` is a soft delete because we want to keep `granted_by` references intact in audit history. Revoked identities fail auth even if the key is presented.
- `vaults` table from the multi-vault plan gains a `created_by text REFERENCES identities(id)` column.
- Invites have a TTL (default 7 days). Single-use enforced by `redeemed_at IS NULL` predicate in the redemption transaction.

---

## Server-side auth flow

Replaces the JWT verifier in `packages/server/src/auth/jwt.ts`. The new mode is `auth.mode: key`.

```typescript
async function authenticate(rawKey: string, vaultId: string): Promise<AuthContext> {
  const hash = sha256(rawKey)
  const identity = await db.query(
    'SELECT id, name, revoked_at FROM identities WHERE key_hash = $1',
    [hash],
  )
  if (!identity || identity.revoked_at) throw new AuthError('invalid key')

  const access = await db.query(
    'SELECT 1 FROM vault_access WHERE identity_id = $1 AND vault_id = $2',
    [identity.id, vaultId],
  )
  if (!access) throw new AuthError('forbidden')

  return {
    identityId: identity.id,
    userName: identity.name,
    vaultId,
  }
}
```

Both the WebSocket `onAuthenticate` and the HTTP route handler call the same function. The key is read from:

- WebSocket: `?token=<key>` query param (kept for compatibility with `HocuspocusProvider`'s `token` field).
- HTTP: `Authorization: Bearer <key>` header.

The DB lookup is one indexed query per connection, which happens once at WebSocket handshake — not per message. No caching layer is needed for v1; if it becomes hot, an in-memory LRU keyed on `key_hash` with a short TTL is the obvious mitigation.

The existing `auth.mode: open` is kept for dev/loopback use. The `auth.mode: jwt` mode and its key-loading config are removed; the migration path is described below.

---

## REST endpoints

New endpoints, all unauthenticated except where noted:

```
POST   /auth/redeem              { code, name } → { key, identityId, vaultId }
POST   /auth/register            { key, name }  → { identityId } [internal: used by re-registration]
GET    /auth/whoami              → { identityId, name, vaults: [...] }   [auth required]
```

Vault-scoped endpoints (auth required, key must have access to the vault):

```
POST   /vaults                            { name } → { vaultId }
POST   /vaults/<vaultId>/invites          { ttlDays? } → { code, expiresAt }
GET    /vaults/<vaultId>/invites          → [{ code, createdBy, expiresAt, redeemedBy }]
DELETE /vaults/<vaultId>/invites/<code>   → 204
GET    /vaults/<vaultId>/members          → [{ identityId, name, grantedBy, grantedAt }]
DELETE /vaults/<vaultId>/members/<id>     → 204    [revokes vault access; does not delete identity]
```

Identity-management endpoints (auth required):

```
GET    /identities                        → [{ id, name, createdAt, vaults: [...] }]   [admin only]
DELETE /identities/<id>                   → 204    [admin only — soft-delete identity, all its access cascades]
```

"Admin only" is enforced by an `is_admin` boolean on the `identities` table set on the bootstrap identity. v1 does not surface admin grants in the CLI; the bootstrap user is the only admin until we add a `accord identity promote` command. This is a known limitation, not a design decision.

---

## CLI

### Credential storage

```
~/.config/accord/credentials.json
```

```json
{
  "serverUrl": "ws://accord.example.com:1234",
  "identityId": "01H...",
  "name": "David's laptop",
  "key": "accord_sk_..."
}
```

File mode `0600`. The CLI looks here first on every command; the `--token` flag and `ACCORD_TOKEN` env var override it (useful for CI and one-off agents that don't want to write to disk). When `--token` is used, no credentials file is created or read.

The credentials file is per-server: the path is `~/.config/accord/credentials/<host>.json` if the user wants to talk to multiple Accord servers from one device. The default `credentials.json` is a symlink/alias for the primary server.

### Commands

```
accord-server init [--name <name>]
  Initialize the database, create the default vault, and create the first
  admin identity. Prints the key once. Idempotent: if already initialized,
  prints the existing default vault info and exits without re-creating keys.

accord auth login <serverUrl> [--name <name>]
  Set the active server URL. Prompts for an invite code if no local key
  exists for this server. Equivalent to running `redeem` against the new
  server.

accord auth status
  Show: server URL, identity name, identity ID, accessible vaults.
  Useful for "am I logged in?" and as a connectivity check.

accord auth logout
  Delete the local credentials file. Does not revoke the key on the server
  (use `accord token revoke` for that).

accord vault create <name>
  Create a vault. The current identity is granted access automatically.

accord vault list
  List vaults the current identity has access to.

accord vault invite <vault> [--ttl <days>]
  Generate a single-use invite code for the vault. Prints the code.

accord vault invites <vault>
  List outstanding invites for the vault.

accord vault members <vault>
  List identities with access to the vault.

accord vault revoke <vault> <identityId>
  Revoke an identity's access to a vault. The identity itself remains.

accord token redeem <code> [--name <name>]
  Redeem an invite code. If no local key exists, creates a new identity
  with --name (prompts if omitted) and saves the new key. If a local key
  exists, just adds vault access to that identity.

accord token revoke <identityId>
  Soft-delete an identity. All its vault access goes with it. Admin only.

accord watch <dir> [--vault <vault>] [--token <key>]
  Existing command. Reads from credentials file unless --token is given.
  --vault defaults to "default".
```

### Interactive prompts

The CLI uses `@inquirer/prompts` (already a small dep) for the two interactive cases:

- Name prompt during `redeem` when `--name` is not provided.
- Confirmation prompts for destructive operations (`logout`, `vault revoke`, `token revoke`) unless `--yes` is given.

No other interactivity. Every command must be runnable headless via flags + env vars for agent use.

---

## Migration from JWT mode

Today the server has `auth.mode: jwt` with operator-managed signing keys. The new model replaces it. The transition:

1. **Add `auth.mode: key` alongside the existing modes.** Land the new schema and endpoints. JWT mode keeps working untouched. Existing deployments are unaffected.
2. **Provide a one-shot importer (`accord-server import-jwt`).** For operators who minted JWTs by hand, this command takes a JWT and inserts an identity with the JWT's `sub` as the name and a freshly generated key (printed once). The user replaces their JWT with the new key in their credentials file. Optional — most operators will just `accord vault invite` instead.
3. **Delete `auth.mode: jwt` and the public-key loading code.** Schedule for the release after `key` mode ships and is in use.

The dev-mode `auth.mode: open` behavior is kept exactly as it is, including the loopback-bind warning. It is the developer's zero-config first run; nothing about it changes.

---

## File-by-file diff

```
packages/server/
  src/
    auth/
      key.ts                NEW: KeyVerifier — sha256, lookup, vault check
      key-store.ts          NEW: identity / invite / access DB operations
      open.ts               unchanged
      jwt.ts                deprecated; removed in cleanup phase
      index.ts              dispatch on auth.mode = 'key' | 'open' | 'jwt'(deprecated)
    routes.ts               new endpoints: /auth/*, /vaults POST, /vaults/:id/invites,
                            /vaults/:id/members, /identities
    storage/
      schema/
        002_identity.sql           NEW: identities, vault_access, invite_codes
        002_identity.sqlite.sql    NEW
    bin/
      init.ts               NEW: `accord-server init`
      import-jwt.ts         NEW: legacy import command
    config.ts               add auth.mode = 'key', deprecate 'jwt'

packages/cli/
  src/
    cli.ts                  add auth, vault, token command groups
    credentials.ts          NEW: load/save ~/.config/accord/credentials.json
    commands/
      auth.ts               NEW: login, status, logout
      vault.ts              NEW: create, list, invite, invites, members, revoke
      token.ts              NEW: redeem, revoke
    api.ts                  NEW: thin REST client for the new endpoints

packages/obsidian-plugin/
  src/main.ts               settings UI: replace "JWT token" with "key"; add
                            an "Import invite code" button that calls /auth/redeem

tests/integration/
  identity.test.ts          NEW
  helpers/
    auth.ts                 replace mintToken with createIdentity helper
    server.ts               accept key-mode default; pre-create identities/vaults
```

---

## Testing

### Unit tests

**`packages/server/src/__tests__/auth/key.test.ts`**

```typescript
it('rejects unknown keys')
it('rejects revoked identities')
it('rejects keys without access to the requested vault')
it('accepts valid keys and surfaces identity name as userName')
it('hash comparison is constant-time') // assertion via implementation, not timing
```

**`packages/server/src/__tests__/auth/key-store.test.ts`**

```typescript
it('creates an identity and grants vault access atomically on redeem')
it('refuses to redeem an already-redeemed code')
it('refuses to redeem an expired code')
it('adds vault access to an existing identity when key is presented at redeem')
it('cascades vault_access deletion when an identity is revoked')
```

### Integration tests

**`tests/integration/identity.test.ts`**

| Test | Description |
|---|---|
| **bootstrap creates default vault and admin** | `accord-server init` produces a key; that key has access to `default`; `whoami` returns the configured name |
| **invite + redeem creates new identity** | Admin invites; second client redeems; second identity exists with vault access |
| **redeem with existing key adds access** | Redeem invite from a device that already holds a key; assert no new identity, only new `vault_access` row |
| **redeem expired code fails** | Issue invite, fast-forward time past TTL, redeem fails with clear error |
| **redeem same code twice fails** | First redeem succeeds, second fails |
| **revoke vault access** | Revoke identity B from vault foo; B's existing watcher disconnects; B can still use vault bar |
| **revoke identity** | Revoke identity B entirely; all watchers disconnect; B's key fails auth on every vault |
| **re-registration after server wipe** | Drop server DB; restart; CLI detects unknown-key and prompts for re-redeem; succeeds with a new code |
| **per-server credentials** | Configure CLI for two servers; assert keys for one don't authenticate against the other |

### CI changes

No new infrastructure beyond what the multi-vault plan already requires (Postgres for the postgres job). The identity schema runs in the same migration as the multi-vault tables.

---

## Sequencing

1. **Schema + key-mode auth.** Land tables, `KeyVerifier`, the dispatch in `auth/index.ts`. Existing JWT mode untouched. No new endpoints yet.
2. **Server endpoints.** `/auth/redeem`, `/auth/whoami`, `/vaults POST`, `/vaults/:id/invites`, `/vaults/:id/members`. Tested via direct HTTP in integration suite.
3. **CLI bootstrap path.** `accord-server init`, `accord token redeem`, `accord auth status`, credentials file. Existing `accord watch` keeps working with `--token` for backward compat.
4. **CLI vault management.** `accord vault create/list/invite/invites/members/revoke`. `accord token revoke`.
5. **Obsidian plugin.** Replace JWT input with key + invite-redeem button.
6. **Cleanup.** Remove `auth.mode: jwt` and the JWT verifier. Document `accord-server import-jwt` as the one-shot migration.

Each step is shippable independently. Steps 1–2 can ship before any CLI work and run alongside JWT mode in production.

---

## Open Questions

1. **Multiple admins.** v1 has exactly one admin (the bootstrap identity). Do we need `accord identity promote <id>` before v1 ships, or after? Leaning after — small teams can hand the bootstrap key around, larger teams will hit this.
2. **Invite TTL default.** 7 days is conservative. Operators with tighter security postures may want shorter; agents being onboarded by another agent may want longer. Keep `--ttl` configurable; default is fine to revisit.
3. **Key rotation.** No CLI surface for "rotate this device's key without re-inviting." A new identity per rotation works but litters the identity list. Consider `accord token rotate` that issues a new key for the same identity in a future iteration.
4. **Anonymous read invites.** Some teams may want share-link semantics: a code that grants vault access without creating a tracked identity. Out of scope for v1; would need a different invite type.
5. **Audit log.** No table for who-did-what (created vault, invited X, revoked Y). Add when we have a concrete operator request; over-eager logging is the kind of thing that ages badly.
6. **Web app handoff.** When a web app lands, it will likely use Clerk or similar for human auth. The mapping is: a Clerk session redeems an invite (or auto-redeems based on email match against a pre-issued invite). The `identities` table grows an optional `clerk_user_id` column. Designed-in but not built.

---

## Out of Scope

- Email/password authentication.
- External identity providers.
- Web-app login UI.
- Per-document permissions.
- Org/team grouping above vaults.
- Audit logging beyond the implicit `granted_by` / `created_by` references.
