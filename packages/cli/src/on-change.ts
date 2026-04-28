import { readFile } from 'node:fs/promises'

export interface OnChangePrefixOptions {
  onChangePrefix?: string
  onChangePrefixFile?: string
}

export async function resolveOnChangePrefix(options: OnChangePrefixOptions): Promise<string | undefined> {
  if (options.onChangePrefix && options.onChangePrefixFile) {
    throw new Error('Specify either --on-change-prefix or --on-change-prefix-file, not both')
  }

  if (options.onChangePrefixFile) {
    return readFile(options.onChangePrefixFile, 'utf8')
  }

  return options.onChangePrefix
}
