# AccordKit — Identity & Access

This document describes the identity and access model implemented in the
current codebase.

## Model

AccordKit has four core concepts:

- **Identity**: a named principal on the server such as `"David's laptop"` or
  `"CI agent"`.
- **Key**: a long-lived credential held by a client. Format:
  `accord_sk_<...>`.
- **Vault access**: a mapping from one identity to one vault.
- **Invite code**: a single-use, vault-scoped token. Format:
  `accord_inv_<...>`.

There is no distinction between “human” and “agent” identities. Both are just
identities holding keys.

There is also:

- no implicit `default` vault
- no bootstrap admin key
- no server-wide admin role

## Bootstrap

The first identity is created by the first unauthenticated vault-creation
request in `auth.mode: key`.

Flow:

1. Start the server in `auth.mode: key`.
2. Run:

```bash
accord vault create team-notes --server ws://localhost:1234 --user "David's laptop"
```

3. The server:
   - creates a new identity
   - generates a new key
   - creates the vault
   - grants the identity access to it
4. The CLI saves the returned credentials locally.

After that, the same identity can create more vaults while authenticated.

## Invite / Redeem Flow

### New device or user

1. Existing vault member runs:

```bash
accord vault invite team-notes
```

2. The CLI prints:
   - a bundled `accord://...` join token
   - the raw `accord_inv_...` code

3. The new device runs:

```bash
accord join 'accord://host:1234/<vaultId>?invite=accord_inv_...&tls=0'
```

4. If the client has no saved key yet, the server creates a new identity and
   key and grants it access to the invited vault.

### Existing identity joining another vault

If the client already has a saved key, redeeming another invite adds vault
access to that existing identity instead of creating a new one.

This works through either:

```bash
accord join 'accord://...'
accord token redeem accord_inv_...
```

## Storage Model

The SQLite-backed key store tracks:

- `identities`
- `vault_access`
- `invite_codes`

The server stores only a hash of the raw key, not the plaintext key itself.

Invites are:

- vault-scoped
- single-use
- TTL-based

## REST Surface

### Routes active in `auth.mode: key`

- `POST /auth/redeem`
- `GET /auth/whoami`
- `POST /vaults`
- `POST /vaults/<vaultId>/invites`
- `GET /vaults/<vaultId>/invites`
- `DELETE /vaults/<vaultId>/invites/<code>`
- `GET /vaults/<vaultId>/members`

`POST /vaults` has two modes:

- **Unauthenticated**: bootstrap first identity + first vault
- **Authenticated**: create another vault for the current identity

`POST /auth/redeem` also has two modes:

- **Without bearer key**: create a new identity and key
- **With bearer key**: attach the invited vault to the existing identity

## CLI Credential Model

The CLI stores per-server credentials under:

```text
~/.config/accord/credentials/<host>-<port>.json
```

The current shape is:

```json
{
  "serverUrl": "ws://accord.example.com:1234",
  "identityId": "01H...",
  "name": "David's laptop",
  "key": "accord_sk_...",
  "activeVaultId": "team-notes"
}
```

`activeVaultId` is client-local convenience state only. It is not a server
default.

## Current Authorization Rules

Implemented today:

- Any authenticated user can create another vault for themselves.
- Any vault member can create invites.
- Any vault member can list invites.
- Any vault member can list members.

Not implemented today:

- server-wide admin privileges
- per-vault roles
- member-removal APIs
- full identity-revocation APIs

## JWT And Open Modes

`auth.mode: open` still exists for local development. It accepts explicit vault
URLs without application-level auth.

`auth.mode: jwt` still exists for operator-managed bearer-token auth. It
enforces vault membership from token claims but does not expose the invite /
identity management API.

## Summary

The implemented identity model is:

- explicit vaults only
- normal user keys only
- vault-scoped invites
- one identity can belong to many vaults
- no admin bootstrap ceremony
