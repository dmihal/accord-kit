import Database from 'better-sqlite3'
import type { StorageDriver } from './index.js'

export class SQLiteDriver implements StorageDriver {
  private readonly db: any

  constructor(path: string) {
    this.db = new Database(path)
  }

  async setup(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      );

      CREATE TABLE IF NOT EXISTS documents (
        vault_id TEXT NOT NULL,
        name TEXT NOT NULL,
        state BLOB NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (vault_id, name)
      );

      CREATE TABLE IF NOT EXISTS document_updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id TEXT NOT NULL,
        name TEXT NOT NULL,
        update_blob BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS document_updates_doc
      ON document_updates (vault_id, name, seq);

      CREATE TABLE IF NOT EXISTS binary_objects (
        vault_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (vault_id, name)
      );
    `)

  }

  getDb(): any {
    return this.db
  }

  async destroy(): Promise<void> {
    this.db.close()
  }

  async createVault(vaultId: string): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO vaults (id) VALUES (?)').run(vaultId)
  }

  async hasVault(vaultId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM vaults WHERE id = ?').get(vaultId)
    return Boolean(row)
  }

  async listVaults(): Promise<string[]> {
    const rows = this.db.prepare('SELECT id FROM vaults ORDER BY id').all() as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  async listDocuments(vaultId: string): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT name FROM documents WHERE vault_id = ?
      UNION
      SELECT DISTINCT name FROM document_updates WHERE vault_id = ?
      ORDER BY name
    `).all(vaultId, vaultId) as Array<{ name: string }>

    return rows.map((row) => row.name)
  }

  async loadDocument(vaultId: string, documentId: string): Promise<{ state: Uint8Array | null; updates: Uint8Array[] }> {
    const snapshot = this.db
      .prepare('SELECT state FROM documents WHERE vault_id = ? AND name = ?')
      .get(vaultId, documentId) as { state: Buffer } | undefined
    const updates = this.db
      .prepare('SELECT update_blob FROM document_updates WHERE vault_id = ? AND name = ? ORDER BY seq')
      .all(vaultId, documentId) as Array<{ update_blob: Buffer }>

    return {
      state: snapshot?.state ? new Uint8Array(snapshot.state) : null,
      updates: updates.map((row) => new Uint8Array(row.update_blob)),
    }
  }

  async appendUpdate(vaultId: string, documentId: string, update: Uint8Array): Promise<void> {
    this.db
      .prepare('INSERT INTO document_updates (vault_id, name, update_blob) VALUES (?, ?, ?)')
      .run(vaultId, documentId, Buffer.from(update))
  }

  async storeDocument(vaultId: string, documentId: string, state: Uint8Array): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM document_updates WHERE vault_id = ? AND name = ?').run(vaultId, documentId)
      this.db.prepare(`
        INSERT INTO documents (vault_id, name, state, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(vault_id, name) DO UPDATE
        SET state = excluded.state, updated_at = excluded.updated_at
      `).run(vaultId, documentId, Buffer.from(state))
    })

    transaction()
  }
}
