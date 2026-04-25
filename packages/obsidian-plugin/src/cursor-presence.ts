import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface RemoteCursor {
  clientId: number
  name: string
  color: string
  index: number
}

const setCursorsEffect = StateEffect.define<RemoteCursor[]>()

const cursorsDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (set, tr) => {
    set = set.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setCursorsEffect)) {
        set = buildDecorations(effect.value, tr.newDoc.length)
      }
    }
    return set
  },
  provide: (f) => EditorView.decorations.from(f),
})

function buildDecorations(cursors: RemoteCursor[], docLength: number): DecorationSet {
  if (cursors.length === 0) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const sorted = [...cursors].sort((a, b) => a.index - b.index)
  for (const cursor of sorted) {
    const pos = Math.min(Math.max(0, cursor.index), docLength)
    builder.add(pos, pos, Decoration.widget({ widget: new CursorWidget(cursor.name, cursor.color), side: 1 }))
  }
  return builder.finish()
}

class CursorWidget extends WidgetType {
  constructor(readonly name: string, readonly color: string) { super() }

  toDOM(): HTMLElement {
    const caret = document.createElement('span')
    caret.className = 'accord-cursor'
    caret.style.cssText = `border-left:2px solid ${this.color};margin-left:-1px;position:relative;`
    const label = caret.appendChild(document.createElement('span'))
    label.className = 'accord-cursor-label'
    label.textContent = this.name
    label.style.cssText = [
      'position:absolute',
      'top:-1.4em',
      'left:-1px',
      `background:${this.color}`,
      'color:#fff',
      'font-size:0.65em',
      'padding:0 4px',
      'border-radius:3px 3px 3px 0',
      'white-space:nowrap',
      'pointer-events:none',
      'line-height:1.6',
    ].join(';')
    return caret
  }

  eq(other: CursorWidget): boolean {
    return this.name === other.name && this.color === other.color
  }

  ignoreEvent(): boolean { return true }
}

export class CursorPresenceManager {
  private activeView: EditorView | null = null
  private activeProvider: HocuspocusProvider | null = null
  private awarenessOff: (() => void) | null = null
  private readonly registeredViews = new Set<EditorView>()

  buildExtension() {
    const manager = this
    const sendCursorPlugin = ViewPlugin.fromClass(
      class {
        readonly editorView: EditorView
        constructor(view: EditorView) {
          this.editorView = view
          manager.registeredViews.add(view)
        }
        update(vu: ViewUpdate) {
          if (vu.selectionSet && manager.activeView === this.editorView && manager.activeProvider) {
            manager.activeProvider.setAwarenessField('cursor', {
              index: vu.state.selection.main.head,
            })
          }
        }
        destroy() {
          manager.registeredViews.delete(this.editorView)
        }
      },
    )
    return [cursorsDecorationField, sendCursorPlugin]
  }

  setActive(view: EditorView | null, provider: HocuspocusProvider | null): void {
    if (this.activeProvider) {
      this.activeProvider.setAwarenessField('cursor', null)
    }
    this.awarenessOff?.()
    this.awarenessOff = null

    if (this.activeView) {
      try {
        this.activeView.dispatch({ effects: setCursorsEffect.of([]) })
      } catch {
        // view may have been destroyed
      }
    }

    this.activeView = view
    this.activeProvider = provider

    const awareness = provider?.awareness
    if (!view || !awareness) return

    const handler = () => {
      if (this.activeView !== view) return
      const cursors: RemoteCursor[] = []
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue
        const cursorIndex = (state.cursor as { index?: number } | null)?.index
        if (cursorIndex == null) continue
        cursors.push({
          clientId,
          name: String((state.user as { name?: string } | null)?.name ?? 'Unknown'),
          color: String((state.user as { color?: string } | null)?.color ?? '#888888'),
          index: cursorIndex,
        })
      }
      try {
        view.dispatch({ effects: setCursorsEffect.of(cursors) })
      } catch {
        // view may have been destroyed
      }
    }

    awareness.on('change', handler)
    this.awarenessOff = () => awareness.off('change', handler)

    // Sync immediately so existing remote cursors appear without waiting for a change
    handler()
  }

  destroy(): void {
    if (this.activeProvider) {
      this.activeProvider.setAwarenessField('cursor', null)
    }
    this.awarenessOff?.()
    this.awarenessOff = null
    this.activeView = null
    this.activeProvider = null
    this.registeredViews.clear()
  }
}
