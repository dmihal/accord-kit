# Onboarding & invite flow

## Product model

- There is no special `default` vault.
- There is no server-wide admin role.
- The server knows about identities, vaults, memberships, and invite codes.
- Any user can create a vault.
- Any vault member can invite another user into that vault.
- Joining a vault either grants access to an existing identity or creates a new
  identity and grants it access.
- Backwards compatibility is not a goal for this change. We can wipe databases
  and start fresh.

## Goals

- Remove every server and client assumption that a missing vault means
  `default`.
- Make it trivial to bring a second device, second user, or watcher folder onto
  an existing vault: one shareable token, one command, ready to sync.
- Let a brand-new user create their first vault directly from the client
  without any bootstrap admin key or privileged setup flow.
- For Obsidian specifically: a target folder that doesn't yet exist should be
  initialized as an empty Obsidian vault with the plugin pre-installed and
  pre-configured, so the user can open Obsidian and have it pull everything
  down with zero further setup.

## What changes

### 1. No more `default`, anywhere

- Drop the `'default'` fallback in:
  - `packages/obsidian-plugin/src/main.ts`
  - `packages/cli/src/cli.ts`
  - `packages/cli/src/watcher.ts`
  - `packages/cli/src/sync.ts`
  - server routing and auth helpers that currently infer `default`
  - server storage setup and init paths that currently create `default`
- Every vault-scoped request must name a vault explicitly.
- A plugin install with no configured vault is in an "unconfigured" state and
  shows an onboarding panel in the settings tab.
- `accord watch` does not start until a vault is explicitly known.
- The server should never create a vault implicitly during startup.

### 2. No admin key; vault creation is the bootstrap path

Today the server has an init flow that creates an admin identity and a default
vault. We remove that model entirely.

New rules:

- There is no `isAdmin`.
- There is no global identity-management surface.
- There is no special bootstrap key printed by server init.
- Server startup only ensures schema/storage is ready.

Vault creation becomes the onboarding path:

- `POST /vaults`
  - If unauthenticated: create a new identity, generate a key, create a new
    vault, grant that identity access, and return the credentials and vault
    metadata.
  - If authenticated: create a new vault for the existing identity and return
    the new vault metadata.

For the unauthenticated case, the response should include at least:

```json
{
  "key": "accord_sk_...",
  "identityId": "…",
  "userName": "David's MacBook",
  "vaultId": "…",
  "name": "My Vault"
}
```

This gives the plugin and CLI a clean first-run flow with no separate server
bootstrap ceremony.

### 3. Bundled invite token (URL form)

Today `accord vault invite <vault>` prints a bare invite code. Users still need
to separately know the server URL and the vault ID and feed all three into the
target client.

We replace this with a single shareable URL-shaped token:

```text
accord://<host>[:<port>]/<vaultId>?invite=<code>[&tls=0]
```

- `host[:port]` carries the server origin.
- `vaultId` is the path segment.
- `invite` is the raw single-use code the server already issues.
- `tls=0` means reconstruct `ws://` and `http://`.
- Omitted `tls` means reconstruct `wss://` and `https://`.

Encode/decode helpers live in `@accord-kit/core` so the CLI and plugin share
them. The raw invite code remains valid for the existing redemption endpoint;
the URL is purely a client-side bundling format.

`accord vault invite <vault>` prints the URL. The bare code is still shown
underneath for users who prefer to paste it into the existing flow.

### 4. New CLI command: `accord join`

```text
accord join <token> [path]
```

- Decodes the token into `{ serverUrl, vaultId, inviteCode }`.
- Runs the existing redeem flow: saves credentials under the resolved server
  URL, persists the returned key, and records the vault as the local active
  vault for that server.
- If `path` is provided:
  - If `path` doesn't exist or is empty, scaffold an Obsidian vault skeleton
    there.
  - If `path` is an existing Obsidian vault, install the plugin into it.
  - In both cases, write
    `.obsidian/plugins/accord-kit/data.json` pre-populated with `serverUrl`,
    `apiKey`, `vaultId`, and `userName`.
- If `path` is omitted: just save credentials so
  `accord watch <dir> --vault <id>` works without another login step. Print the
  exact `accord watch` invocation to run.

### 5. CLI local active vault

The server has no default vault, but the CLI may still keep a client-local
active vault for convenience.

- Extend the credentials model to store `activeVaultId` per server.
- `accord join` sets `activeVaultId` to the joined vault.
- `accord watch` resolves vault in this order:
  - `--vault`
  - saved `activeVaultId`
  - otherwise error with a message that a vault must be specified

This is client state only. It must not be treated as a server default.

### 6. Plugin: unconfigured onboarding + in-app invite UI

The plugin starts in an unconfigured state when it has no `vaultId`.

The settings tab shows an onboarding panel with two actions:

- **Create a new vault**
  - Asks for user name and vault name.
  - Calls `POST /vaults` without auth.
  - Stores the returned `serverUrl`, `apiKey`, `vaultId`, and `userName`.
- **Join with an invite**
  - Opens the existing redeem modal.
  - The modal accepts either a bare invite code or an `accord://...` token.
  - If the token form is used, server URL and vault ID are auto-filled.

The watcher does not start until the plugin has both a server URL and a vault
ID.

Once configured, the settings tab also shows an **Invites** section, visible
whenever the plugin has a working `apiKey` and `vaultId`:

- A **Generate invite** button that calls the server's existing invite-create
  endpoint, then displays the resulting `accord://...` URL with a **Copy**
  button and the bare code below it for fallback.
- A list of outstanding invites for the current vault, each with a copy button
  and an expiry timestamp.

### 7. Obsidian vault skeleton

When `accord join <token> <path>` targets a missing or empty folder, scaffold:

```text
<path>/
  .obsidian/
    community-plugins.json     # ["accord-kit"]
    plugins/
      accord-kit/
        main.js                # copied from packages/cli/plugin-dist
        manifest.json          # copied from packages/cli/plugin-dist
        data.json              # { serverUrl, apiKey, vaultId, userName, ... }
```

This reuses the file-copy logic already in `packages/cli/src/cli.ts`'s
`install-plugin` command. Extract it into a helper that both commands call.

No notes, no workspace state, no app config beyond what's required for the
plugin to load. Obsidian fills the rest in on first open. The plugin then
connects, sees an empty local tree, and pulls everything from the server.

## Server/API changes

- Remove `isAdmin` from the identity model and schema.
- Remove global identity listing/revocation routes and CLI commands.
- Remove the current init flow that creates a default vault and admin identity.
- Make server startup perform schema setup only.
- Change `POST /vaults` to support both:
  - unauthenticated create-first-vault
  - authenticated create-another-vault
- Keep `POST /auth/redeem` behavior:
  - with bearer key: grant access to the existing identity
  - without bearer key: create a new identity + key, then grant access

## Membership policy

We keep the permission model deliberately simple:

- Any vault member can create invites.
- Any vault member can list invites.
- Any vault member can list members.
- Self-leave can be added later.
- Removing another member is out of scope for this onboarding change unless we
  introduce explicit per-vault roles.

That avoids re-introducing an owner/admin concept through the side door.

## Implementation order

1. **Server**
   - Remove `default` creation and implicit vault resolution.
   - Remove admin-only identity management.
   - Update `POST /vaults` to support unauthenticated bootstrap.
   - Update tests accordingly.
2. **Core**
   - Add `encodeJoinToken` / `decodeJoinToken` in `@accord-kit/core`, with
     tests covering round-trip, scheme validation, and `tls=0` handling.
3. **CLI**
   - Update `vault invite` to print the URL form.
   - Extract the plugin-copy logic from `install-plugin` into a shared helper.
   - Add the `join` command.
   - Add client-local `activeVaultId` handling.
   - Remove `--vault default` behavior from `watch`.
4. **Plugin**
   - Remove `default` fallbacks.
   - Add the unconfigured-state onboarding panel with Create / Join actions.
   - Teach the redeem modal to accept either a bare code or an `accord://` URL.
   - Add the Invites section with generate + list + copy.
5. **Docs**
   - Update `README.md` and `docs/multi-vault.md` to describe the new flow.
   - Remove references to `default`, admin bootstrap, and any privileged setup.

## Open questions

- Should unauthenticated `POST /vaults` require a user name in the request and
  reject empty values, or should the server tolerate an omitted name and fill
  something like `unnamed`?
- Should the CLI expose an explicit `accord vault use <vault>` command for
  switching `activeVaultId`, or is `join` + `--vault` enough for now?
- Do we want self-leave in the first pass, or can member removal stay entirely
  out of scope until we design vault-level roles?
