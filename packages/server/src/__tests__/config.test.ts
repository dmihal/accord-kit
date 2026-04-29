import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultServerConfig,
  isLoopbackAddress,
  loadServerConfig,
  shouldWarnForOpenBind,
} from '../config.js'

describe('server config', () => {
  it('defaults to localhost-only server settings', () => {
    expect(defaultServerConfig()).toEqual({
      address: '127.0.0.1',
      port: 1234,
      auth: {
        mode: 'open',
        jwt: {
          publicKeys: [],
        },
      },
      storage: {
        driver: 'sqlite',
        sqlite: {
          path: './data.db',
        },
        postgres: {
          url: '',
          poolSize: 10,
        },
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
        'auth:',
        '  mode: jwt',
        '  jwt:',
        '    issuer: accord-kit',
        '    publicKeys: []',
        'storage:',
        '  driver: sqlite',
        '  sqlite:',
        '    path: ./custom.db',
        'quiet: true',
      ].join('\n'),
    )

    await expect(loadServerConfig({ configPath, env: {} })).resolves.toEqual({
      address: '127.0.0.2',
      port: 4321,
      auth: {
        mode: 'jwt',
        jwt: {
          issuer: 'accord-kit',
          audience: undefined,
          publicKeys: [],
        },
      },
      storage: {
        driver: 'sqlite',
        sqlite: {
          path: './custom.db',
        },
        postgres: {
          url: '',
          poolSize: 10,
        },
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
          ACCORD_STORAGE_DRIVER: 'postgres',
          ACCORD_PG_URL: 'postgres://localhost:5432/accord',
          ACCORD_PG_POOL_SIZE: '15',
          ACCORD_AUTH_MODE: 'key',
        },
      }),
    ).resolves.toMatchObject({
      address: '127.0.0.3',
      port: 5555,
      auth: {
        mode: 'key',
      },
      storage: {
        driver: 'postgres',
        postgres: {
          url: 'postgres://localhost:5432/accord',
          poolSize: 15,
        },
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
    expect(shouldWarnForOpenBind(defaultServerConfig())).toBe(false)
    expect(shouldWarnForOpenBind({ ...defaultServerConfig(), address: '100.64.0.1' })).toBe(true)
    expect(shouldWarnForOpenBind({ ...defaultServerConfig(), address: '0.0.0.0' })).toBe(true)
    expect(
      shouldWarnForOpenBind({
        ...defaultServerConfig(),
        address: '0.0.0.0',
        auth: {
          mode: 'jwt',
          jwt: {
            publicKeys: [{ kid: 'test', algorithm: 'ES256', publicKeyPath: './test.pub' }],
          },
        },
      }),
    ).toBe(false)
    expect(
      shouldWarnForOpenBind({
        ...defaultServerConfig(),
        address: '0.0.0.0',
        auth: {
          mode: 'key',
          jwt: {
            publicKeys: [],
          },
        },
      }),
    ).toBe(false)
  })
})
