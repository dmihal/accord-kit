import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function waitForContent(
  root: string,
  relPath: string,
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const content = await readFile(path.join(root, ...relPath.split('/')), 'utf8')
      if (content === expected) return
      lastError = new Error(`Expected "${expected}", received "${content}"`)
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${relPath}`)
}
