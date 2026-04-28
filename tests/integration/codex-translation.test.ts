import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { startTestServer, type TestServer } from './helpers/server.js'
import { waitForContentMatch } from './helpers/sync.js'
import { startTestWatcher, type TestWatcher } from './helpers/watcher.js'

const execFileAsync = promisify(execFile)
const runCodexTranslationE2E = process.env.ACCORD_RUN_CODEX_TRANSLATION_E2E === '1'
const describeCodexTranslation = runCodexTranslationE2E ? describe : describe.skip

describeCodexTranslation('codex translation hook', () => {
  let server: TestServer
  let watchers: TestWatcher[]
  let artifactsDir: string

  beforeEach(async () => {
    await assertCodexAvailable()
    server = await startTestServer()
    watchers = []
    artifactsDir = await mkdtemp(path.join(tmpdir(), 'accord-codex-translation-'))
  })

  afterEach(async () => {
    await Promise.all(watchers.map(async (watcher) => watcher.stop()))
    await rm(artifactsDir, { recursive: true, force: true })
    await server?.stop()
  })

  it('translates paired english and spanish markdown files via the on-change hook', async () => {
    const writerRoot = path.join(artifactsDir, 'writer')
    const translatorRoot = path.join(artifactsDir, 'translator')
    const hookLogPath = path.join(artifactsDir, 'hook.log')
    const codexLastMessagePath = path.join(artifactsDir, 'codex-last-message.txt')

    await mkdir(writerRoot, { recursive: true })
    await mkdir(translatorRoot, { recursive: true })

    const writer = await startWatcher(server.wsUrl, watchers, {
      root: writerRoot,
      userName: 'Writer',
      manifestPollMs: 100,
    })

    await startWatcher(server.wsUrl, watchers, {
      root: translatorRoot,
      userName: 'Translator',
      manifestPollMs: 100,
      onChangeCommand: createCodexHookCommand(translatorRoot, hookLogPath, codexLastMessagePath),
      onChangePrefix: createTranslationPrefix(),
    })

    const englishPath = 'release-notes.en.md'
    const spanishPath = 'release-notes.es.md'
    const englishContent = [
      '# Release Notes',
      '',
      'Hello team.',
      '',
      'The build is green and the deployment is ready for staging.',
      '',
      'Please review the final checklist.',
      '',
    ].join('\n')

    try {
      await writer.write(englishPath, englishContent)

      const translatedSpanish = await waitForContentMatch(
        writer.root,
        spanishPath,
        (content) =>
          content.toLowerCase().includes('hola') &&
          content.toLowerCase().includes('equipo') &&
          content.toLowerCase().includes('staging'),
        180_000,
      )

      expect(translatedSpanish).toContain('#')
      expect(translatedSpanish).not.toBe(englishContent)

      const updatedSpanishContent = [
        '# Notas de la version',
        '',
        'Hola equipo.',
        '',
        'La compilacion esta en verde y el despliegue esta listo para produccion.',
        '',
        'Por favor, revisen la lista final.',
        '',
      ].join('\n')

      await writer.write(spanishPath, updatedSpanishContent)

      const backTranslatedEnglish = await waitForContentMatch(
        writer.root,
        englishPath,
        (content) =>
          content !== englishContent &&
          content.toLowerCase().includes('hello team') &&
          content.toLowerCase().includes('production'),
        180_000,
      )

      expect(backTranslatedEnglish).toContain('# Release Notes')
    } catch (error) {
      throw new Error(await formatFailure(error, hookLogPath, codexLastMessagePath))
    }
  }, 240_000)
})

async function startWatcher(
  serverUrl: string,
  watchers: TestWatcher[],
  options: Parameters<typeof startTestWatcher>[1],
): Promise<TestWatcher> {
  const watcher = await startTestWatcher(serverUrl, options)
  watchers.push(watcher)
  return watcher
}

function createTranslationPrefix(): string {
  return [
    'You are an automated translation hook running inside a synced directory.',
    'A diff describing remote changes will be appended after this instruction block.',
    'Maintain paired markdown translation files with these rules:',
    '- If a file ending in .en.md changed, update or create the sibling .es.md file with a faithful Spanish translation of the full current file.',
    '- If a file ending in .es.md changed, update or create the sibling .en.md file with a faithful English translation of the full current file.',
    '- Only edit the counterpart translation file. Do not rewrite the source file that changed.',
    '- Preserve markdown structure, headings, lists, code fences, links, and frontmatter if present.',
    '- Do not create any files other than the counterpart translation file.',
    '- Make the necessary file edit(s) in the current working directory and then stop.',
  ].join('\n')
}

function createCodexHookCommand(rootDir: string, hookLogPath: string, lastMessagePath: string): string {
  const codexCommand = [
    'codex',
    'exec',
    '--full-auto',
    '--ephemeral',
    '--skip-git-repo-check',
    '--cd',
    rootDir,
    '--color',
    'never',
    '-o',
    lastMessagePath,
    '-',
  ].map(shellEscape).join(' ')

  return `/bin/zsh -lc ${shellEscape(`sleep 0.2; ${codexCommand} >> ${shellEscape(hookLogPath)} 2>&1`)}`
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function assertCodexAvailable(): Promise<void> {
  try {
    await execFileAsync('codex', ['exec', '--help'])
  } catch (error) {
    throw new Error(`Codex CLI is required for this test: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function formatFailure(error: unknown, hookLogPath: string, lastMessagePath: string): Promise<string> {
  const sections = [
    error instanceof Error ? error.stack ?? error.message : String(error),
  ]

  const hookLog = await readOptional(hookLogPath)
  if (hookLog) {
    sections.push(`Hook log:\n${hookLog}`)
  }

  const lastMessage = await readOptional(lastMessagePath)
  if (lastMessage) {
    sections.push(`Codex last message:\n${lastMessage}`)
  }

  return sections.join('\n\n')
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
