import type { StorageDriver } from './index.js'

interface PostgresDriverConfig {
  url: string
  poolSize: number
}

interface Queryable {
  query: (query: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

interface PgPoolClient extends Queryable {
  release: () => void
}

interface PgPool extends Queryable {
  connect: () => Promise<PgPoolClient>
  end: () => Promise<void>
}

export class PostgresDriver implements StorageDriver {
  private poolPromise: Promise<PgPool> | null = null

  constructor(private readonly config: PostgresDriverConfig) {}

  async setup(): Promise<void> {
    if (!this.config.url) {
      throw new Error('Postgres storage requires storage.postgres.url')
    }

    const pool = await this.getPool()
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vaults (
        id text PRIMARY KEY,
        name text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text
      );

      CREATE TABLE IF NOT EXISTS documents (
        vault_id text NOT NULL,
        name text NOT NULL,
        state bytea NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vault_id, name)
      );

      CREATE TABLE IF NOT EXISTS document_updates (
        vault_id text NOT NULL,
        name text NOT NULL,
        seq bigserial,
        update_blob bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vault_id, name, seq)
      );

      CREATE INDEX IF NOT EXISTS document_updates_doc
      ON document_updates (vault_id, name, seq);

      CREATE TABLE IF NOT EXISTS binary_objects (
        vault_id text NOT NULL,
        name text NOT NULL,
        content bytea NOT NULL,
        content_hash text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (vault_id, name)
      );
    `)

  }

  async destroy(): Promise<void> {
    const pool = await this.poolPromise
    await pool?.end()
  }

  async createVault(vaultId: string): Promise<void> {
    const pool = await this.getPool()
    await pool.query('INSERT INTO vaults (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [vaultId])
  }

  async hasVault(vaultId: string): Promise<boolean> {
    const pool = await this.getPool()
    const result = await pool.query('SELECT 1 FROM vaults WHERE id = $1', [vaultId])
    return result.rows.length > 0
  }

  async listVaults(): Promise<string[]> {
    const pool = await this.getPool()
    const result = await pool.query('SELECT id FROM vaults ORDER BY id')
    return result.rows.map((row) => String(row.id))
  }

  async listDocuments(vaultId: string): Promise<string[]> {
    const pool = await this.getPool()
    const result = await pool.query(`
      SELECT name FROM documents WHERE vault_id = $1
      UNION
      SELECT DISTINCT name FROM document_updates WHERE vault_id = $1
      ORDER BY name
    `, [vaultId])
    return result.rows.map((row) => String(row.name))
  }

  async loadDocument(vaultId: string, documentId: string): Promise<{ state: Uint8Array | null; updates: Uint8Array[] }> {
    const pool = await this.getPool()
    const snapshot = await pool.query(
      'SELECT state FROM documents WHERE vault_id = $1 AND name = $2',
      [vaultId, documentId],
    )
    const updates = await pool.query(
      'SELECT update_blob FROM document_updates WHERE vault_id = $1 AND name = $2 ORDER BY seq',
      [vaultId, documentId],
    )

    return {
      state: snapshot.rows[0]?.state ? new Uint8Array(snapshot.rows[0].state as Buffer) : null,
      updates: updates.rows.map((row) => new Uint8Array(row.update_blob as Buffer)),
    }
  }

  async appendUpdate(vaultId: string, documentId: string, update: Uint8Array): Promise<void> {
    const pool = await this.getPool()
    await pool.query(
      'INSERT INTO document_updates (vault_id, name, update_blob) VALUES ($1, $2, $3)',
      [vaultId, documentId, Buffer.from(update)],
    )
  }

  async storeDocument(vaultId: string, documentId: string, state: Uint8Array): Promise<void> {
    const pool = await this.getPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM document_updates WHERE vault_id = $1 AND name = $2', [vaultId, documentId])
      await client.query(`
        INSERT INTO documents (vault_id, name, state, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (vault_id, name) DO UPDATE
        SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
      `, [vaultId, documentId, Buffer.from(state)])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async getPool(): Promise<PgPool> {
    if (!this.poolPromise) {
      this.poolPromise = import('pg').then((pgModule) => {
        const Pool = (pgModule as unknown as { Pool: new (config: { connectionString: string; max: number }) => PgPool }).Pool
        return new Pool({
          connectionString: this.config.url,
          max: this.config.poolSize,
        })
      })
    }

    return this.poolPromise
  }
}
