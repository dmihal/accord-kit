import { describe, it, expect, afterEach } from 'vitest'
import { startAuthTestServer, type AuthTestServer } from './helpers/server.js'
import { generateKey } from '@accord-kit/server'

let srv: AuthTestServer | null = null

afterEach(async () => {
  await srv?.stop()
  srv = null
})

async function post(url: string, body: unknown, key?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json() as unknown }
}

async function get(url: string, key?: string) {
  const headers: Record<string, string> = {}
  if (key) headers['Authorization'] = `Bearer ${key}`
  const res = await fetch(url, { headers })
  return { status: res.status, data: await res.json() as unknown }
}

async function del(url: string, key?: string) {
  const headers: Record<string, string> = {}
  if (key) headers['Authorization'] = `Bearer ${key}`
  const res = await fetch(url, { method: 'DELETE', headers })
  return res.status
}

describe('identity bootstrap', () => {
  it('creates default vault and admin identity', async () => {
    srv = await startAuthTestServer()
    const { data, status } = await get(`${srv.httpUrl}/auth/whoami`, srv.adminKey)
    expect(status).toBe(200)
    const info = data as { identityId: string; name: string; vaults: Array<{ id: string; name: string }> }
    expect(info.identityId).toBe(srv.adminId)
    expect(info.name).toBe('admin')
    expect(info.vaults.map(v => v.name)).toContain('default')
  })
})

describe('invite + redeem', () => {
  it('creates a new identity when redeeming with no existing key', async () => {
    srv = await startAuthTestServer()

    // Admin issues invite
    const invRes = await post(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, { ttlDays: 1 }, srv.adminKey)
    expect(invRes.status).toBe(200)
    const { code } = invRes.data as { code: string }

    // Bob redeems
    const redeemRes = await post(`${srv.httpUrl}/auth/redeem`, { code, name: "Bob's laptop" })
    expect(redeemRes.status).toBe(200)
    const { key, identityId, vaultId } = redeemRes.data as { key: string; identityId: string; vaultId: string }

    expect(key).toMatch(/^accord_sk_/)
    expect(identityId).toBeTruthy()
    expect(vaultId).toBe(srv.defaultVaultId)

    // Bob can whoami
    const meRes = await get(`${srv.httpUrl}/auth/whoami`, key)
    expect(meRes.status).toBe(200)
    const me = meRes.data as { name: string }
    expect(me.name).toBe("Bob's laptop")
  })

  it('refuses to redeem an already-redeemed code', async () => {
    srv = await startAuthTestServer()

    const invRes = await post(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, { ttlDays: 1 }, srv.adminKey)
    const { code } = invRes.data as { code: string }

    await post(`${srv.httpUrl}/auth/redeem`, { code, name: 'First' })
    const second = await post(`${srv.httpUrl}/auth/redeem`, { code, name: 'Second' })
    expect(second.status).toBe(400)
    expect((second.data as { error: string }).error).toMatch(/already redeemed/i)
  })

  it('refuses to redeem an expired code', async () => {
    srv = await startAuthTestServer()

    // Insert an expired invite directly via the store
    const expiredCode = srv.store.createInvite(
      srv.defaultVaultId,
      srv.adminId,
      -1, // negative TTL → already expired
    )

    const res = await post(`${srv.httpUrl}/auth/redeem`, { code: expiredCode.code, name: 'Late' })
    expect(res.status).toBe(400)
    expect((res.data as { error: string }).error).toMatch(/expired/i)
  })

  it('adds vault access to an existing identity when key is provided', async () => {
    srv = await startAuthTestServer()

    // Bob already has a key (minted directly for test simplicity)
    const bobKey = generateKey()
    const bobVault = srv.store.createVault('bobvault', srv.adminId)
    const bobId = srv.store.createIdentity("Bob's device", bobKey).id
    srv.store.grantVaultAccess(bobId, bobVault.id, srv.adminId)

    // Admin invites Bob to the default vault
    const invRes = await post(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, { ttlDays: 1 }, srv.adminKey)
    const { code } = invRes.data as { code: string }

    // Bob redeems with existing key — passes key in Authorization header
    // The redeem endpoint accepts an existing key to identify the caller.
    // We pass the key in the Authorization header (server reads it for existing-key flow).
    const redeemRes = await fetch(`${srv.httpUrl}/auth/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bobKey}` },
      body: JSON.stringify({ code, name: 'ignored' }),
    })

    expect(redeemRes.status).toBe(200)
    const redeemBody = await redeemRes.json() as { key: string; identityId: string; vaultId: string; isNew: boolean }
    expect(redeemBody.key).toBe(bobKey)
    expect(redeemBody.identityId).toBe(bobId)
    expect(redeemBody.vaultId).toBe(srv.defaultVaultId)
    expect(redeemBody.isNew).toBe(false)

    const whoami = await get(`${srv.httpUrl}/auth/whoami`, bobKey)
    const vaultIds = (whoami.data as { vaults: Array<{ id: string }> }).vaults.map((vault) => vault.id)
    expect(vaultIds).toContain(bobVault.id)
    expect(vaultIds).toContain(srv.defaultVaultId)
  })
})

describe('vault management', () => {
  it('creates a vault and grants access to the creator', async () => {
    srv = await startAuthTestServer()

    const res = await post(`${srv.httpUrl}/vaults`, { name: 'myteam' }, srv.adminKey)
    expect(res.status).toBe(200)
    const { vaultId } = res.data as { vaultId: string }

    // Admin should now have access to the new vault
    const me = await get(`${srv.httpUrl}/auth/whoami`, srv.adminKey)
    const vaults = (me.data as { vaults: Array<{ id: string }> }).vaults
    expect(vaults.map(v => v.id)).toContain(vaultId)
  })

  it('lists members of a vault', async () => {
    srv = await startAuthTestServer()

    const members = await get(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/members`, srv.adminKey)
    expect(members.status).toBe(200)
    const list = members.data as Array<{ name: string }>
    expect(list.some(m => m.name === 'admin')).toBe(true)
  })

  it('revokes vault access for a member', async () => {
    srv = await startAuthTestServer()

    // Create second identity and grant access
    const bobKey = generateKey()
    const bobId = srv.store.createIdentity('bob', bobKey).id
    srv.store.grantVaultAccess(bobId, srv.defaultVaultId, srv.adminId)

    // Verify bob has access
    const before = await get(`${srv.httpUrl}/auth/whoami`, bobKey)
    expect((before.data as { vaults: Array<{ id: string }> }).vaults.map(v => v.id)).toContain(srv.defaultVaultId)

    // Admin revokes
    const status = await del(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/members/${bobId}`, srv.adminKey)
    expect(status).toBe(204)

    // Bob no longer has access
    const after = await get(`${srv.httpUrl}/auth/whoami`, bobKey)
    expect((after.data as { vaults: Array<{ id: string }> }).vaults.map(v => v.id)).not.toContain(srv.defaultVaultId)
  })
})

describe('identity revocation', () => {
  it('revokes an identity so its key is rejected', async () => {
    srv = await startAuthTestServer()

    // Create a second identity
    const bobKey = generateKey()
    const bobId = srv.store.createIdentity('bob', bobKey).id
    srv.store.grantVaultAccess(bobId, srv.defaultVaultId, srv.adminId)

    // Bob can authenticate now
    const before = await get(`${srv.httpUrl}/auth/whoami`, bobKey)
    expect(before.status).toBe(200)

    // Admin revokes bob entirely
    const status = await del(`${srv.httpUrl}/identities/${bobId}`, srv.adminKey)
    expect(status).toBe(204)

    // Bob's key is now rejected
    const after = await get(`${srv.httpUrl}/auth/whoami`, bobKey)
    expect(after.status).toBe(401)
  })
})

describe('invite management', () => {
  it('lists and deletes invites', async () => {
    srv = await startAuthTestServer()

    const inv = await post(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, {}, srv.adminKey)
    const { code } = inv.data as { code: string }

    const list = await get(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, srv.adminKey)
    expect(list.status).toBe(200)
    const codes = (list.data as Array<{ code: string }>).map(i => i.code)
    expect(codes).toContain(code)

    // Delete it
    const deleteStatus = await del(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites/${encodeURIComponent(code)}`, srv.adminKey)
    expect(deleteStatus).toBe(204)

    // Gone from list
    const after = await get(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/invites`, srv.adminKey)
    const afterCodes = (after.data as Array<{ code: string }>).map(i => i.code)
    expect(afterCodes).not.toContain(code)
  })
})

describe('auth rejection', () => {
  it('rejects requests without a key', async () => {
    srv = await startAuthTestServer()
    const res = await get(`${srv.httpUrl}/auth/whoami`)
    expect(res.status).toBe(401)
  })

  it('rejects requests with an invalid key', async () => {
    srv = await startAuthTestServer()
    const res = await get(`${srv.httpUrl}/auth/whoami`, 'accord_sk_totallyinvalid')
    expect(res.status).toBe(401)
  })

  it('rejects vault access for non-members', async () => {
    srv = await startAuthTestServer()
    const strangerKey = generateKey()
    srv.store.createIdentity('stranger', strangerKey)

    const res = await get(`${srv.httpUrl}/vaults/${srv.defaultVaultId}/members`, strangerKey)
    expect(res.status).toBe(403)
  })
})
