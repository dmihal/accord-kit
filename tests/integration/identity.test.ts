import { describe, it, expect, afterEach } from 'vitest'
import { startAuthTestServer, startTestServer, type AuthTestServer, type TestServer } from './helpers/server.js'
import { generateKey } from '@accord-kit/server'

let srv: TestServer | AuthTestServer | null = null

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

describe('vault bootstrap', () => {
  it('creates a first identity and vault without prior auth', async () => {
    srv = await startTestServer({ authMode: 'key', vaults: [] })

    const { data, status } = await post(`${srv.httpUrl}/vaults`, {
      name: 'myteam',
      userName: "Alice's laptop",
    })
    expect(status).toBe(200)

    const created = data as {
      key: string
      identityId: string
      userName: string
      vaultId: string
      name: string
    }
    expect(created.key).toMatch(/^accord_sk_/)
    expect(created.userName).toBe("Alice's laptop")
    expect(created.name).toBe('myteam')

    const me = await get(`${srv.httpUrl}/auth/whoami`, created.key)
    expect(me.status).toBe(200)
    expect(me.data).toEqual({
      identityId: created.identityId,
      name: "Alice's laptop",
      vaults: [{ id: created.vaultId, name: 'myteam' }],
    })
  })

  it('requires a user name when bootstrapping a vault anonymously', async () => {
    srv = await startTestServer({ authMode: 'key', vaults: [] })

    const res = await post(`${srv.httpUrl}/vaults`, { name: 'myteam' })
    expect(res.status).toBe(400)
    expect((res.data as { error: string }).error).toMatch(/userName required/i)
  })
})

describe('invite + redeem', () => {
  it('creates a new identity when redeeming with no existing key', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const invRes = await post(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, { ttlDays: 1 }, authSrv.userKey)
    expect(invRes.status).toBe(200)
    const { code } = invRes.data as { code: string }

    const redeemRes = await post(`${authSrv.httpUrl}/auth/redeem`, { code, name: "Bob's laptop" })
    expect(redeemRes.status).toBe(200)
    const { key, identityId, vaultId } = redeemRes.data as { key: string; identityId: string; vaultId: string }

    expect(key).toMatch(/^accord_sk_/)
    expect(identityId).toBeTruthy()
    expect(vaultId).toBe(authSrv.vaultId)

    const meRes = await get(`${authSrv.httpUrl}/auth/whoami`, key)
    expect(meRes.status).toBe(200)
    const me = meRes.data as { name: string }
    expect(me.name).toBe("Bob's laptop")
  })

  it('refuses to redeem an already-redeemed code', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const invRes = await post(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, { ttlDays: 1 }, authSrv.userKey)
    const { code } = invRes.data as { code: string }

    await post(`${authSrv.httpUrl}/auth/redeem`, { code, name: 'First' })
    const second = await post(`${authSrv.httpUrl}/auth/redeem`, { code, name: 'Second' })
    expect(second.status).toBe(400)
    expect((second.data as { error: string }).error).toMatch(/already redeemed/i)
  })

  it('refuses to redeem an expired code', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const expiredCode = authSrv.store.createInvite(
      authSrv.vaultId,
      authSrv.userId,
      -1,
    )

    const res = await post(`${authSrv.httpUrl}/auth/redeem`, { code: expiredCode.code, name: 'Late' })
    expect(res.status).toBe(400)
    expect((res.data as { error: string }).error).toMatch(/expired/i)
  })

  it('adds vault access to an existing identity when a key is provided', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const bobKey = generateKey()
    const bobId = authSrv.store.createIdentity("Bob's device", bobKey).id
    const bobVault = authSrv.store.createVault('bobvault', authSrv.userId)
    authSrv.store.grantVaultAccess(bobId, bobVault.id, authSrv.userId)

    const invRes = await post(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, { ttlDays: 1 }, authSrv.userKey)
    const { code } = invRes.data as { code: string }

    const redeemRes = await fetch(`${authSrv.httpUrl}/auth/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobKey}` },
      body: JSON.stringify({ code, name: 'ignored' }),
    })

    expect(redeemRes.status).toBe(200)
    const redeemBody = await redeemRes.json() as { key: string; identityId: string; vaultId: string; isNew: boolean }
    expect(redeemBody.key).toBe(bobKey)
    expect(redeemBody.identityId).toBe(bobId)
    expect(redeemBody.vaultId).toBe(authSrv.vaultId)
    expect(redeemBody.isNew).toBe(false)

    const whoami = await get(`${authSrv.httpUrl}/auth/whoami`, bobKey)
    const vaultIds = (whoami.data as { vaults: Array<{ id: string }> }).vaults.map((vault) => vault.id)
    expect(vaultIds).toContain(bobVault.id)
    expect(vaultIds).toContain(authSrv.vaultId)
  })
})

describe('vault management', () => {
  it('creates a vault and grants access to the authenticated creator', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const res = await post(`${authSrv.httpUrl}/vaults`, { name: 'myteam' }, authSrv.userKey)
    expect(res.status).toBe(200)
    const { vaultId } = res.data as { vaultId: string }

    const me = await get(`${authSrv.httpUrl}/auth/whoami`, authSrv.userKey)
    const vaults = (me.data as { vaults: Array<{ id: string }> }).vaults
    expect(vaults.map((vault) => vault.id)).toContain(vaultId)
  })

  it('lists members of a vault', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const members = await get(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/members`, authSrv.userKey)
    expect(members.status).toBe(200)
    const list = members.data as Array<{ name: string }>
    expect(list.some((member) => member.name === 'owner')).toBe(true)
  })
})

describe('invite management', () => {
  it('lists and deletes invites', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer

    const inv = await post(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, {}, authSrv.userKey)
    const { code } = inv.data as { code: string }

    const list = await get(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, authSrv.userKey)
    expect(list.status).toBe(200)
    const codes = (list.data as Array<{ code: string }>).map((invite) => invite.code)
    expect(codes).toContain(code)

    const deleteStatus = await del(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites/${encodeURIComponent(code)}`, authSrv.userKey)
    expect(deleteStatus).toBe(204)

    const after = await get(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/invites`, authSrv.userKey)
    const afterCodes = (after.data as Array<{ code: string }>).map((invite) => invite.code)
    expect(afterCodes).not.toContain(code)
  })
})

describe('auth rejection', () => {
  it('rejects requests without a key', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer
    const res = await get(`${authSrv.httpUrl}/auth/whoami`)
    expect(res.status).toBe(401)
  })

  it('rejects requests with an invalid key', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer
    const res = await get(`${authSrv.httpUrl}/auth/whoami`, 'accord_sk_totallyinvalid')
    expect(res.status).toBe(401)
  })

  it('rejects vault access for non-members', async () => {
    srv = await startAuthTestServer()
    const authSrv = srv as AuthTestServer
    const strangerKey = generateKey()
    authSrv.store.createIdentity('stranger', strangerKey)

    const res = await get(`${authSrv.httpUrl}/vaults/${authSrv.vaultId}/members`, strangerKey)
    expect(res.status).toBe(403)
  })
})
