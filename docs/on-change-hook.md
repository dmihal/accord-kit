# On-Change Hook

## Overview

The `--on-change` flag allows the `accord watch` command to spawn an external process whenever remote document changes are received. The primary use case is feeding document diffs to AI agents (Claude Code, Codex, etc.) so they can take automated actions in response to content changes.

## CLI Flags

### `--on-change <command>`

Shell command to run when remote changes arrive. The command receives a formatted prompt on stdin and is expected to consume it (the watcher does not use stdout/stderr beyond logging).

```bash
accord watch ./docs --on-change "claude --print"
accord watch ./docs --on-change "codex --full-auto"
accord watch ./docs --on-change "./scripts/handle-change.sh"
```

### `--on-change-prefix <text>`

Text prepended to the prompt before it is piped to the command. Intended for a system prompt that instructs the agent how to behave.

```bash
accord watch ./docs \
  --on-change "claude --print" \
  --on-change-prefix "You are watching a shared document vault. When documents change, apply the edits to the local codebase if they describe code changes, otherwise summarize what changed."
```

For longer system prompts, use a file via shell substitution:

```bash
accord watch ./docs \
  --on-change "claude --print" \
  --on-change-prefix "$(cat .accord-prompt)"
```

## Prompt Format

The prompt piped to the command's stdin has the following structure:

```
<prefix if set>

The following documents changed:

--- notes/standup.md
+++ notes/standup.md
@@ -3,7 +3,8 @@
 ## Today
-Fixed the login bug
+Fixed the login bug and deployed to staging
+Added unit tests
 
 ## Blockers
```

Multiple changed documents are separated by a blank line between their diffs.

## Queuing Behavior

The on-change command runs serially. If additional remote changes arrive while a command is still running, they are queued and delivered in a single follow-up invocation after the current one exits. The queue holds the latest state of each changed document — if the same document changes multiple times while the command is running, only one diff is generated (from the content at the time the previous invocation started to the content at the time the next invocation starts).

```
time ─────────────────────────────────────────────────────▶

remote changes:  [A v1]   [A v2]  [B v1]        [C v1]
                   │         │       │              │
command runs:    ──┤ cmd #1  ├───────────────────┤ cmd #2
                   └─────────┘                    └───────
                   diff: A∅→v1            diff: A v1→v2, B∅→v1, C∅→v1
```

Changes from the initial sync (startup scan + first manifest poll) are **not** delivered to the on-change command — only changes received after the watcher is fully initialized.

## Implementation Notes

### Diff Computation

The watcher maintains a `Map<documentId, string>` of the last-known content for each observed document. When `yText.observe` fires for a remote transaction, the diff is computed only if `--on-change` is configured:

```
previousContent = lastKnownContent.get(documentId) ?? ""
newContent      = yText.toString()
diff            = unifiedDiff(previousContent, newContent, { filename: documentId })
lastKnownContent.set(documentId, newContent)
```

The `diff` npm package (`createPatch`) produces the unified diff string.

### Queue Structure

```ts
interface PendingChange {
  documentId: string
  diff: string
}

pendingChanges: Map<documentId, PendingChange>  // keyed by documentId for deduplication
commandRunning: boolean
```

When `commandRunning` is false and the queue is non-empty, the runner drains the map, clears it, formats the prompt, and spawns the command. When the command exits, it checks whether new items arrived during the run and repeats if so.

### WatcherConfig Changes

```ts
export interface WatcherConfig {
  // ... existing fields ...
  onChangeCommand?: string   // --on-change
  onChangePrefix?: string    // --on-change-prefix
}
```

### Dependencies

- `diff` npm package — for `createPatch()` unified diff output

## Non-Goals

- The watcher does not interpret or validate the command's output.
- The watcher does not retry failed commands (non-zero exit is logged and discarded).
- Local file changes (edits made in the synced directory) do not trigger the hook — only remote changes received over the WebSocket do.
- Changes from initial startup sync are not delivered to the hook.
