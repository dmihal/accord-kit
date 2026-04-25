import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultServerConfig,
  isLoopbackAddress,
  loadServerConfig,
  shouldWarnForUnauthenticatedBind,
} from '../config.js'

describe('server config', () => {
  it('defaults to localhost-only server settings', () => {
    expect(defaultServerConfig()).toEqual({
      address: '127.0.0.1',
      port: 1234,
      persistence: {
        path: './data.db',
      },
      binary: {
        storageDir: './binary',
      },
      quiet: false,
      verbose: false,
    })
  })

  it('loads YAML config files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'accord-config-'))
    const configPath = join(dir, 'server.yaml')
    await writeFile(
      configPath,
      [
        'address: 127.0.0.2',
        'port: 4321',
        'persistence:',
        '  path: ./custom.db',
        'binary:',
        '  storageDir: ./files',
        'quiet: true',
      ].join('\n'),
    )

    await expect(loadServerConfig({ configPath, env: {} })).resolves.toEqual({
      address: '127.0.0.2',
      port: 4321,
      persistence: {
        path: './custom.db',
      },
      binary: {
        storageDir: './files',
      },
      quiet: true,
      verbose: false,
    })
  })

  it('lets environment variables override file config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'accord-config-'))
    const configPath = join(dir, 'server.json')
    await writeFile(configPath, JSON.stringify({ address: '127.0.0.2', port: 4321 }))

    await expect(
      loadServerConfig({
        configPath,
        env: {
          ACCORD_ADDRESS: '127.0.0.3',
          ACCORD_PORT: '5555',
          ACCORD_DB_PATH: './env.db',
          ACCORD_BINARY_DIR: './env-binary',
        },
      }),
    ).resolves.toMatchObject({
      address: '127.0.0.3',
      port: 5555,
      persistence: {
        path: './env.db',
      },
      binary: {
        storageDir: './env-binary',
      },
    })
  })

  it('validates port overrides', async () => {
    await expect(loadServerConfig({ env: { ACCORD_PORT: '99999' } })).rejects.toThrow(/Invalid server port/)
    await expect(loadServerConfig({ env: { ACCORD_PORT: 'abc' } })).rejects.toThrow(/Invalid server port/)
  })

  it('warns for non-loopback unauthenticated bind addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('localhost')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(shouldWarnForUnauthenticatedBind('127.0.0.1')).toBe(false)
    expect(shouldWarnForUnauthenticatedBind('100.64.0.1')).toBe(true)
    expect(shouldWarnForUnauthenticatedBind('0.0.0.0')).toBe(true)
  })
})
