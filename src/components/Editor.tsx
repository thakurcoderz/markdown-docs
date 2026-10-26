import { useEffect, useRef } from "react"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

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
  ".cm-searchMatch": { backgroundColor: "rgb(250 204 21 / 0.35)" },
})

type Props = { docKey: string; value: string; onChange: (v: string) => void }

/** CodeMirror 6 Markdown editor. Recreated per doc (fresh undo history); external `value` changes are applied in place. */
export function Editor({ docKey, value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
        ],
      }),
    })
    view.current = v
    v.focus()
    return () => v.destroy()
  }, [docKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // A reload from disk replaces the text without remounting.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} className="h-full min-h-0" />
}
