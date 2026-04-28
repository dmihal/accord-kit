import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const [outputPath, startedPath = '-', delayMs = '0'] = process.argv.slice(2)
const chunks = []

for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
}

const prompt = Buffer.concat(chunks).toString('utf8')

if (startedPath !== '-') {
  await mkdir(path.dirname(startedPath), { recursive: true })
  await appendFile(startedPath, `${JSON.stringify({ startedAt: Date.now() })}\n`, 'utf8')
}

const delay = Number(delayMs)
if (Number.isFinite(delay) && delay > 0) {
  await new Promise((resolve) => setTimeout(resolve, delay))
}

await mkdir(path.dirname(outputPath), { recursive: true })
await appendFile(outputPath, `${JSON.stringify({ prompt })}\n`, 'utf8')
