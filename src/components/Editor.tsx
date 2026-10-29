import { useEffect, useRef } from "react"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { search } from "@codemirror/search"
import { EditorState, Prec } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { toast } from "sonner"
import { api, type Saved } from "@/lib/api"

// Colors come from the --tok-* CSS variables so light/dark mode and the preview's code blocks share one palette.
const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "var(--tok-heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--tok-link)" },
  { tag: t.monospace, color: "var(--tok-string)" },
  { tag: t.quote, color: "var(--tok-comment)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--tok-comment)" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--tok-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--tok-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--tok-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--tok-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--tok-function)" },
  { tag: [t.typeName, t.className, t.tagName], color: "var(--tok-type)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--tok-attr)" },
])

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--code-font)", lineHeight: "1.65" },
  ".cm-content": { padding: "20px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 24px 0 8px" },
  ".cm-gutters": { backgroundColor: "var(--background)", color: "var(--muted-foreground)", border: "none", paddingLeft: "8px" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklab, var(--tok-link) 25%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-panels-top": { borderBottom: "none" },
  ".cm-searchMatch": { backgroundColor: "rgb(250 204 21 / 0.35)" },
  ".cm-searchMatch-selected": { backgroundColor: "rgb(249 115 22 / 0.55)" },
})

/**
 * CodeMirror's search state drives match highlighting and find/replace, but its panel stays empty and hidden:
 * the app's own find bar runs it (and only highlights while a panel is "open").
 */
const hiddenSearch = search({
  createPanel: () => {
    const dom = document.createElement("div")
    dom.hidden = true
    return { dom, top: true }
  },
})

const imageFiles = (dt: DataTransfer | null) => [...(dt?.files ?? [])].filter((f) => f.type.startsWith("image/"))

/** Clipboard screenshots arrive as "image.png", nameless, or (on Linux) not as a file at all, so they get a timestamped name. */
function pastedName(ext = "png") {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0")
  return `pasted-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
}

function fileName(f: File) {
  if (f.name && f.name !== "image.png") return f.name
  return pastedName({ "image/jpeg": "jpg", "image/svg+xml": "svg" }[f.type] ?? f.type.slice(6))
}

type Added = { name: string; saved: Saved | null }

/** Inserts `![](…)` links for the images that saved, at `pos` (replacing up to `to`); failures become toasts. */
async function insertImages(v: EditorView, added: Promise<Added[]>, pos: number, to = pos) {
  let links: string[]
  try {
    links = (await added).flatMap(({ name, saved }) => {
      if (!saved) return []
      if ("Err" in saved) return toast.error(`Couldn’t add ${name}: ${saved.Err}`), []
      return [`![${name.replace(/\.[^.]+$/, "")}](${encodeURI(saved.Ok)})`]
    })
  } catch (e) {
    return void toast.error(`Couldn’t add the image: ${e}`)
  }
  const insert = links.join("\n")
  if (!insert || !v.dom.isConnected) return // switched docs while saving
  // ponytail: positions aren't remapped across edits made while saving; saves are local and take milliseconds
  const len = v.state.doc.length
  v.dispatch({ changes: { from: Math.min(pos, len), to: Math.min(to, len), insert }, selection: { anchor: Math.min(pos, len) + insert.length } })
  v.focus()
}

const settle = (p: Promise<string>): Promise<Saved> => p.then((Ok) => ({ Ok }), (e) => ({ Err: String(e) }))

type Props = {
  docKey: string
  value: string
  onChange: (v: string) => void
  /** The live view while mounted, then null; the find bar searches through it. */
  onView?: (v: EditorView | null) => void
  /** ⌘F / replace shortcut pressed in the editor (the menu usually catches these first). */
  onFind?: (replace: boolean) => void
}

/**
 * CodeMirror 6 Markdown editor. Recreated per doc (fresh undo history); external `value` changes are applied in place.
 * Pasted or dropped images are saved into the doc's img/ folder and linked at the cursor or drop point.
 */
export function Editor({ docKey, value, onChange, onView, onFind }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const cb = useRef({ onView, onFind })
  cb.current = { onView, onFind }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([
            { key: "Mod-f", run: () => (cb.current.onFind?.(false), true) },
            { key: "Mod-h", mac: "Mod-Alt-f", run: () => (cb.current.onFind?.(true), true) },
          ])),
          basicSetup,
          hiddenSearch,
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
          EditorView.domEventHandlers({
            paste: (e, v) => {
              const d = e.clipboardData
              const files = imageFiles(d)
              const { from, to } = v.state.selection.main
              if (files.length) {
                const added = Promise.all(files.map(async (f) => {
                  const name = fileName(f)
                  return { name, saved: await settle(f.arrayBuffer().then((data) => api.saveImage(docKey, name, data))) }
                }))
                insertImages(v, added, from, to)
              } else if (d && !d.types.length) {
                // WebKitGTK hands over an empty event when the clipboard holds an image; the backend reads it instead.
                const name = pastedName()
                insertImages(v, api.pasteImage(docKey, name).then((p) => [{ name, saved: p ? { Ok: p } : null }]), from, to)
              } else return false
              e.preventDefault()
              return true
            },
          }),
        ],
      }),
    })
    view.current = v
    cb.current.onView?.(v)
    v.focus()
    // Files dropped from outside arrive as native drag-drop events with paths, in physical pixels relative to the webview.
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type !== "drop" || !p.paths.length) return
      const x = p.position.x / devicePixelRatio, y = p.position.y / devicePixelRatio
      const r = v.dom.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
      const pos = v.posAtCoords({ x, y }) ?? v.state.selection.main.head
      const names = p.paths.map((path) => path.split(/[\\/]/).pop()!)
      insertImages(v, api.importImages(docKey, p.paths).then((res) => res.map((saved, i) => ({ name: names[i], saved }))), pos)
    })
    return () => {
      cb.current.onView?.(null)
      v.destroy()
      unlisten.then((f) => f())
    }
  }, [docKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // A reload from disk replaces the text without remounting.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} className="h-full min-h-0" />
}
