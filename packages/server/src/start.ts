import { Command } from 'commander'
import { loadServerConfig, shouldWarnForUnauthenticatedBind } from './config.js'
import { createAccordServer } from './server.js'
import { runInit } from './bin/init.js'

export async function startServerFromCli(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('accord-server')

  program
    .command('start', { isDefault: true })
    .description('Start the AccordKit sync server')
    .option('-c, --config <path>', 'path to a JSON or YAML config file')
    .option('--address <address>', 'address to bind')
    .option('-p, --port <port>', 'port to bind')
    .option('-v, --verbose', 'log every document event')
    .action(async (opts: { config?: string; address?: string; port?: string; verbose?: boolean }) => {
      const config = await loadServerConfig({
        configPath: opts.config,
        env: {
          ...process.env,
          ...(opts.address ? { ACCORD_ADDRESS: opts.address } : {}),
          ...(opts.port ? { ACCORD_PORT: opts.port } : {}),
        },
      })
      if (opts.verbose) config.verbose = true

      if (shouldWarnForUnauthenticatedBind(config.address)) {
        console.warn(
          `AccordKit has no application-level authentication in v1. Binding to ${config.address}; restrict access with Tailscale ACLs or firewall rules.`,
        )
      }

      const server = createAccordServer(config)
      await server.listen()
    })

  program
    .command('init')
    .description('Initialize the database, create the default vault, and print the admin key')
    .option('-c, --config <path>', 'path to a JSON or YAML config file')
    .option('--name <name>', 'name for the admin identity', 'admin')
    .action(async (opts: { config?: string; name?: string }) => {
      await runInit({ name: opts.name, config: opts.config })
    })

  await program.parseAsync(argv)
}
