# @accord-kit/core

Shared utilities for AccordKit — the real-time document sync layer between AI agents and Obsidian.

This package is an internal dependency of `@accord-kit/cli` and `@accord-kit/server`. You do not need to install it directly unless you are building a custom AccordKit integration.

## What's inside

| Export | Purpose |
|---|---|
| `applyDiff` / `computeDiff` | Character-level text diffing (wraps [fast-diff](https://www.npmjs.com/package/fast-diff)) for applying filesystem changes to a Yjs `Y.Text` |
| `isBinaryFile` | Detect binary vs. text files by extension |
| `hashContent` | Stable SHA-256 digest of file contents |
| `buildIgnore` / `defaultIgnorePatterns` | Construct an [ignore](https://www.npmjs.com/package/ignore)-based filter with sensible defaults (`.git/`, `.obsidian/`, `.accord-trash/`, etc.) |
| `normalizeDocumentId` / `documentIdToPath` | Convert between OS file paths and URL-style document identifiers used by Hocuspocus |

## Default ignore patterns

```
.git/
.obsidian/
.DS_Store
Thumbs.db
*.tmp
.accord-trash/
```

## License

MIT
