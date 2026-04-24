import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyFileContent } from '../diff.js'

function createText(initialContent = ''): Y.Text {
  const doc = new Y.Doc()
  const text = doc.getText('content')
  if (initialContent.length > 0) text.insert(0, initialContent)
  return text
}

describe('applyFileContent', () => {
  it('inserts new content into empty Y.Text', () => {
    const text = createText()

    applyFileContent(text, 'hello')

    expect(text.toString()).toBe('hello')
  })

  it('appends text to existing content', () => {
    const text = createText('hello')

    applyFileContent(text, 'hello world')

    expect(text.toString()).toBe('hello world')
  })

  it('deletes a range', () => {
    const text = createText('hello world')

    applyFileContent(text, 'hello')

    expect(text.toString()).toBe('hello')
  })

  it('replaces a range', () => {
    const text = createText('hello world')

    applyFileContent(text, 'hello David')

    expect(text.toString()).toBe('hello David')
  })

  it('handles empty string to empty string as a no-op', () => {
    const text = createText()

    applyFileContent(text, '')

    expect(text.toString()).toBe('')
  })

  it('handles unicode content correctly', () => {
    const text = createText('hello')

    applyFileContent(text, 'hello 世界 مرحبا')

    expect(text.toString()).toBe('hello 世界 مرحبا')
  })

  it('handles large content without timeout', () => {
    const text = createText('a'.repeat(100_000))
    const next = `${'a'.repeat(50_000)}middle${'b'.repeat(50_000)}`

    applyFileContent(text, next)

    expect(text.toString()).toBe(next)
  })
})
