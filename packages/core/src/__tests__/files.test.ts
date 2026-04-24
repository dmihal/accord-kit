import { describe, expect, it } from 'vitest'
import { isBinaryPath, isTextPath } from '../file-types.js'
import { createIgnoreMatcher } from '../ignore.js'

describe('file utilities', () => {
  it('detects binary files by extension', () => {
    expect(isBinaryPath('images/diagram.PNG')).toBe(true)
    expect(isBinaryPath('docs/spec.pdf')).toBe(true)
    expect(isTextPath('notes/meeting.md')).toBe(true)
    expect(isTextPath('config/settings.json')).toBe(true)
  })

  it('respects ignore patterns', () => {
    const matcher = createIgnoreMatcher(['private/', '*.local'])

    expect(matcher.ignores('.DS_Store')).toBe(true)
    expect(matcher.ignores('.git/config')).toBe(true)
    expect(matcher.ignores('.obsidian/workspace.json')).toBe(true)
    expect(matcher.ignores('.accord-trash/notes/deleted.md')).toBe(true)
    expect(matcher.ignores('private/note.md')).toBe(true)
    expect(matcher.ignores('settings.local')).toBe(true)
    expect(matcher.ignores('notes/meeting.md')).toBe(false)
  })
})
