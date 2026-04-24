import { Command } from 'commander'
import { loadServerConfig, shouldWarnForUnauthenticatedBind } from './config.js'
import { createAccordServer } from './server.js'

export async function startServerFromCli(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('accord-server')
    .option('-c, --config <path>', 'path to a JSON or YAML config file')
    .option('--address <address>', 'address to bind')
    .option('-p, --port <port>', 'port to bind')

  program.parse(argv)
  const options = program.opts<{ config?: string; address?: string; port?: string }>()
  const config = await loadServerConfig({
    configPath: options.config,
    env: {
      ...process.env,
      ...(options.address ? { ACCORD_ADDRESS: options.address } : {}),
      ...(options.port ? { ACCORD_PORT: options.port } : {}),
    },
  })

  if (shouldWarnForUnauthenticatedBind(config.address)) {
    console.warn(
      `AccordKit has no application-level authentication in v1. Binding to ${config.address}; restrict access with Tailscale ACLs or firewall rules.`,
    )
  }

  const server = createAccordServer(config)
  await server.listen()
}
