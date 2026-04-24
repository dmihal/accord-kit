import { describe, expect, it, vi } from 'vitest'
import { createDocumentsRouteExtension } from '../routes.js'

describe('documents route', () => {
  it('lists known document IDs as JSON', async () => {
    const extension = createDocumentsRouteExtension({
      documentIds: new Set(['notes/b.md', 'notes/a.md']),
      getPersistedDocumentIds: () => ['notes/c.md', 'notes/a.md'],
    })
    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
    }

    await expect(
      extension.onRequest?.({
        request: { method: 'GET', url: '/documents' } as never,
        response: response as never,
        instance: {} as never,
      }),
    ).rejects.toBeUndefined()

    expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }))
    expect(response.end).toHaveBeenCalledWith('["notes/a.md","notes/b.md","notes/c.md"]')
  })
})
