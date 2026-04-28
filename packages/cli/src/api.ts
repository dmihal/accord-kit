// Thin REST client for the AccordKit identity API.

export class ApiClient {
  constructor(
    private readonly serverUrl: string,
    private readonly key?: string,
  ) {}

  private httpBase(): string {
    // Convert ws(s):// to http(s)://
    return this.serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.httpBase()}${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.key) headers['Authorization'] = `Bearer ${this.key}`

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 204) return undefined as T

    const data = await res.json() as unknown
    if (!res.ok) {
      const msg = (data as { error?: string })?.error ?? `HTTP ${res.status}`
      throw new ApiError(res.status, msg)
    }

    return data as T
  }

  async redeem(code: string, name: string): Promise<{ key: string; identityId: string; vaultId: string }> {
    return this.request('POST', '/auth/redeem', { code, name })
  }

  async whoami(): Promise<{ identityId: string; name: string; vaults: Array<{ id: string; name: string }> }> {
    return this.request('GET', '/auth/whoami')
  }

  async createVault(name: string): Promise<{ vaultId: string; name: string }> {
    return this.request('POST', '/vaults', { name })
  }

  async createInvite(vaultId: string, ttlDays?: number): Promise<{ code: string; expiresAt: string }> {
    return this.request('POST', `/vaults/${vaultId}/invites`, { ttlDays })
  }

  async listInvites(vaultId: string): Promise<Array<{ code: string; createdBy: string; expiresAt: string; redeemedBy: string | null }>> {
    return this.request('GET', `/vaults/${vaultId}/invites`)
  }

  async deleteInvite(vaultId: string, code: string): Promise<void> {
    return this.request('DELETE', `/vaults/${vaultId}/invites/${encodeURIComponent(code)}`)
  }

  async listMembers(vaultId: string): Promise<Array<{ identityId: string; name: string; grantedBy: string; grantedAt: string }>> {
    return this.request('GET', `/vaults/${vaultId}/members`)
  }

  async revokeMember(vaultId: string, identityId: string): Promise<void> {
    return this.request('DELETE', `/vaults/${vaultId}/members/${encodeURIComponent(identityId)}`)
  }

  async listIdentities(): Promise<Array<{ id: string; name: string; isAdmin: boolean; createdAt: string; vaults: Array<{ id: string; name: string }> }>> {
    return this.request('GET', '/identities')
  }

  async revokeIdentity(id: string): Promise<void> {
    return this.request('DELETE', `/identities/${encodeURIComponent(id)}`)
  }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}
