import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AccordObsidianSettingsData {
  serverUrl: string
  userName: string
  apiKey: string
  vaultId: string
  ignoredFolders: string[]
  deletionBehavior: 'trash' | 'delete'
}

export interface InstallObsidianPluginOptions {
  scaffoldIfMissing?: boolean
  settings?: Partial<AccordObsidianSettingsData>
}

const DEFAULT_PLUGIN_SETTINGS: AccordObsidianSettingsData = {
  serverUrl: 'ws://localhost:1234',
  userName: 'Obsidian',
  apiKey: '',
  vaultId: '',
  ignoredFolders: [],
  deletionBehavior: 'trash',
}

export async function installObsidianPlugin(
  vaultPath: string,
  options: InstallObsidianPluginOptions = {},
): Promise<{ pluginDir: string; scaffoldedVault: boolean }> {
  const vault = path.resolve(vaultPath)
  const scaffoldedVault = await ensureObsidianVault(vault, options.scaffoldIfMissing ?? false)
  const obsidianDir = path.join(vault, '.obsidian')
  const pluginDir = path.join(obsidianDir, 'plugins', 'accord-kit')
  await mkdir(pluginDir, { recursive: true })

  const pluginDistDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin-dist')
  await copyFile(path.join(pluginDistDir, 'main.js'), path.join(pluginDir, 'main.js'))
  await copyFile(path.join(pluginDistDir, 'manifest.json'), path.join(pluginDir, 'manifest.json'))

  const communityPluginsPath = path.join(obsidianDir, 'community-plugins.json')
  let enabled: string[] = []
  try {
    enabled = JSON.parse(await readFile(communityPluginsPath, 'utf8')) as string[]
  } catch {
    // Fresh vaults may not have the file yet.
  }
  if (!enabled.includes('accord-kit')) {
    enabled.push('accord-kit')
    await writeFile(communityPluginsPath, JSON.stringify(enabled, null, 2) + '\n', 'utf8')
  }

  if (options.settings) {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      ...options.settings,
    }
    await writeFile(path.join(pluginDir, 'data.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8')
  }

  return { pluginDir, scaffoldedVault }
}

async function ensureObsidianVault(vaultPath: string, scaffoldIfMissing: boolean): Promise<boolean> {
  const exists = await pathExists(vaultPath)
  if (!exists) {
    if (!scaffoldIfMissing) {
      throw new Error(`path does not exist: ${vaultPath}`)
    }
    await mkdir(path.join(vaultPath, '.obsidian'), { recursive: true })
    return true
  }

  const stats = await stat(vaultPath)
  if (!stats.isDirectory()) {
    throw new Error(`path is not a directory: ${vaultPath}`)
  }

  const obsidianDir = path.join(vaultPath, '.obsidian')
  if (await pathExists(obsidianDir)) {
    return false
  }

  if (!scaffoldIfMissing) {
    throw new Error(`${vaultPath} does not look like an Obsidian vault (no .obsidian directory found)`)
  }

  if (!(await isDirectoryEmpty(vaultPath))) {
    throw new Error(`${vaultPath} exists but is not empty and has no .obsidian directory`)
  }

  await mkdir(obsidianDir, { recursive: true })
  return true
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function isDirectoryEmpty(targetPath: string): Promise<boolean> {
  const entries = await readdir(targetPath)
  return entries.length === 0
}
