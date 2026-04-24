import { readFile } from 'node:fs/promises'
import YAML from 'yaml'

export const DEFAULT_SERVER_ADDRESS = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 1234
export const DEFAULT_SQLITE_PATH = './data.db'
export const DEFAULT_BINARY_STORAGE_DIR = './binary'

export interface AccordServerConfig {
  address: string
  port: number
  persistence: {
    path: string
  }
  binary: {
    storageDir: string
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
    persistence: {
      path: DEFAULT_SQLITE_PATH,
    },
    binary: {
      storageDir: DEFAULT_BINARY_STORAGE_DIR,
    },
    quiet: false,
    verbose: false,
  }
}

export function shouldWarnForUnauthenticatedBind(address: string): boolean {
  return !isLoopbackAddress(address)
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
  const persistencePath = env.ACCORD_SQLITE_PATH ?? env.ACCORD_DB_PATH ?? config.persistence.path
  const storageDir = env.ACCORD_BINARY_STORAGE_DIR ?? env.ACCORD_BINARY_DIR ?? config.binary.storageDir

  return {
    ...config,
    address,
    port: portValue ? parsePort(portValue) : config.port,
    persistence: {
      ...config.persistence,
      path: persistencePath,
    },
    binary: {
      ...config.binary,
      storageDir,
    },
  }
}

function mergeConfig(base: AccordServerConfig, override: Partial<AccordServerConfig>): AccordServerConfig {
  return {
    ...base,
    ...override,
    persistence: {
      ...base.persistence,
      ...override.persistence,
    },
    binary: {
      ...base.binary,
      ...override.binary,
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

function asConfigObject(value: unknown): Partial<AccordServerConfig> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Server config must be an object')
  }

  return value as Partial<AccordServerConfig>
}
