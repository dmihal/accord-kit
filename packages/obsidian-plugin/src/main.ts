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
import { decodeJoinToken, encodeJoinToken, isValidVaultId, normalizeDocumentId } from '@accord-kit/core'
import { CursorPresenceManager } from './cursor-presence.js'

interface AccordKitSettings {
  serverUrl: string
  userName: string
  apiKey: string
  vaultId: string
  ignoredFolders: string[]
  deletionBehavior: 'trash' | 'delete'
}

interface RedeemResponse {
  key: string
  vaultId: string
}

interface CreateVaultResponse {
  key?: string
  identityId?: string
  userName?: string
  vaultId: string
  name: string
}

interface InviteRecord {
  code: string
  createdBy: string
  expiresAt: string
  redeemedBy: string | null
  redeemedAt?: string | null
}

const DEFAULT_SETTINGS: AccordKitSettings = {
  serverUrl: 'ws://localhost:1234',
  userName: 'Obsidian',
  apiKey: '',
  vaultId: '',
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

  async redeemInvite(input: string, name: string): Promise<void> {
    let serverUrl = this.settings.serverUrl.trim()
    let code = input.trim()

    if (code.startsWith('accord://')) {
      const decoded = decodeJoinToken(code)
      serverUrl = decoded.serverUrl
      code = decoded.inviteCode
      this.settings.serverUrl = decoded.serverUrl
      this.settings.vaultId = decoded.vaultId
    }

    if (!serverUrl) {
      throw new Error('Set the server URL first.')
    }

    const existingKey = this.settings.apiKey.trim()
    const data = await this.requestJson<RedeemResponse>(serverUrl, '/auth/redeem', {
      method: 'POST',
      body: { code, name },
      authKey: existingKey || undefined,
    })

    if (!existingKey) {
      this.settings.userName = name
    }
    this.settings.serverUrl = serverUrl
    this.settings.apiKey = data.key
    this.settings.vaultId = data.vaultId
    await this.saveSettings()
  }

  async createVault(vaultName: string, userName: string): Promise<void> {
    const serverUrl = this.settings.serverUrl.trim()
    if (!serverUrl) {
      throw new Error('Set the server URL first.')
    }

    const existingKey = this.settings.apiKey.trim()
    const data = await this.requestJson<CreateVaultResponse>(serverUrl, '/vaults', {
      method: 'POST',
      body: { name: vaultName, userName },
      authKey: existingKey || undefined,
    })

    this.settings.serverUrl = serverUrl
    this.settings.userName = data.userName ?? userName
    this.settings.apiKey = data.key ?? existingKey
    this.settings.vaultId = data.vaultId
    await this.saveSettings()
  }

  async createInvite(ttlDays?: number): Promise<InviteRecord> {
    this.assertConfigured()
    const result = await this.requestJson<{ code: string; expiresAt: string }>(
      this.settings.serverUrl,
      `/vaults/${encodeURIComponent(this.settings.vaultId)}/invites`,
      {
        method: 'POST',
        body: ttlDays ? { ttlDays } : {},
        authKey: this.settings.apiKey,
      },
    )
    return {
      code: result.code,
      createdBy: this.settings.userName,
      expiresAt: result.expiresAt,
      redeemedBy: null,
    }
  }

  async listInvites(): Promise<InviteRecord[]> {
    this.assertConfigured()
    return this.requestJson<InviteRecord[]>(
      this.settings.serverUrl,
      `/vaults/${encodeURIComponent(this.settings.vaultId)}/invites`,
      {
        method: 'GET',
        authKey: this.settings.apiKey,
      },
    )
  }

  joinTokenForInvite(code: string): string {
    this.assertConfigured()
    return encodeJoinToken({
      serverUrl: this.settings.serverUrl,
      vaultId: this.settings.vaultId,
      inviteCode: code,
    })
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
    if (!vaultPath || !this.settings.serverUrl || !this.settings.vaultId) {
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
      vaultId: this.settings.vaultId,
      deletionBehavior: this.settings.deletionBehavior,
      ignorePatterns: this.settings.ignoredFolders.map((folder) => `${folder.replace(/\/$/, '')}/`),
    })
      .then((watcher) => {
        this.setStatus('syncing')
        void this.updateCursorPresence()
        return watcher
      })
      .catch((error: unknown) => {
        this.setStatus('error')
        new Notice(
          `AccordKit: failed to connect — ${error instanceof Error ? error.message : String(error)}`,
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
    const promise = this.watcherPromise
    this.watcherPromise = null
    const watcher = await promise
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

  private async requestJson<T>(
    serverUrl: string,
    route: string,
    options: {
      method: 'GET' | 'POST'
      body?: unknown
      authKey?: string
    },
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (options.authKey) {
      headers.Authorization = `Bearer ${options.authKey}`
    }

    const response = await fetch(`${toHttpUrl(serverUrl)}${route}`, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    const data = await response.json() as T & { error?: string }
    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`)
    }
    return data
  }

  private assertConfigured(): void {
    if (!this.settings.serverUrl || !this.settings.vaultId) {
      throw new Error('Configure a server URL and vault first.')
    }
  }
}

class RedeemModal extends Modal {
  private code = ''
  private name: string
  private readonly onRedeem: (code: string, name: string) => Promise<void>

  constructor(app: App, initialName: string, onRedeem: (code: string, name: string) => Promise<void>) {
    super(app)
    this.name = initialName
    this.onRedeem = onRedeem
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.createEl('h3', { text: 'Join with invite' })

    new Setting(contentEl)
      .setName('Invite')
      .setDesc('Paste either a raw invite code or an accord:// join token.')
      .addText((text) =>
        text
          .setPlaceholder('accord://example.com/vault?invite=... or accord_inv_...')
          .onChange((value) => { this.code = value.trim() }),
      )

    new Setting(contentEl)
      .setName('Identity name')
      .setDesc('A label for this device, e.g. "My MacBook".')
      .addText((text) =>
        text
          .setPlaceholder('My MacBook')
          .setValue(this.name)
          .onChange((value) => { this.name = value.trim() }),
      )

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText('Join')
        .setCta()
        .onClick(async () => {
          if (!this.code) {
            new Notice('Invite is required.')
            return
          }
          if (!this.name) {
            new Notice('Identity name is required.')
            return
          }
          try {
            await this.onRedeem(this.code, this.name)
            new Notice('Vault access granted.')
            this.close()
          } catch (error) {
            new Notice(`Join failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }),
    )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

class CreateVaultModal extends Modal {
  private readonly onCreate: (vaultName: string, userName: string) => Promise<void>
  private vaultName = ''
  private userName: string

  constructor(app: App, initialUserName: string, onCreate: (vaultName: string, userName: string) => Promise<void>) {
    super(app)
    this.userName = initialUserName
    this.onCreate = onCreate
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.createEl('h3', { text: 'Create a new vault' })

    new Setting(contentEl)
      .setName('Vault name')
      .setDesc('A human-readable name for the vault.')
      .addText((text) =>
        text
          .setPlaceholder('My Vault')
          .onChange((value) => { this.vaultName = value.trim() }),
      )

    new Setting(contentEl)
      .setName('Identity name')
      .setDesc('How this device appears to collaborators.')
      .addText((text) =>
        text
          .setPlaceholder('My MacBook')
          .setValue(this.userName)
          .onChange((value) => { this.userName = value.trim() }),
      )

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText('Create')
        .setCta()
        .onClick(async () => {
          if (!this.vaultName) {
            new Notice('Vault name is required.')
            return
          }
          if (!this.userName) {
            new Notice('Identity name is required.')
            return
          }
          try {
            await this.onCreate(this.vaultName, this.userName)
            new Notice('Vault created and connected.')
            this.close()
          } catch (error) {
            new Notice(`Create failed: ${error instanceof Error ? error.message : String(error)}`)
          }
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

    const onboardingTitle = containerEl.createEl('h3', {
      text: this.plugin.settings.vaultId ? 'Vault access' : 'Onboarding',
    })
    onboardingTitle.addClass('accord-kit-section-title')

    new Setting(containerEl)
      .setName('Create a new vault')
      .setDesc('Create your first vault or add another vault to this identity.')
      .addButton((button) =>
        button.setButtonText('Create vault…').setCta().onClick(() => {
          new CreateVaultModal(
            this.app,
            this.plugin.settings.userName,
            async (vaultName, userName) => {
              await this.plugin.createVault(vaultName, userName)
              this.display()
            },
          ).open()
        }),
      )

    new Setting(containerEl)
      .setName('Join with an invite')
      .setDesc('Redeem a vault invite code or join link.')
      .addButton((button) =>
        button.setButtonText('Join vault…').onClick(() => {
          new RedeemModal(
            this.app,
            this.plugin.settings.userName,
            async (code, name) => {
              await this.plugin.redeemInvite(code, name)
              this.display()
            },
          ).open()
        }),
      )

    new Setting(containerEl)
      .setName('API key')
      .setDesc('Your accord_sk_... key. Leave empty for open mode.')
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
      .setName('Vault ID')
      .setDesc('Vault identifier to sync with. Join and create flows set this automatically.')
      .addText((text) => {
        text
          .setPlaceholder('team-notes')
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            const trimmed = value.trim()
            if (trimmed && !isValidVaultId(trimmed)) {
              text.inputEl.setCustomValidity('Only lowercase letters, digits, hyphens, and underscores allowed.')
              text.inputEl.reportValidity()
              return
            }
            text.inputEl.setCustomValidity('')
            this.plugin.settings.vaultId = trimmed
            await this.plugin.saveSettings()
          })
        return text
      })

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

    if (this.plugin.settings.apiKey && this.plugin.settings.vaultId) {
      this.renderInvitesSection(containerEl)
    }

    new Setting(containerEl)
      .setName('Deletion behavior')
      .setDesc('What happens to local files when a remote deletion is received.')
      .addDropdown((dropdown) =>
        dropdown
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
              .map((folder) => folder.trim())
              .filter((folder) => folder.length > 0)
            await this.plugin.saveSettings()
          })
        text.inputEl.rows = 5
      })
  }

  private renderInvitesSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Invites' })
    const latestContainer = containerEl.createDiv()
    const listContainer = containerEl.createDiv()

    new Setting(containerEl)
      .setName('Generate invite')
      .setDesc('Create a shareable accord:// join link for this vault.')
      .addButton((button) =>
        button.setButtonText('Generate invite').onClick(async () => {
          try {
            const invite = await this.plugin.createInvite()
            this.renderLatestInvite(latestContainer, invite)
            await this.renderInviteList(listContainer)
          } catch (error) {
            new Notice(`Invite failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }),
      )

    void this.renderInviteList(listContainer)
  }

  private renderLatestInvite(containerEl: HTMLElement, invite: InviteRecord): void {
    containerEl.empty()
    const joinToken = this.plugin.joinTokenForInvite(invite.code)
    containerEl.createEl('p', { text: `Latest invite expires ${invite.expiresAt}` })

    new Setting(containerEl)
      .setName(joinToken)
      .addButton((button) =>
        button.setButtonText('Copy link').onClick(async () => {
          await copyText(joinToken)
          new Notice('Join link copied.')
        }),
      )
      .addButton((button) =>
        button.setButtonText('Copy code').onClick(async () => {
          await copyText(invite.code)
          new Notice('Invite code copied.')
        }),
      )
  }

  private async renderInviteList(containerEl: HTMLElement): Promise<void> {
    containerEl.empty()

    try {
      const invites = await this.plugin.listInvites()
      if (invites.length === 0) {
        containerEl.createEl('p', { text: 'No invites.' })
        return
      }

      for (const invite of invites) {
        const joinToken = this.plugin.joinTokenForInvite(invite.code)
        const status = invite.redeemedBy
          ? `Redeemed by ${invite.redeemedBy}${invite.redeemedAt ? ` on ${invite.redeemedAt}` : ''}`
          : `Expires ${invite.expiresAt}`

        new Setting(containerEl)
          .setName(invite.code)
          .setDesc(status)
          .addButton((button) =>
            button.setButtonText('Copy link').onClick(async () => {
              await copyText(joinToken)
              new Notice('Join link copied.')
            }),
          )
          .addButton((button) =>
            button.setButtonText('Copy code').onClick(async () => {
              await copyText(invite.code)
              new Notice('Invite code copied.')
            }),
          )
      }
    } catch (error) {
      containerEl.createEl('p', {
        text: `Could not load invites: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
}

function toHttpUrl(serverUrl: string): string {
  return serverUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}
