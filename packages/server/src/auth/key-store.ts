import { createHash, randomBytes } from 'node:crypto'

// Use any to avoid requiring @types/better-sqlite3 as a direct dependency;
// the runtime value comes from @hocuspocus/extension-sqlite which already bundles it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface Identity {
  id: string
  name: string
  keyHash: string
  isAdmin: boolean
  createdAt: string
  revokedAt: string | null
}

export interface Vault {
  id: string
  name: string
  createdAt: string
  createdBy: string | null
}

export interface VaultMember {
  identityId: string
  name: string
  grantedBy: string
  grantedAt: string
}

export interface InviteCode {
  code: string
  vaultId: string
  createdBy: string
  createdAt: string
  expiresAt: string
  redeemedAt: string | null
  redeemedBy: string | null
}

export function generateKey(): string {
  return 'accord_sk_' + randomBytes(32).toString('base64url')
}

export function generateInviteCode(): string {
  return 'accord_inv_' + randomBytes(24).toString('base64url')
}

export function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

function generateId(): string {
  return randomBytes(12).toString('hex')
}

function nowIso(): string {
  return new Date().toISOString()
}

export function runMigrations(db: Db): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS identities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL UNIQUE,
      is_admin    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS vaults (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_by  TEXT REFERENCES identities(id)
    );

    CREATE TABLE IF NOT EXISTS vault_access (
      identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
      vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
      granted_by  TEXT NOT NULL REFERENCES identities(id),
      granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (identity_id, vault_id)
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code        TEXT PRIMARY KEY,
      vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
      created_by  TEXT NOT NULL REFERENCES identities(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      redeemed_at TEXT,
      redeemed_by TEXT REFERENCES identities(id)
    );

    CREATE INDEX IF NOT EXISTS invite_codes_vault ON invite_codes (vault_id);
  `)
}

export class KeyStore {
  constructor(private db: Db) {
    db.pragma('foreign_keys = ON')
  }

  isInitialized(): boolean {
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM identities').get() as { n: number }
      return row.n > 0
    } catch {
      return false
    }
  }

  createVault(name: string, createdBy: string | null): Vault {
    const id = generateId()
    const now = nowIso()
    this.db.prepare(
      'INSERT INTO vaults (id, name, created_at, created_by) VALUES (?, ?, ?, ?)',
    ).run(id, name, now, createdBy)
    return { id, name, createdAt: now, createdBy }
  }

  getVault(id: string): Vault | null {
    return this.db.prepare('SELECT id, name, created_at AS createdAt, created_by AS createdBy FROM vaults WHERE id = ?').get(id) as Vault | null
  }

  getVaultByName(name: string): Vault | null {
    return this.db.prepare('SELECT id, name, created_at AS createdAt, created_by AS createdBy FROM vaults WHERE name = ?').get(name) as Vault | null
  }

  listVaultsForIdentity(identityId: string): Vault[] {
    return this.db.prepare(`
      SELECT v.id, v.name, v.created_at AS createdAt, v.created_by AS createdBy
      FROM vaults v
      JOIN vault_access va ON va.vault_id = v.id
      WHERE va.identity_id = ?
      ORDER BY v.name
    `).all(identityId) as Vault[]
  }

  createIdentity(name: string, rawKey: string, isAdmin = false): Identity {
    const id = generateId()
    const now = nowIso()
    const keyHash = hashKey(rawKey)
    this.db.prepare(
      'INSERT INTO identities (id, name, key_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, keyHash, isAdmin ? 1 : 0, now)
    return { id, name, keyHash, isAdmin, createdAt: now, revokedAt: null }
  }

  getIdentityByKey(rawKey: string): Identity | null {
    const hash = hashKey(rawKey)
    const row = this.db.prepare(`
      SELECT id, name, key_hash AS keyHash, is_admin AS isAdmin, created_at AS createdAt, revoked_at AS revokedAt
      FROM identities WHERE key_hash = ?
    `).get(hash) as (Identity & { isAdmin: number | boolean }) | null
    if (!row) return null
    return { ...row, isAdmin: Boolean(row.isAdmin) }
  }

  getIdentityById(id: string): Identity | null {
    const row = this.db.prepare(`
      SELECT id, name, key_hash AS keyHash, is_admin AS isAdmin, created_at AS createdAt, revoked_at AS revokedAt
      FROM identities WHERE id = ?
    `).get(id) as (Identity & { isAdmin: number | boolean }) | null
    if (!row) return null
    return { ...row, isAdmin: Boolean(row.isAdmin) }
  }

  listIdentities(): Identity[] {
    return (this.db.prepare(`
      SELECT id, name, key_hash AS keyHash, is_admin AS isAdmin, created_at AS createdAt, revoked_at AS revokedAt
      FROM identities ORDER BY created_at
    `).all() as (Identity & { isAdmin: number | boolean })[]).map(r => ({ ...r, isAdmin: Boolean(r.isAdmin) }))
  }

  revokeIdentity(id: string): void {
    this.db.prepare('UPDATE identities SET revoked_at = ? WHERE id = ?').run(nowIso(), id)
  }

  grantVaultAccess(identityId: string, vaultId: string, grantedBy: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO vault_access (identity_id, vault_id, granted_by, granted_at) VALUES (?, ?, ?, ?)
    `).run(identityId, vaultId, grantedBy, nowIso())
  }

  hasVaultAccess(identityId: string, vaultId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS ok FROM vault_access WHERE identity_id = ? AND vault_id = ?',
    ).get(identityId, vaultId) as { ok: number } | null
    return row !== null
  }

  revokeVaultAccess(identityId: string, vaultId: string): void {
    this.db.prepare('DELETE FROM vault_access WHERE identity_id = ? AND vault_id = ?').run(identityId, vaultId)
  }

  listMembers(vaultId: string): VaultMember[] {
    return this.db.prepare(`
      SELECT va.identity_id AS identityId, i.name, va.granted_by AS grantedBy, va.granted_at AS grantedAt
      FROM vault_access va
      JOIN identities i ON i.id = va.identity_id
      WHERE va.vault_id = ? AND i.revoked_at IS NULL
      ORDER BY va.granted_at
    `).all(vaultId) as VaultMember[]
  }

  createInvite(vaultId: string, createdBy: string, ttlDays: number): InviteCode {
    const code = generateInviteCode()
    const now = nowIso()
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
    this.db.prepare(`
      INSERT INTO invite_codes (code, vault_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
    `).run(code, vaultId, createdBy, now, expiresAt)
    return { code, vaultId, createdBy, createdAt: now, expiresAt, redeemedAt: null, redeemedBy: null }
  }

  getInvite(code: string): InviteCode | null {
    return this.db.prepare(`
      SELECT code, vault_id AS vaultId, created_by AS createdBy, created_at AS createdAt,
             expires_at AS expiresAt, redeemed_at AS redeemedAt, redeemed_by AS redeemedBy
      FROM invite_codes WHERE code = ?
    `).get(code) as InviteCode | null
  }

  listInvites(vaultId: string): (InviteCode & { createdByName: string; redeemedByName: string | null })[] {
    return this.db.prepare(`
      SELECT ic.code, ic.vault_id AS vaultId, ic.created_by AS createdBy, ic.created_at AS createdAt,
             ic.expires_at AS expiresAt, ic.redeemed_at AS redeemedAt, ic.redeemed_by AS redeemedBy,
             c.name AS createdByName, r.name AS redeemedByName
      FROM invite_codes ic
      JOIN identities c ON c.id = ic.created_by
      LEFT JOIN identities r ON r.id = ic.redeemed_by
      WHERE ic.vault_id = ?
      ORDER BY ic.created_at DESC
    `).all(vaultId) as (InviteCode & { createdByName: string; redeemedByName: string | null })[]
  }

  deleteInvite(code: string): void {
    this.db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code)
  }

  /**
   * Atomically redeem an invite code.
   * If an existing identity key is provided, grant vault access to it.
   * Otherwise create a new identity, grant access, return both the identity and key.
   */
  redeemInvite(
    code: string,
    name: string,
    existingKey: string | null,
  ): { key: string; identityId: string; vaultId: string; isNew: boolean } {
    const invite = this.getInvite(code)
    if (!invite) throw new RedeemError('invalid_code', 'Invite code not found')
    if (invite.redeemedAt) throw new RedeemError('already_redeemed', 'Invite code already redeemed')
    if (new Date(invite.expiresAt) < new Date()) throw new RedeemError('expired', 'Invite code has expired')

    return this.db.transaction(() => {
      let identityId: string
      let key: string
      let isNew: boolean

      if (existingKey) {
        const existing = this.getIdentityByKey(existingKey)
        if (!existing || existing.revokedAt) {
          throw new RedeemError('invalid_key', 'Existing key not recognized')
        }
        identityId = existing.id
        key = existingKey
        isNew = false
      } else {
        key = generateKey()
        const identity = this.createIdentity(name, key)
        identityId = identity.id
        isNew = true
      }

      this.grantVaultAccess(identityId, invite.vaultId, invite.createdBy)
      this.db.prepare('UPDATE invite_codes SET redeemed_at = ?, redeemed_by = ? WHERE code = ?').run(nowIso(), identityId, code)

      return { key, identityId, vaultId: invite.vaultId, isNew }
    })()
  }
}

export class RedeemError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'RedeemError'
  }
}
