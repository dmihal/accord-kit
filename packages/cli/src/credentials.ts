import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export interface Credentials {
  serverUrl: string
  identityId: string
  name: string
  key: string
  activeVaultId?: string
}

function credentialsPath(serverUrl?: string): string {
  const base = path.join(homedir(), '.config', 'accord')
  if (!serverUrl) return path.join(base, 'credentials.json')

  // Per-server file: <host>-<port>.json
  const url = new URL(serverUrl)
  const slug = `${url.hostname}-${url.port || '1234'}`
  return path.join(base, 'credentials', `${slug}.json`)
}

export async function loadCredentials(serverUrl?: string): Promise<Credentials | null> {
  const filePath = credentialsPath(serverUrl)
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const filePath = credentialsPath(creds.serverUrl)
  await mkdir(path.dirname(filePath), { recursive: true })
  const content = JSON.stringify(creds, null, 2) + '\n'
  await writeFile(filePath, content, { mode: 0o600 })
  // Also update the default file so commands without --server work
  const defaultPath = credentialsPath()
  await mkdir(path.dirname(defaultPath), { recursive: true })
  await writeFile(defaultPath, content, { mode: 0o600 })
}

export async function deleteCredentials(serverUrl?: string): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  try {
    await unlink(credentialsPath(serverUrl))
  } catch {
    // already gone
  }
}
