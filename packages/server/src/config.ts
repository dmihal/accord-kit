import { readFile } from 'node:fs/promises'
import YAML from 'yaml'

export const DEFAULT_SERVER_ADDRESS = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 1234
export const DEFAULT_SQLITE_PATH = './data.db'
export const DEFAULT_POSTGRES_POOL_SIZE = 10

export type AuthMode = 'open' | 'key' | 'jwt'

export interface JwtPublicKeyConfig {
  kid: string
  algorithm: 'ES256' | 'RS256'
  publicKeyPath: string
}

export interface AuthConfig {
  mode: AuthMode
  jwt: {
    issuer?: string
    audience?: string
    publicKeys: JwtPublicKeyConfig[]
  }
}

export interface StorageConfig {
  driver: 'sqlite' | 'postgres'
  sqlite: {
    path: string
  }
  postgres: {
    url: string
    poolSize: number
  }
}

export interface AccordServerConfig {
  address: string
  port: number
  auth: AuthConfig
  storage: StorageConfig
  cluster?: {
    redisUrl: string
  }
  quiet: boolean
  verbose: boolean
}

export interface LoadServerConfigOptions {
  configPath?: string
  env?: NodeJS.ProcessEnv
}

export async function loadServerConfig(options: LoadServerConfigOptions = {}): Promise<AccordServerConfig> {
  const env = options.env ?? process.env
  const fileConfig = options.configPath ? await readConfigFile(options.configPath) : {}

  return applyEnvOverrides(mergeConfig(defaultServerConfig(), fileConfig), env)
}

export function defaultServerConfig(): AccordServerConfig {
  return {
    address: DEFAULT_SERVER_ADDRESS,
    port: DEFAULT_SERVER_PORT,
    auth: {
      mode: 'open',
      jwt: {
        publicKeys: [],
      },
    },
    storage: {
      driver: 'sqlite',
      sqlite: {
        path: DEFAULT_SQLITE_PATH,
      },
      postgres: {
        url: '',
        poolSize: DEFAULT_POSTGRES_POOL_SIZE,
      },
    },
    quiet: false,
    verbose: false,
  }
}

export function shouldWarnForOpenBind(config: AccordServerConfig): boolean {
  return config.auth.mode === 'open' && !isLoopbackAddress(config.address)
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.startsWith('127.')
  )
}

async function readConfigFile(configPath: string): Promise<Partial<AccordServerConfig>> {
  const content = await readFile(configPath, 'utf8')

  if (configPath.endsWith('.json')) {
    return asConfigObject(JSON.parse(content))
  }

  return asConfigObject(YAML.parse(content))
}

function applyEnvOverrides(config: AccordServerConfig, env: NodeJS.ProcessEnv): AccordServerConfig {
  const address = env.ACCORD_SERVER_ADDRESS ?? env.ACCORD_ADDRESS ?? config.address
  const portValue = env.ACCORD_SERVER_PORT ?? env.ACCORD_PORT
  const authMode = env.ACCORD_AUTH_MODE ?? config.auth.mode
  const jwtIssuer = env.ACCORD_JWT_ISSUER ?? config.auth.jwt.issuer
  const jwtAudience = env.ACCORD_JWT_AUDIENCE ?? config.auth.jwt.audience
  const jwtKeyPath = env.ACCORD_JWT_PUBLIC_KEY_PATH
  const storageDriver = env.ACCORD_STORAGE_DRIVER ?? config.storage.driver
  const sqlitePath = env.ACCORD_SQLITE_PATH ?? env.ACCORD_DB_PATH ?? config.storage.sqlite.path
  const postgresUrl = env.ACCORD_PG_URL ?? config.storage.postgres.url
  const postgresPoolSizeValue = env.ACCORD_PG_POOL_SIZE

  return {
    ...config,
    address,
    port: portValue ? parsePort(portValue) : config.port,
    auth: {
      mode: authMode === 'jwt' ? 'jwt' : authMode === 'key' ? 'key' : 'open',
      jwt: {
        issuer: jwtIssuer,
        audience: jwtAudience,
        publicKeys: jwtKeyPath
          ? [{ kid: env.ACCORD_JWT_KID ?? 'default', algorithm: 'ES256', publicKeyPath: jwtKeyPath }]
          : config.auth.jwt.publicKeys,
      },
    },
    storage: {
      driver: storageDriver === 'postgres' ? 'postgres' : 'sqlite',
      sqlite: {
        path: sqlitePath,
      },
      postgres: {
        url: postgresUrl,
        poolSize: postgresPoolSizeValue ? parsePositiveInt(postgresPoolSizeValue, 'Postgres pool size') : config.storage.postgres.poolSize,
      },
    },
  }
}

function mergeConfig(base: AccordServerConfig, override: Partial<AccordServerConfig>): AccordServerConfig {
  return {
    ...base,
    ...override,
    auth: {
      ...base.auth,
      ...override.auth,
      jwt: {
        ...base.auth.jwt,
        ...override.auth?.jwt,
        publicKeys: override.auth?.jwt?.publicKeys ?? base.auth.jwt.publicKeys,
      },
    },
    storage: {
      ...base.storage,
      ...override.storage,
      sqlite: {
        ...base.storage.sqlite,
        ...override.storage?.sqlite,
      },
      postgres: {
        ...base.storage.postgres,
        ...override.storage?.postgres,
      },
    },
  }
}

function parsePort(value: string): number {
  const port = Number(value)

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid server port "${value}"`)
  }

  return port
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} "${value}"`)
  }

  return parsed
}

function asConfigObject(value: unknown): Partial<AccordServerConfig> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Server config must be an object')
  }

  return value as Partial<AccordServerConfig>
}
