import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from 'obsidian'
import { startAccordWatcher, type AccordWatcher } from '@accord-kit/cli'
import { normalizeDocumentId } from '@accord-kit/core'
import { CursorPresenceManager } from './cursor-presence.js'

interface AccordKitSettings {
  serverUrl: string
  userName: string
  ignoredFolders: string[]
  deletionBehavior: 'trash' | 'delete'
}

const DEFAULT_SETTINGS: AccordKitSettings = {
  serverUrl: 'ws://localhost:1234',
  userName: 'Obsidian',
  ignoredFolders: [],
  deletionBehavior: 'trash',
}

export default class AccordKitPlugin extends Plugin {
  settings!: AccordKitSettings
  private statusBarItem!: HTMLElement
  private watcherPromise: Promise<AccordWatcher | null> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private readonly presence = new CursorPresenceManager()

  async onload(): Promise<void> {
    await this.loadSettings()
    this.statusBarItem = this.addStatusBarItem()
    this.addSettingTab(new AccordKitSettingTab(this.app, this))
    this.addCommand({
      id: 'restart-sync',
      name: 'Restart sync',
      callback: () => void this.restartWatcher(),
    })

    this.registerEditorExtension(this.presence.buildExtension())
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => void this.updateCursorPresence()),
    )

    void this.launchWatcher()
  }

  async onunload(): Promise<void> {
    this.presence.destroy()
    await this.teardownWatcher()
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    void this.restartWatcher()
  }

  restartWatcher(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.teardownWatcher().then(() => void this.launchWatcher())
    }, 300)
  }

  private getVaultPath(): string | null {
    const { adapter } = this.app.vault
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath()
    return null
  }

  private async updateCursorPresence(): Promise<void> {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView)
    const watcher = await this.watcherPromise

    if (!mdView || !watcher) {
      this.presence.setActive(null, null)
      return
    }

    const filePath = mdView.file?.path
    if (!filePath) {
      this.presence.setActive(null, null)
      return
    }

    const documentId = normalizeDocumentId(filePath)
    const provider = watcher.getProvider(documentId) ?? null
    const editorView = (mdView.editor as unknown as { cm?: object }).cm as import('@codemirror/view').EditorView | undefined
    this.presence.setActive(editorView ?? null, provider)
  }

  private launchWatcher(): void {
    const vaultPath = this.getVaultPath()
    if (!vaultPath || !this.settings.serverUrl) {
      this.setStatus('inactive')
      this.watcherPromise = Promise.resolve(null)
      return
    }

    this.setStatus('connecting')
    this.watcherPromise = startAccordWatcher({
      root: vaultPath,
      serverUrl: this.settings.serverUrl,
      userName: this.settings.userName,
      deletionBehavior: this.settings.deletionBehavior,
      ignorePatterns: this.settings.ignoredFolders.map((f) => `${f.replace(/\/$/, '')}/`),
    })
      .then((w) => {
        this.setStatus('syncing')
        void this.updateCursorPresence()
        return w
      })
      .catch((err: unknown) => {
        this.setStatus('error')
        new Notice(
          `AccordKit: failed to connect — ${err instanceof Error ? err.message : String(err)}`,
        )
        this.watcherPromise = null
        return null
      })
  }

  private async teardownWatcher(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.presence.setActive(null, null)
    const p = this.watcherPromise
    this.watcherPromise = null
    const watcher = await p
    await watcher?.stop()
    this.setStatus('inactive')
  }

  private setStatus(state: 'inactive' | 'connecting' | 'syncing' | 'error'): void {
    const labels: Record<typeof state, string> = {
      inactive: '',
      connecting: 'AccordKit: connecting…',
      syncing: 'AccordKit ↕',
      error: 'AccordKit: error',
    }
    this.statusBarItem.setText(labels[state])
  }
}

class AccordKitSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AccordKitPlugin,
  ) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('WebSocket URL of your AccordKit server (e.g. ws://localhost:1234).')
      .addText((text) =>
        text
          .setPlaceholder('ws://localhost:1234')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('User name')
      .setDesc('Your name as displayed in collaborative editing sessions.')
      .addText((text) =>
        text
          .setPlaceholder('Obsidian')
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('Deletion behavior')
      .setDesc('What happens to local files when a remote deletion is received.')
      .addDropdown((drop) =>
        drop
          .addOption('trash', 'Move to .accord-trash')
          .addOption('delete', 'Delete permanently')
          .setValue(this.plugin.settings.deletionBehavior)
          .onChange(async (value) => {
            this.plugin.settings.deletionBehavior = value as 'trash' | 'delete'
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('Ignored folders')
      .setDesc('Folder names to exclude from sync, one per line (e.g. Templates).')
      .addTextArea((text) => {
        text
          .setPlaceholder('Templates\nArchive')
          .setValue(this.plugin.settings.ignoredFolders.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.ignoredFolders = value
              .split('\n')
              .map((f) => f.trim())
              .filter((f) => f.length > 0)
            await this.plugin.saveSettings()
          })
        text.inputEl.rows = 5
      })
  }
}
