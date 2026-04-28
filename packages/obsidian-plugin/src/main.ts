import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Modal,
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
  apiKey: string
  vaultId: string
  ignoredFolders: string[]
  deletionBehavior: 'trash' | 'delete'
}

const DEFAULT_SETTINGS: AccordKitSettings = {
  serverUrl: 'ws://localhost:1234',
  userName: 'Obsidian',
  apiKey: '',
  vaultId: 'default',
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
      token: this.settings.apiKey || undefined,
      vaultId: this.settings.vaultId || 'default',
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

class RedeemModal extends Modal {
  private code = ''
  private name = ''
  private onRedeem: (code: string, name: string) => void

  constructor(app: App, onRedeem: (code: string, name: string) => void) {
    super(app)
    this.onRedeem = onRedeem
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.createEl('h3', { text: 'Redeem invite code' })

    new Setting(contentEl)
      .setName('Invite code')
      .addText((t) => t.setPlaceholder('accord_inv_...').onChange((v) => { this.code = v.trim() }))

    new Setting(contentEl)
      .setName('Identity name')
      .setDesc('A label for this device, e.g. "My MacBook".')
      .addText((t) => t.setPlaceholder('My MacBook').onChange((v) => { this.name = v.trim() }))

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Redeem')
        .setCta()
        .onClick(() => {
          if (!this.code) { new Notice('Invite code is required.'); return }
          if (!this.name) { new Notice('Identity name is required.'); return }
          this.onRedeem(this.code, this.name)
          this.close()
        }),
    )
  }

  onClose(): void {
    this.contentEl.empty()
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
      .setName('API key')
      .setDesc('Your accord_sk_... key. Leave empty for open (unauthenticated) mode.')
      .addText((text) => {
        text
          .setPlaceholder('accord_sk_...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim()
            await this.plugin.saveSettings()
          })
        text.inputEl.type = 'password'
      })

    new Setting(containerEl)
      .setName('Import invite code')
      .setDesc('Redeem an invite code to get a key from the server.')
      .addButton((btn) =>
        btn.setButtonText('Redeem invite…').onClick(() => {
          new RedeemModal(this.app, async (code, name) => {
            const serverUrl = this.plugin.settings.serverUrl
            if (!serverUrl) { new Notice('Set the server URL first.'); return }

            const httpUrl = serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
            try {
              const res = await fetch(`${httpUrl}/auth/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, name }),
              })
              const data = await res.json() as { key?: string; error?: string }
              if (!res.ok || !data.key) throw new Error(data.error ?? `HTTP ${res.status}`)

              this.plugin.settings.apiKey = data.key
              this.plugin.settings.userName = name
              await this.plugin.saveSettings()
              new Notice('Key saved. AccordKit is now authenticated.')
            } catch (err) {
              new Notice(`Redeem failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          }).open()
        }),
      )

    new Setting(containerEl)
      .setName('Vault')
      .setDesc('The vault name to sync with (default: "default").')
      .addText((text) =>
        text
          .setPlaceholder('default')
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            this.plugin.settings.vaultId = value.trim() || 'default'
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
