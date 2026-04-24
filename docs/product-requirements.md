# AccordKit — Product Requirements

## Overview

AccordKit is an open-source, self-hosted document synchronization system built on [YJS](https://yjs.dev) and [Hocuspocus](https://hocuspocus.dev). It enables real-time collaborative editing of files between human users and AI agents, treating both as first-class actors in a shared document graph.

The canonical use case: an AI agent writes files to a local directory on a server; a human edits the same documents in Obsidian on their laptop. Both see each other's changes in real time, with CRDT-based merging ensuring neither side loses work.

---

## Goals

- Sync text documents (primarily Markdown) between any number of clients in real time using YJS CRDTs.
- Support two client types: an **Obsidian plugin** for human editors and a **CLI file watcher** for AI agents and automated tooling.
- Keep the system self-hosted and operationally simple — a single server binary, minimal configuration, and a safe localhost default.
- Defer authentication and access control to a future release; assume a trusted network (for example, Tailscale) when remote access is enabled.

## Non-Goals (v1)

- Cloud-hosted / managed offering.
- Authentication or per-document access control.
- A programmatic SDK for AI agents to push changes — agents interact via the file system only.
- Real-time cursor presence (nice-to-have, tracked below).

---

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

All clients connect to the Hocuspocus server over WebSocket. The server is the single source of truth and persists document state. Clients may come and go; offline edits are merged on reconnect via YJS's CRDT algorithm.

---

## Packages

The project is a TypeScript monorepo using pnpm workspaces, distributed as npm packages.

| Package | Name | Description |
|---|---|---|
| Core | `@accord-kit/core` | Shared path, ignore, diff, hashing, and file-type utilities |
| Server | `@accord-kit/server` | Hocuspocus-based sync server |
| CLI | `@accord-kit/cli` | File-system watcher for AI agents and scripts |
| Obsidian Plugin | `accord-kit-obsidian` | Obsidian community plugin |

---

## Document Identity

A document is identified by its **path relative to the watched root folder**. For example, if a client watches `/home/user/vault/` and a file exists at `/home/user/vault/notes/meeting.md`, its document ID on the server is `notes/meeting.md`.

Both the CLI watcher and the Obsidian plugin must be configured with the same root-relative namespace so that the same logical document maps to the same server-side document ID across all clients.

---

## File Type Handling

### Text files
All text files (`.md`, `.txt`, `.json`, `.yaml`, `.js`, `.ts`, etc.) are synced using YJS's text CRDT. Changes are applied character-level, enabling concurrent edits from multiple clients to merge deterministically.

When a change is detected, the client reads the full file contents, diffs them against the current YJS document state, and applies the delta as a YJS transaction.

### Binary files
Binary files (images, PDFs, etc.) are synced using **last-write-wins**: whichever client sends the most recent version of the file replaces the stored version. No CRDT merging is applied. This allows Obsidian vaults containing images and attachments to stay in sync without special handling.

---

## Components

### 1. Server (`@accord-kit/server`)

**Responsibilities:**
- Accept WebSocket connections from Obsidian plugins and CLI watchers.
- Maintain in-memory YJS documents and broadcast updates between connected clients.
- Persist document state to a configured backend so documents survive server restarts.

**Configuration:**
- Persistence backend: SQLite (v1 only). Zero external dependencies.
- Listening address and port (default: `127.0.0.1:1234`). Remote access requires explicitly binding to a Tailscale address or `0.0.0.0`.

**Persistence:**
- SQLite: stores all document state in a single `.db` file. Suitable for single-machine or low-traffic deployments.

**Authentication:** None in v1. All connections are accepted. The server must not be exposed directly to the public internet. The default bind address is `127.0.0.1`; users who need remote clients should bind to a private VPN interface such as [Tailscale](https://tailscale.com), or bind to `0.0.0.0` only when OS firewall rules and Tailscale ACLs restrict access.

### Tailscale Deployment

For remote Obsidian and CLI clients, the recommended v1 deployment is:

1. Install Tailscale on the server and each client device.
2. Start the AccordKit server with `address` set to the server's Tailscale IP, or to `0.0.0.0` only if the machine firewall blocks non-Tailscale access.
3. Configure clients to connect to `ws://<tailscale-ip>:1234`.
4. Use Tailscale ACLs to limit which devices can reach the AccordKit server port.

The server should print a warning whenever it binds to a non-loopback address while application-level authentication is disabled.

---

### 2. CLI Watcher (`@accord-kit/cli`)

**Responsibilities:**
- Watch a local directory for file-system events: create, modify, delete, rename.
- On change, read the affected file and sync the new state to the server.
- On startup, reconcile local file state with the server (push local changes, pull remote changes).
- Write remote changes received from the server back to the local file system.

**File watching:**
- Uses a reliable file-system watcher (e.g. `chokidar`) with debouncing to avoid thrashing on rapid edits.
- Handles all file types: text files via YJS diff, binary files via last-write-wins upload.

**File events:**
| Event | Behavior |
|---|---|
| Create | Register new document on server, push initial content |
| Modify | Compute YJS diff from old → new content, apply to server document |
| Delete | Move file to `.accord-trash/<relPath>` locally; propagate deletion to other clients, each of which also moves the file to their own `.accord-trash/` |
| Rename | Delete old document ID, create new document ID with current content |

**Configuration (CLI flags or config file):**
- Server URL (WebSocket endpoint)
- Root folder to watch
- User display name (for attribution)
- File patterns to ignore (gitignore-style)

---

### 3. Obsidian Plugin (`accord-kit-obsidian`)

**Responsibilities:**
- Provide Google Docs-style real-time collaborative editing within Obsidian.
- Connect to an AccordKit server and keep the active document in sync with remote state.
- Write incoming remote changes directly into the Obsidian editor buffer without disrupting the user's cursor. Obsidian undo behavior has a v1 limitation documented below.

**Sync scope:**
- Default: entire vault.
- Configurable: restrict to one or more subfolders, or exclude folders/patterns (gitignore-style).

**Conflict handling:**
YJS merges concurrent edits silently and deterministically — no user action is required. The merged result is applied directly to the editor, consistent with Google Docs behavior. A future version may add visible merge annotations when two users edit the same region simultaneously.

**Undo behavior:**
The Obsidian plugin uses Obsidian's native undo history in v1. Remote changes may therefore be included in the local editor undo stack, so pressing undo can sometimes revert recently applied remote edits. This is accepted for v1 and should be documented in plugin settings/help text.

**Configuration (Obsidian plugin settings):**
- Server URL
- User display name
- Sync scope: whole vault, specific folders, or exclusion patterns
- Ignore patterns (extends the default list)

---

## Default Ignore Patterns

Both the CLI watcher and the Obsidian plugin apply a default set of ignore patterns. Files matching these patterns are never uploaded to the server, and remote deletions of ignored paths are not applied locally:

```
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

Users can extend or override this list via the `ignorePatterns` config option (gitignore syntax). The `.accord-trash/` entry is always applied and cannot be removed.

---

## Deletion & Trash

When a file is deleted on one client, the deletion event is propagated to all connected clients. Rather than permanently removing files, each client moves them to a hidden `.accord-trash/` directory at the root of its watched folder:

- `notes/meeting.md` → `.accord-trash/notes/meeting.md`

The `.accord-trash/` directory is excluded from sync, so its contents remain local to each client. Users recover files by moving them out of `.accord-trash/` manually.

The CLI supports a `deletionBehavior: 'delete'` option for users who prefer permanent removal. The Obsidian plugin always uses trash to protect against accidental data loss.

---

## Attribution (Nice-to-Have)

Every client (Obsidian plugin, CLI watcher) is configured with a **user display name**. This name is attached to YJS awareness state and to document change metadata where possible. The goal is to make it visible who (or which agent) last modified a region of a document.

Implementation uses the [YJS Awareness Protocol](https://docs.yjs.dev/api/about-awareness-and-presence) which is built into Hocuspocus out of the box.

---

## Real-Time Presence (Nice-to-Have)

For the Obsidian plugin, show other connected users' cursor positions as colored labels — similar to Google Docs. This is also implemented via the YJS Awareness Protocol and the CodeMirror YJS binding.

The CLI watcher does not show presence (no UI), but it does broadcast its awareness state (user name, current file) to the server so other clients can display it.

---

## Conflict Handling

YJS CRDTs do not produce conflicts in the traditional sense — concurrent edits are merged deterministically. However, the merged result can be semantically surprising when two clients edit the same line simultaneously (e.g., character interleaving).

AccordKit applies concurrent edits silently for v1, consistent with how Google Docs and other CRDT-based tools behave. Every connected client is guaranteed to converge to the same document state. Future work includes surfacing a notification or inline annotation when concurrent edits to the same region are detected.

---

## Future Work

- **Authentication & access control:** API keys or token-based auth, per-document permissions.
- **End-to-end encryption:** Encrypt document content before it reaches the server.
- **Programmatic agent SDK:** A TypeScript client library for AI agents to push changes without going through the file system.
- **Conflict visibility:** Inline annotations or a sidebar diff view showing where concurrent edits were merged.
- **Selective sync:** Choose which documents to sync rather than syncing entire directories.
- **Version history:** Expose a timeline of document snapshots accessible from the Obsidian plugin.
- **Binary file diffing:** Investigate whether binary deltas (e.g. rsync-style) are worth implementing for large files.
- **Postgres persistence:** For higher-traffic or multi-server deployments once SQLite limits are reached.
- **Backup & recovery:** Tooling for SQLite backup, point-in-time restore, and disaster recovery documentation.
- **Rename map:** Preserve Y.Doc history across file renames (currently rename = delete + create, which loses history).
- **Cloud / managed hosting option.**
