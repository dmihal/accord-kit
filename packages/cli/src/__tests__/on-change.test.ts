import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveOnChangePrefix } from '../on-change.js'

describe('resolveOnChangePrefix', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('returns the inline prefix when provided', async () => {
    await expect(resolveOnChangePrefix({ onChangePrefix: 'Inline prefix' })).resolves.toBe('Inline prefix')
  })

  it('reads the prefix from a file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'accord-prefix-'))
    tempDirs.push(dir)
    const prefixPath = path.join(dir, 'prefix.txt')
    await writeFile(prefixPath, 'Prefix from file\nSecond line\n', 'utf8')

    await expect(resolveOnChangePrefix({ onChangePrefixFile: prefixPath })).resolves.toBe('Prefix from file\nSecond line\n')
  })

  it('rejects providing both inline and file prefixes', async () => {
    await expect(
      resolveOnChangePrefix({
        onChangePrefix: 'Inline prefix',
        onChangePrefixFile: '/tmp/prefix.txt',
      }),
    ).rejects.toThrow('Specify either --on-change-prefix or --on-change-prefix-file, not both')
  })
})
