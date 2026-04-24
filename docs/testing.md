# AccordKit — Testing Specification

## Philosophy

Unit tests alone cannot validate the core promise of AccordKit — that edits made in one place reliably appear everywhere else. Integration tests that run real components against each other are the primary quality gate. Unit tests are used only for pure logic (diffing, path normalization, config parsing).

---

## Test Runner & Framework

**Vitest** across all packages. Chosen over Jest for native TypeScript/ESM support and faster execution in a monorepo.

```
accord-kit/
├── tests/
│   └── integration/         # Cross-package integration tests
│       ├── helpers/
│       │   ├── server.ts    # Start/stop a real Hocuspocus server
│       │   ├── watcher.ts   # Start/stop a CLI watcher against a tmp dir
│       │   └── sync.ts      # waitForFile, waitForContent, waitForDeletion
│       ├── text-sync.test.ts
│       ├── binary-sync.test.ts
│       ├── lifecycle.test.ts
│       ├── concurrent.test.ts
│       ├── bootstrap.test.ts
│       └── reconnection.test.ts
├── packages/
│   ├── server/src/__tests__/     # Server unit tests
│   ├── cli/src/__tests__/        # CLI unit tests
│   └── obsidian-plugin/src/__tests__/  # Plugin unit tests (no Obsidian runtime)
```

Integration tests run against real built code — no mocks of the server, CLI, or file system.

---

## Integration Test Infrastructure

### Test Helpers

**`helpers/server.ts`**

Starts a real `@accord-kit/server` instance on a random free port. Returns the URL and a `stop()` function.

```typescript
interface TestServer {
  wsUrl: string    // ws://127.0.0.1:<port>
  httpUrl: string  // http://127.0.0.1:<port>
  stop: () => Promise<void>
}

async function startTestServer(): Promise<TestServer>
```

The server uses an in-memory SQLite database (`:memory:`) so there is no disk state between tests. The exception is `reconnection.test.ts`'s **server restart** scenario, which requires persistence across two server instances — that test creates a named temp file (`/tmp/accord-test-<uuid>.db`) and passes it explicitly to both server instances.

**`helpers/watcher.ts`**

Starts a CLI watcher against a temporary directory. Returns the root path, a file-writing helper, and a `stop()` function.

```typescript
interface TestWatcher {
  root: string
  stop: () => Promise<void>
  write: (relPath: string, content: string) => Promise<void>
  read: (relPath: string) => Promise<string>
  remove: (relPath: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  writeBinary: (relPath: string, data: Buffer) => Promise<void>
  readBinary: (relPath: string) => Promise<Buffer>
}

async function startTestWatcher(serverUrl: string, options?: Partial<WatcherConfig>): Promise<TestWatcher>
```

Each `startTestWatcher` call creates a unique `tmp/<uuid>/` directory and cleans it up on `stop()`.

**`helpers/sync.ts`**

Polling-based assertions. All helpers accept a `timeoutMs` (default 5000ms) and poll every 100ms.

```typescript
// Wait until a file exists at path with optional expected content
async function waitForFile(watcherRoot: string, relPath: string, timeoutMs?: number): Promise<void>

// Wait until file content exactly matches expected string
async function waitForContent(watcherRoot: string, relPath: string, expected: string, timeoutMs?: number): Promise<void>

// Wait until file content matches a predicate (useful for partial-match checks)
async function waitForContentMatch(watcherRoot: string, relPath: string, predicate: (content: string) => boolean, timeoutMs?: number): Promise<void>

// Wait until a file no longer exists (deletion or trash)
async function waitForAbsence(watcherRoot: string, relPath: string, timeoutMs?: number): Promise<void>

// Wait until two files have identical content
async function waitForMatch(rootA: string, rootB: string, relPath: string, timeoutMs?: number): Promise<void>
```

### Lifecycle Pattern

Every integration test follows this pattern:

```typescript
describe('text sync', () => {
  let server: TestServer
  let clientA: TestWatcher
  let clientB: TestWatcher

  beforeEach(async () => {
    server = await startTestServer()
    clientA = await startTestWatcher(server.wsUrl, { userName: 'Agent' })
    clientB = await startTestWatcher(server.wsUrl, { userName: 'Human' })
  })

  afterEach(async () => {
    await clientA.stop()
    await clientB.stop()
    await server.stop()
  })

  it('syncs a new file from A to B', async () => {
    await clientA.write('notes/hello.md', '# Hello')
    await waitForContent(clientB.root, 'notes/hello.md', '# Hello')
  })
})
```

---

## Integration Test Scenarios

### 1. Text File Sync (`text-sync.test.ts`)

| Test | Description |
|---|---|
| **create → sync** | Write a new file on A; assert it appears with identical content on B |
| **edit → sync** | Modify an existing file on A; assert B receives the update |
| **multi-edit** | Make 10 sequential edits on A; assert B converges to the final content |
| **A→B and B→A** | Write on A, wait for B, then edit on B, assert A receives the update |
| **nested path** | File at `a/b/c/deep.md`; assert directories are created on both sides |
| **large file** | 500KB markdown document; assert sync completes within timeout |
| **empty file** | Write an empty file; assert it appears empty on B |
| **unicode content** | File with emoji, CJK characters, RTL text; assert round-trip is lossless |

### 2. Concurrent Edits (`concurrent.test.ts`)

| Test | Description |
|---|---|
| **simultaneous writes** | Both A and B write different content to the same new file at the same time; assert both converge to the same (non-empty) content |
| **simultaneous appends** | A appends "line from A\n" and B appends "line from B\n" to the same file simultaneously; assert final file contains both lines (in any order) |
| **three-client convergence** | Clients A, B, C all edit the same file concurrently; assert all three converge to identical content |
| **rapid concurrent edits** | A sends 50 edits in 100ms while B sends 50 different edits; assert both clients converge and neither loses all their changes |

These tests validate the core CRDT guarantee: all clients converge to the same state regardless of edit order.

### 3. File Lifecycle Events (`lifecycle.test.ts`)

| Test | Description |
|---|---|
| **delete → trash (default)** | Delete file on A; assert file moves to `.accord-trash/<relPath>` on B (not permanently removed) |
| **delete → hard delete** | With `deletionBehavior: 'delete'`, delete on A; assert file is gone on B |
| **trash content preserved** | Delete file on A; assert the trashed copy on B contains the last-known content |
| **rename** | Rename `foo.md` to `bar.md` on A; assert `bar.md` appears and `foo.md` disappears on B |
| **move between folders** | Move file from `a/foo.md` to `b/foo.md` on A; assert same on B |
| **delete then recreate** | Delete file on A, then create a new file with the same path; assert B receives the new content |
| **write-guard — no echo loop** | Write a file on A; wait for B to sync it; make a remote-originated change on the server; assert the CLI does not re-upload the change (server update count stays at 1, no infinite loop) |
| **ignored file not synced** | Write `.DS_Store` and `notes/real.md` on A; assert only `notes/real.md` appears on B |
| **trash not synced** | Write a file to `.accord-trash/foo.md` on A; assert it does not appear on B |

### 4. Binary File Sync (`binary-sync.test.ts`)

| Test | Description |
|---|---|
| **image sync** | Copy a PNG to A; assert identical bytes appear on B (within poll interval + buffer) |
| **binary overwrite** | Upload binary v1 from A; wait for server confirmation; then upload binary v2 from B; wait for server confirmation; assert both clients converge to v2 (upload order is controlled sequentially, not concurrent, so last-write-wins is deterministic) |
| **binary delete** | Delete binary on A; assert it moves to `.accord-trash/` on B |
| **concurrent binary** | A and B upload different versions of the same binary simultaneously; assert both settle on the same version |

Binary tests must account for the polling interval. Default timeout for binary assertions is 10s (vs 5s for text).

### 5. Bootstrap / Initial Join (`bootstrap.test.ts`)

| Test | Description |
|---|---|
| **empty dir → full sync** | Server has 10 files; new client joins with empty dir; assert all 10 files appear locally |
| **partial dir → merge** | Server has files A+B; new client joins with file A (identical) and file C (local-only); assert client ends up with A+B+C and server now has C |
| **empty dir, binary files** | Server has text + binary files; new client joins empty; assert both types are downloaded |
| **two clients, sequential join** | Client A populates server with files; Client B joins with empty dir; assert B receives all of A's files |
| **join with diverged file** | Client joins with a local file whose content differs from the server version; assert they merge and both sides converge |

### 6. Reconnection & Offline (`reconnection.test.ts`)

| Test | Description |
|---|---|
| **offline edit syncs on reconnect** | Stop B, write files on A, restart B; assert B catches up |
| **offline edit from both sides** | Stop server, write on A and B, restart server; assert both clients converge |
| **server restart** | Write files, stop server, restart server (same SQLite db), write more files; assert all files present and correct on all clients |
| **transient disconnect** | Simulate brief network drop (stop/start server quickly); assert no data loss |

---

## Unit Tests

### `packages/cli/src/__tests__/diff.test.ts`

Tests for the `applyFileContent` diff function in isolation — no YJS server or file system needed.

```typescript
it('inserts new content into empty Y.Text')
it('appends text to existing content')
it('deletes a range')
it('replaces a range')
it('handles empty string → empty string (no-op)')
it('handles unicode content correctly')
it('handles large content (100KB) without timeout')
```

### `packages/cli/src/__tests__/watcher.test.ts`

Tests for path normalization, ignore pattern matching, and binary detection logic.

```typescript
it('normalizes Windows paths to forward-slash document IDs')
it('detects binary files by extension')
it('respects ignore patterns')
it('debounces rapid consecutive changes to the same file')
```

### `packages/server/src/__tests__/config.test.ts`

Tests for config loading from file and environment variables.

### `packages/obsidian-plugin/src/__tests__/sync-manager.test.ts`

Tests the sync manager's state machine (connecting, syncing, disconnected, error) using a mock `HocuspocusProvider`. No Obsidian runtime required — the sync manager is written as framework-agnostic logic that the plugin wires into Obsidian's API.

---

## Running Tests

```bash
# All tests
npm test

# Unit tests only (fast)
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode during development
npm run test:watch

# A single integration test file
npx vitest run tests/integration/text-sync.test.ts
```

Integration tests are slower (real I/O, real sockets) and are tagged so CI can run unit tests on every push and integration tests on every PR.

---

## CI Strategy

| Stage | Runs | Trigger |
|---|---|---|
| Unit tests | `npm run test:unit` | Every push |
| Integration tests | `npm run test:integration` | Every PR |
| Full suite | `npm test` | Pre-merge / nightly |

Integration tests are expected to take 30–60 seconds. Each test file spins up its own server on a random port so tests can run in parallel without port conflicts.

---

## Known Limitations

- **Obsidian plugin integration tests** require the Obsidian runtime and cannot be run in CI without a headless Obsidian environment. The plugin's sync logic is extracted into a framework-agnostic `SyncManager` class that can be tested with mock providers. Full end-to-end plugin testing is manual for now.
- **Binary sync timing** depends on the polling interval. Tests use a generous timeout (10s) to accommodate this. If binary polling is later replaced with push, test timeouts can be tightened.
