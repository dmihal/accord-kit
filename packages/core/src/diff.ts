import diff from 'fast-diff'
import type * as Y from 'yjs'

const LARGE_CONTENT_THRESHOLD = 50_000

export function applyFileContent(yText: Y.Text, newContent: string): void {
  const currentContent = yText.toString()

  if (currentContent === newContent) return

  if (currentContent.length > LARGE_CONTENT_THRESHOLD || newContent.length > LARGE_CONTENT_THRESHOLD) {
    applyLargeFileContent(yText, currentContent, newContent)
    return
  }

  const changes = diff(currentContent, newContent)

  yText.doc?.transact(() => {
    let index = 0

    for (const [operation, text] of changes) {
      if (operation === diff.INSERT) {
        yText.insert(index, text)
        index += text.length
      } else if (operation === diff.DELETE) {
        yText.delete(index, text.length)
      } else {
        index += text.length
      }
    }
  })
}

function applyLargeFileContent(yText: Y.Text, currentContent: string, newContent: string): void {
  const prefixLength = getCommonPrefixLength(currentContent, newContent)
  const suffixLength = getCommonSuffixLength(currentContent, newContent, prefixLength)
  const deleteLength = currentContent.length - prefixLength - suffixLength
  const insertText = newContent.slice(prefixLength, newContent.length - suffixLength)

  yText.doc?.transact(() => {
    if (deleteLength > 0) yText.delete(prefixLength, deleteLength)
    if (insertText.length > 0) yText.insert(prefixLength, insertText)
  })
}

function getCommonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length)
  let index = 0

  while (index < maxLength && left[index] === right[index]) {
    index += 1
  }

  return index
}

function getCommonSuffixLength(left: string, right: string, prefixLength: number): number {
  const maxLength = Math.min(left.length, right.length) - prefixLength
  let suffixLength = 0

  while (
    suffixLength < maxLength &&
    left[left.length - suffixLength - 1] === right[right.length - suffixLength - 1]
  ) {
    suffixLength += 1
  }

  return suffixLength
}
