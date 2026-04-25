# AccordKit — Technical Design

## Technology Stack

| Concern | Choice | Notes |
|---|---|---|
| CRDT engine | `yjs` | Y.Text for all text documents |
| Sync server | `@hocuspocus/server` v4 | WebSocket-based, built on top of yjs. Pin the latest v4.x release at implementation time. |
| Client provider | `@hocuspocus/provider` | WebSocket client for CLI + plugin |
| Persistence | `@hocuspocus/extension-sqlite` | SQLite only (Postgres deferred) |
| Text diffing | `fast-diff` | Plain text → YJS delta conversion |
| File watching | `chokidar` | Cross-platform FS watcher with debounce |
| Awareness / presence | `y-protocols/awareness` | Built into Hocuspocus; zero extra config |
| Editor binding | `y-codemirror.next` | CodeMirror 6 ↔ Y.Text binding |
| Monorepo | pnpm workspaces | Strict dependency boundaries and efficient local installs |
| Language | TypeScript throughout | Strict mode |
| Runtime | Node.js 22+ | Required by `@hocuspocus/server` v4 |
| Build (plugin) | esbuild | Standard Obsidian plugin toolchain |
| Build (CLI/server) | `tsc` + optional `pkg`/`bun build` | Distributable via npm |

---

## Monorepo Structure

```
accord-kit/
├── package.json              # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # Shared TypeScript config
├── packages/
│   ├── core/                 # @accord-kit/core
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── paths.ts      # Document ID and safe path normalization
│   │   │   ├── ignore.ts     # Default ignore patterns + gitignore-style matching
│   │   │   ├── file-types.ts # Text/binary detection
│   │   │   ├── hash.ts       # SHA-256 helpers
│   │   │   └── diff.ts       # fast-diff → Y.Text delta
│   │   └── package.json
│   │
│   ├── server/               # @accord-kit/server
│   │   ├── src/
│   │   │   ├── index.ts      # Entry point / CLI bootstrap
│   │   │   ├── server.ts     # Hocuspocus server factory
│   │   │   ├── config.ts     # Config loading (file + env)
│   │   │   ├── persistence/
│   │   │   │   └── sqlite.ts
│   │   │   └── routes.ts     # REST endpoints (documents list + binary files)
│   │   └── package.json
│   │
│   ├── cli/                  # @accord-kit/cli
│   │   ├── src/
│   │   │   ├── index.ts      # CLI entry point
│   │   │   ├── watcher.ts    # chokidar-based file watcher
│   │   │   ├── sync.ts       # YJS doc pool + Hocuspocus providers
│   │   │   └── binary.ts     # Binary file upload/download
│   │   └── package.json
│   │
│   └── obsidian-plugin/      # accord-kit-obsidian
│       ├── src/
│       │   ├── main.ts       # Plugin entry point
│       │   ├── sync-manager.ts
│       │   ├── bootstrap.ts  # Initial vault sync from server
│       │   ├── editor-binding.ts
│       │   ├── binary-sync.ts
│       │   └── settings.ts
│       ├── manifest.json
│       └── package.json
```

---

## Document Naming Convention

Document IDs on the Hocuspocus server are the **file path relative to the watched root**, using forward slashes regardless of OS:

```
notes/meeting-2024-01-15.md
projects/accord-kit/README.md
images/diagram.png            ← binary: handled separately (see below)
```

Clients must be configured with a matching root path so that two clients watching different local directories resolve to the same document ID.

---

## Package: `@accord-kit/server`

### Hocuspocus Setup

```typescript
import { Server } from '@hocuspocus/server'
import { SQLite } from '@hocuspocus/extension-sqlite'

export function createAccordServer(config: AccordConfig) {
  return new Server({
    port: config.port ?? 1234,
    address: config.address ?? '127.0.0.1',
    extensions: [
      new SQLite({ database: config.sqlitePath ?? './data.db' }),
    ],
  })
}
```

### Persistence

**SQLite** (`@hocuspocus/extension-sqlite`): zero-config, single file. Document state is stored as `Uint8Array` YJS state vectors in a `documents` table. Postgres support is deferred.

### REST API

The server exposes a small HTTP API alongside the Hocuspocus WebSocket, on the same port. This serves two purposes: letting new clients discover what files exist on the server (bootstrap), and handling binary file transfers.

```
GET  /documents         — List all text document IDs stored on the server
GET  /binary            — List all binary file IDs stored on the server
PUT    /binary/:docPath   — Upload binary file (last-write-wins)
GET    /binary/:docPath   — Download binary file
HEAD   /binary/:docPath   — Check ETag / last-modified (SHA-256 hash in ETag header)
DELETE /binary/:docPath   — Mark binary as deleted; server moves file to trash record
```

`GET /documents` queries the SQLite `documents` table and returns a JSON array of document names:

```json
["notes/meeting.md", "projects/accord-kit/README.md"]
```

`GET /binary` returns a JSON array of objects with path and last-modified metadata:

```json
[
  { "path": "images/diagram.png", "updatedAt": "2024-01-15T10:30:00Z", "hash": "abc123" }
]
```

Binary files are stored as flat files in `storageDir`. The server records `content_hash` (SHA-256 hex digest) and `updated_at` per file so clients can skip unnecessary transfers. Clients compute the SHA-256 hash of local files to compare against the manifest.

**Binary path validation:** All `PUT`, `GET`, `HEAD`, and `DELETE` requests on `/binary/:docPath` are validated before any file-system operation:
1. Decode and normalize the path.
2. Reject any path containing `..` segments or beginning with `/`.
3. Resolve the full path and assert it is inside `storageDir`.

Requests that fail validation are rejected with `400 Bad Request`.

### Configuration

Config is loaded from a YAML or JSON file, with environment variable overrides. The server defaults to localhost-only; remote access must be explicitly enabled.

```yaml
address: 127.0.0.1
port: 1234
persistence:
  path: ./data.db
binary:
  storageDir: ./binary
```

When `address` is set to a non-loopback interface, the server logs a startup warning because v1 has no application-level authentication. For Tailscale deployments, bind to the server's Tailscale IP when possible. Binding to `0.0.0.0` is acceptable only when OS firewall rules and Tailscale ACLs prevent public access to the port.

---

## Package: `@accord-kit/core`

The core package contains logic shared by the server, CLI, Obsidian plugin, and tests. Shared logic must live here whenever behavior needs to match across clients.

**Responsibilities:**
- Convert local paths to root-relative document IDs using forward slashes.
- Validate remote paths before filesystem access, rejecting absolute paths and `..` traversal.
- Provide default ignore patterns and gitignore-style matching.
- Classify files as text or binary.
- Compute SHA-256 content hashes for binary sync.
- Apply full text content to `Y.Text` using `fast-diff`.

The package has no dependency on Node-only APIs except where a helper explicitly targets server/CLI usage, so browser-compatible utilities can be reused by the Obsidian plugin.

---

## Package: `@accord-kit/cli`

### Startup & Bootstrap

On startup the CLI runs a reconciliation pass before the file watcher begins. This covers both the initial bootstrap (empty local directory) and the re-join case (existing local files that may have diverged).

**Step 1 — Fetch the server's file manifest**
Call `GET /documents` and `GET /binary` to get the complete list of files the server knows about.

**Step 2 — Walk the local directory**
Hash every local file to build a local manifest. If the directory is empty this set is empty.

**Step 3 — Reconcile text files**
For every document ID in the union of server + local sets:
- **Server only (file missing locally):** Open the Y.Doc via Hocuspocus WebSocket. Once synced, write its content to the local path, creating any intermediate directories.
- **Local only (file not on server):** Apply the local content as the initial YJS state and push it to the server.
- **Both sides:** Open the Y.Doc. Diff local content vs YJS content. Apply local changes to YJS (which the server will persist), then write the merged YJS content back to disk.

**Step 4 — Reconcile binary files**
For every binary path in the union of server + local sets:
- **Server only:** Download from `GET /binary/:path`.
- **Local only:** Upload to `PUT /binary/:path`.
- **Both sides:** Compare local hash against server hash from the manifest. If equal, skip. If different, upload local (local is assumed fresher; last-write-wins).

**Step 5 — Start the file watcher**
The watcher starts after reconciliation completes with two guards against echo events:

1. **`ignoreInitial: true`** — chokidar's `add` events for pre-existing files are suppressed, so reconciled files do not re-enter the sync pipeline on startup.
2. **Recent-writes set** — paths written to disk during reconciliation are added to a short-lived suppression set that expires after 2 s. Any chokidar `change` event for a path in this set is ignored, preventing reconciliation writes from triggering an unnecessary re-upload.

### YJS Doc Pool

Each file gets its own `Y.Doc` + `HocuspocusProvider`. Connections are opened lazily on first access and stay open while the watcher runs.

```typescript
class DocPool {
  private docs = new Map<string, { ydoc: Y.Doc; provider: HocuspocusProvider }>()
  private readonly MAX_OPEN_DOCS = 200

  get(docId: string): Y.Doc {
    if (!this.docs.has(docId)) {
      if (this.docs.size >= this.MAX_OPEN_DOCS) this.evictLRU()
      this.open(docId)
    }
    return this.docs.get(docId)!.ydoc
  }

  private evictLRU() {
    // Close the least-recently-accessed document (Map preserves insertion order)
    const [oldest] = this.docs.keys()
    this.close(oldest)
  }
}
```

### Text Diffing (plain text → Y.Text)

YJS has no built-in plain-text diff utility. The CLI reads the full file on every change and computes a `fast-diff` delta:

```typescript
import diff from 'fast-diff'
import * as Y from 'yjs'

function applyFileContent(yText: Y.Text, newContent: string) {
  const current = yText.toString()
  const deltas = diff(current, newContent)

  yText.doc!.transact(() => {
    let index = 0
    for (const [op, text] of deltas) {
      if (op === diff.INSERT) {
        yText.insert(index, text)
        index += text.length
      } else if (op === diff.DELETE) {
        yText.delete(index, text.length)
      } else {
        index += text.length
      }
    }
  })
}
```

### File Event Handling

| Event | Action |
|---|---|
| `add` | Open Y.Doc, push initial content or reconcile with server |
| `change` | Read full file, diff against Y.Text, apply delta |
| `unlink` | Write current Y.Doc content to `.accord-trash/<relPath>`, set deletion flag in `__accord_metadata`, remove from pool |
| `rename` | Unlink old path, add new path |

Chokidar events are debounced (default 300ms) to avoid thrashing on rapid writes (e.g. AI agents writing in quick bursts).

### Remote → Filesystem

When the server pushes a remote YJS update for a document the CLI is watching, the CLI writes the updated content back to disk. Two guards prevent echo loops where the CLI re-uploads its own writes:

1. **`transaction.local`** — YJS observer events include a `transaction` argument. Updates from the CLI's own `applyFileContent` calls have `transaction.local === true` and are skipped entirely.
2. **Content hash comparison** — `lastWrittenContent` is set whenever the CLI writes to disk. Incoming chokidar `change` events whose file content matches `lastWrittenContent` are discarded without re-uploading.

```typescript
let lastWrittenContent: string | null = null

yText.observe(async (_event, transaction) => {
  // Ignore updates that originated from our own diff application
  if (transaction.local) return

  const newContent = yText.toString()
  // Ignore if content matches what we last wrote (prevents echo loops on reconnect)
  if (newContent === lastWrittenContent) return

  lastWrittenContent = newContent
  await fs.promises.writeFile(localPath, newContent, 'utf-8')
})
```

### Attribution

The CLI is configured with a `userName`. This is set on the HocuspocusProvider's awareness state:

```typescript
provider.setAwarenessField('user', {
  name: config.userName,
  type: 'cli',
  color: stringToColor(config.userName),  // deterministic CSS hex color for cursor display
})
```

---

## Package: `accord-kit-obsidian`

### Editor Integration Strategy

The Obsidian public `Editor` API (stable) does not expose the underlying `CodeMirror EditorView`. However, `(editor as any).cm` is a widely-used unofficial accessor that gives direct access to the `EditorView`. This is the approach used by the plugin because:

- Vault-level sync (writing full file on every remote change) would cause visible flicker and break Obsidian's undo history.
- `y-codemirror.next` requires a `EditorView` to wire up the binding.
- The `editor.cm` accessor is stable in practice across all current Obsidian versions and is widely used by the plugin community.

If Obsidian ever removes `editor.cm`, the fallback is vault-level sync (acceptable degraded mode).

### Initial Bootstrap

When the plugin connects to a server for the first time (or when the user clicks "Sync now" in settings), it runs a bootstrap pass equivalent to the CLI's startup reconciliation:

1. Call `GET /documents` and `GET /binary` to get the server's full file manifest.
2. Compare against the current vault's file list.
3. For each document the server has but the vault doesn't: open the Y.Doc, write its content into the vault via `app.vault.create(path, content)`.
4. For each document in the vault but not on the server: connect the Y.Doc and push the local content.
5. For binary files: download missing ones via the REST API; upload any vault binaries the server doesn't have.

The bootstrap progress is shown as a status bar message ("AccordKit: syncing 12/47 files…"). The user can keep working in Obsidian while bootstrap runs — files that are already in sync open normally, and files being bootstrapped open read-only until their initial sync completes.

On subsequent plugin loads (Obsidian restart, plugin reload), the same reconciliation runs but most files will already match, so it completes quickly.

### Per-File Connection Lifecycle

```
open file
  → create Y.Doc
  → connect HocuspocusProvider (WebSocket to server)
  → bind y-codemirror.next to (editor.cm, yText, awareness)

switch file
  → tear down CodeMirror binding
  → keep Y.Doc + provider alive in background (other clients may still be editing)

close file / unload plugin
  → disconnect provider
  → destroy Y.Doc
```

### CodeMirror Binding

```typescript
import { yCollab } from 'y-codemirror.next'

function bindEditor(view: EditorView, yText: Y.Text, awareness: Awareness) {
  const extension = yCollab(yText, awareness, {
    undoManager: false,  // Let Obsidian own undo history
  })
  view.dispatch({ effects: StateEffect.appendConfig.of(extension) })
}
```

`undoManager: false` disables the YJS-managed undo stack, deferring to Obsidian's built-in undo history. Note: Obsidian's undo treats all document changes as local edits, so pressing Ctrl+Z may undo changes made by a remote client. This is an accepted v1 limitation and should be surfaced in plugin settings/help text. A shared undo stack that correctly excludes remote operations is deferred.

### Awareness / Cursors

Each user is configured with a name and an auto-assigned color (derived from a hash of the name for consistency). Awareness state is updated on every editor selection change:

```typescript
const pushAwareness = debounce((view: EditorView) => {
  awareness.setLocalState({
    user: { name: settings.userName, color: userColor },
    cursor: {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    },
  })
}, 50)
```

Awareness updates are debounced to 50ms to avoid saturating the WebSocket with cursor-drag events. `y-codemirror.next` renders other users' cursors as colored caret widgets with name labels automatically.

### Sync Scope

The plugin syncs the entire vault by default. Users can exclude specific folders by name via the "Ignored folders" setting. Each entry is a plain folder name (e.g. `Templates`, `Archive`); the watcher appends a trailing `/` and passes these to the `ignorePatterns` option in `WatcherConfig`.

Advanced gitignore-style patterns and include-path whitelisting are deferred to a future release.

### Conflict Handling

YJS CRDTs merge concurrent edits deterministically — there are no conflicts in the traditional sense. The merged result is applied silently, consistent with how Google Docs behaves. No conflict markers are inserted in the MVP.

### Settings

```typescript
interface AccordKitSettings {
  serverUrl: string           // ws://localhost:1234
  userName: string
  ignoredFolders: string[]    // plain folder names excluded from sync (e.g. ['Templates', 'Archive'])
  deletionBehavior: 'trash' | 'delete'  // default: 'trash'
}
```

### Build

Standard Obsidian esbuild setup:
- Entry: `src/main.ts`
- Output: `main.js` (CJS bundle)
- Externals: `obsidian`, `electron`, Node built-ins
- All YJS/Hocuspocus code is bundled in

---

## Cross-Cutting Concerns

### Default Ignore Patterns

Both the CLI watcher and the Obsidian plugin apply a default set of ignore patterns. Files matching these patterns are never uploaded to the server, and remote deletions of ignored paths are not applied locally.

```
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

Users extend the list via an `ignorePatterns` config option (gitignore syntax). The `.accord-trash/` entry is always applied regardless of user configuration.

---

### Deletion & Trash

Deletion is propagated using a dedicated shared `Y.Map` document named `__accord_metadata`, stored on the server alongside regular documents. Each entry key is a document path; the value is `{ deleted: true, deletedAt: <ISO timestamp> }`.

**When a client deletes a file:**
1. Saves the current file content to `.accord-trash/<relPath>` (preserving the relative path hierarchy).
2. Sets the deletion flag in `__accord_metadata`.
3. Disconnects the Y.Doc provider and removes it from the pool.

**When a client receives a remote deletion:**
1. Reads the current local file (if present) and saves it to `.accord-trash/<relPath>`.
2. Removes the live file from disk (or moves it to the OS trash if `deletionBehavior: 'trash'` is configured).
3. Disconnects the Y.Doc provider.

The `.accord-trash/` directory is excluded from sync by its default ignore pattern, so trash contents remain local to each client. Users recover files by moving them out of `.accord-trash/` manually.

---

### Binary File Sync

All text file sync happens over WebSocket via Hocuspocus. Binary files are the only thing that uses polling — they bypass Hocuspocus entirely and use the server's REST API:

1. On startup / file open: compare local file hash against server `HEAD` response. Download if server is newer; upload if local is newer; skip if equal.
2. On file change (FS event or vault event): upload to `PUT /binary/:docPath`.
3. Polling: the CLI polls every 30s; the Obsidian plugin polls on file open and on a 60s interval. A push mechanism (server-sent events) is a future improvement.

Binary sync is last-write-wins based on upload timestamp. No CRDT merging.

### Offline Behavior

YJS is designed for offline-first use. When a client reconnects, Hocuspocus exchanges state vectors and syncs only the missing updates. No special handling required in AccordKit.

The CLI should buffer FS events while disconnected and apply them in order on reconnect.

### Reconnection

Both the CLI and Obsidian plugin use `@hocuspocus/provider`'s built-in reconnection logic (exponential backoff). No custom reconnection code needed.

---

## Deferred / Future Work

- **Conflict visibility:** Currently silent CRDT merges. Future option: display a notification or inline markers when concurrent edits to the same region are detected.
- **Binary push:** Replace polling with a server-sent event stream (`GET /binary/changes`) so clients get binary updates immediately.
- **Postgres persistence:** Add `@hocuspocus/extension-database` + `pg` adapter once SQLite is validated.
- **Authentication:** Skeleton `onConnect` / `onAuthenticate` hooks are already in the extension architecture; implement token validation when ready.
- **Obsidian `editor.cm` fallback:** Add a capability check at plugin load; fall back to vault-level sync and warn the user if the accessor is unavailable.
