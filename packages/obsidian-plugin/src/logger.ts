import * as fs from 'node:fs'
import * as path from 'node:path'

type ConsoleFn = (...args: unknown[]) => void

export class PluginLogger {
  private logPath: string
  private origLog: ConsoleFn
  private origWarn: ConsoleFn
  private origError: ConsoleFn

  constructor(pluginDir: string) {
    this.logPath = path.join(pluginDir, 'accord-kit.log')
    this.origLog = console.log.bind(console)
    this.origWarn = console.warn.bind(console)
    this.origError = console.error.bind(console)
  }

  install(): void {
    const wrap = (level: string, orig: ConsoleFn): ConsoleFn =>
      (...args: unknown[]) => {
        orig(...args)
        this.write(level, args)
      }

    console.log = wrap('LOG', this.origLog)
    console.warn = wrap('WARN', this.origWarn)
    console.error = wrap('ERROR', this.origError)

    this.write('LOG', ['AccordKit logger started'])
  }

  uninstall(): void {
    this.write('LOG', ['AccordKit logger stopped'])
    console.log = this.origLog
    console.warn = this.origWarn
    console.error = this.origError
  }

  private write(level: string, args: unknown[]): void {
    const ts = new Date().toISOString()
    const msg = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
      .join(' ')
    const line = `${ts} [${level}] ${msg}\n`
    try {
      fs.appendFileSync(this.logPath, line)
    } catch {
      // silently skip if the file can't be written
    }
  }
}
