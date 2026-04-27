import { describe, expect, it, vi } from 'vitest'
import { createDocumentsRouteExtension } from '../routes.js'

describe('documents route', () => {
  it('lists vault-scoped document IDs as JSON', async () => {
    const extension = createDocumentsRouteExtension({
      auth: {
        authenticateHttp: vi.fn().mockResolvedValue({
          vaultId: 'default',
          userId: 'user-1',
          userName: 'Alice',
          claims: { sub: 'user-1', vaults: ['default'] },
        }),
        listAccessibleVaults: vi.fn(),
      } as never,
      storage: {
        listDocuments: vi.fn().mockResolvedValue(['notes/b.md', 'notes/a.md', '__accord_metadata']),
      } as never,
    })
    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    }

    await expect(
      extension.onRequest?.({
        request: { method: 'GET', url: '/vaults/default/documents', headers: {} } as never,
        response: response as never,
        instance: {} as never,
      }),
    ).rejects.toBeUndefined()

    expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }))
    expect(response.end).toHaveBeenCalledWith('["notes/b.md","notes/a.md"]')
  })
})
