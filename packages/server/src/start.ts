import { Command } from 'commander'
import { loadServerConfig, shouldWarnForOpenBind } from './config.js'
import { createAccordServer } from './server.js'

try { process.loadEnvFile() } catch {}

export async function startServerFromCli(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('accord-server')

  program
    .command('start', { isDefault: true })
    .description('Start the AccordKit sync server')
    .option('-c, --config <path>', 'path to a JSON or YAML config file')
    .option('--address <address>', 'address to bind')
    .option('-p, --port <port>', 'port to bind')
    .option('--open', 'run in open auth mode (no API keys required)')
    .option('--key', 'run in key auth mode (require API keys)')
    .option('-v, --verbose', 'log every document event')
    .action(async (opts: { config?: string; address?: string; port?: string; open?: boolean; key?: boolean; verbose?: boolean }) => {
      const config = await loadServerConfig({
        configPath: opts.config,
        env: {
          ...process.env,
          ...(opts.address ? { ACCORD_ADDRESS: opts.address } : {}),
          ...(opts.port ? { ACCORD_PORT: opts.port } : {}),
          ...(opts.open ? { ACCORD_AUTH_MODE: 'open' } : {}),
          ...(opts.key ? { ACCORD_AUTH_MODE: 'key' } : {}),
        },
      })
      if (opts.verbose) config.verbose = true

      if (shouldWarnForOpenBind(config)) {
        console.warn(
          `AccordKit is running with auth.mode=open on ${config.address}; restrict access to loopback or a private network.`,
        )
      }

      const server = createAccordServer(config)
      await server.listen()
    })
  await program.parseAsync(argv)
}
