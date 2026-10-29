import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { EditorSelection } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search"
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Replace, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { findAll } from "@/lib/preview"
import { mod, modKey, shift } from "@/lib/platform"
import { cn } from "@/lib/utils"

type Props = {
  /** The Markdown editor when it's showing (replace works there), otherwise the preview is searched. */
  editor: EditorView | null
  preview: HTMLElement | null
  /** Changes whenever the searched text does, so the match list is refreshed. */
  version: unknown
  replace: boolean
  /** Asks to show or hide the replace row (in Preview the app first opens the editor). */
  onReplace: (show: boolean) => void
  /** Bumped by ⌘F / the menu while open: refocus and select the query. */
  focusTick: number
  scrollTo: (r: Range) => void
  onClose: () => void
}

const MAX_COUNT = 9999

/** Matches of `q` in the editor, and which one the selection is on (-1 for none). */
function editorMatches(v: EditorView, q: SearchQuery) {
  const sel = v.state.selection.main
  const cur = q.getCursor(v.state)
  let total = 0, at = -1
  for (let m = cur.next(); !m.done && total < MAX_COUNT; m = cur.next(), total++)
    if (m.value.from === sel.from && m.value.to === sel.to) at = total
  return { total, at }
}

/** Find (and replace) in the open doc: in the Markdown editor through CodeMirror's search, in the preview over its text. */
export function FindBar(p: Props) {
  const [query, setQuery] = useState("")
  const [replacement, setReplacement] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [count, setCount] = useState({ total: 0, at: -1 })
  const findInput = useRef<HTMLInputElement>(null)
  const ranges = useRef<Range[]>([])
  const at = useRef(-1)
  const ed = p.editor

  useLayoutEffect(() => {
    findInput.current?.focus()
    findInput.current?.select()
  }, [p.focusTick])

  // Editor: hand the query to CodeMirror, which highlights matches; jump to the first one from the cursor.
  const lastQuery = useRef<SearchQuery | null>(null)
  useEffect(() => {
    if (!ed) return
    const q = new SearchQuery({ search: query, caseSensitive, replace: replacement, literal: true })
    if (!searchPanelOpen(ed.state)) openSearchPanel(ed)
    const moved = !lastQuery.current || lastQuery.current.search !== q.search || lastQuery.current.caseSensitive !== q.caseSensitive
    lastQuery.current = q
    ed.dispatch({ effects: setSearchQuery.of(q) })
    if (moved && q.valid) {
      const m = q.getCursor(ed.state, ed.state.selection.main.from).next()
      if (!m.done) ed.dispatch({ selection: EditorSelection.single(m.value.from, m.value.to), scrollIntoView: true, userEvent: "select.search" })
    }
    setCount(q.valid ? editorMatches(ed, q) : { total: 0, at: -1 })
  }, [ed, query, caseSensitive, replacement, p.version])

  // Leaving the editor (or closing the bar) closes CodeMirror's hidden panel, which clears its highlights.
  useEffect(() => () => void (ed?.dom.isConnected && closeSearchPanel(ed)), [ed])

  // Preview: highlight every match with the Custom Highlight API; the current one is painted on top.
  const paint = () => {
    const r = ranges.current
    CSS.highlights?.set("find", new Highlight(...r))
    const cur = new Highlight(...(at.current >= 0 ? [r[at.current]] : []))
    cur.priority = 1
    CSS.highlights?.set("find-current", cur)
    setCount({ total: r.length, at: at.current })
  }
  useEffect(() => {
    if (ed || !p.preview) return void (CSS.highlights?.delete("find"), CSS.highlights?.delete("find-current"))
    CSS.highlights?.delete("search")
    ranges.current = findAll(p.preview, query, caseSensitive)
    at.current = ranges.current.length ? Math.min(Math.max(at.current, 0), ranges.current.length - 1) : -1
    paint()
    if (at.current >= 0) p.scrollTo(ranges.current[at.current])
  }, [ed, p.preview, query, caseSensitive, p.version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (CSS.highlights?.delete("find"), CSS.highlights?.delete("find-current")), [])

  const step = (dir: 1 | -1) => {
    if (ed) {
      ;(dir === 1 ? findNext : findPrevious)(ed)
      setCount(editorMatches(ed, lastQuery.current!))
      return
    }
    const n = ranges.current.length
    if (!n) return
    at.current = (at.current + dir + n) % n
    paint()
    p.scrollTo(ranges.current[at.current])
  }

  const doReplace = (all: boolean) => {
    if (!ed) return
    ;(all ? replaceAll : replaceNext)(ed)
    setCount(editorMatches(ed, lastQuery.current!))
  }

  const close = () => {
    p.onClose()
    ed?.focus()
  }

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.preventDefault(), step(e.shiftKey ? -1 : 1))
    else if (e.key === "Escape") (e.preventDefault(), close())
  }
  const onReplaceKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.preventDefault(), doReplace(modKey(e)))
    else if (e.key === "Escape") (e.preventDefault(), close())
  }

  const label = !query ? "" : count.total === 0 ? "No results" : count.at >= 0 ? `${count.at + 1} of ${count.total}` : `${count.total}${count.total >= MAX_COUNT ? "+" : ""} found`
  const showReplace = p.replace && !!ed

  return (
    <div role="search" className="absolute top-2 right-4 z-20 grid w-[min(440px,calc(100%-2rem))] gap-1.5 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <div className="flex items-center gap-1">
        <Tip label={showReplace ? "Hide replace" : `Replace (${replaceShortcut})`}>
          <Button variant="ghost" size="icon-xs" aria-label="Toggle replace" aria-expanded={showReplace} onClick={() => p.onReplace(!showReplace)}>
            {showReplace ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </Tip>
        <input
          ref={findInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFindKey}
          placeholder={ed ? "Find in Markdown" : "Find in doc"}
          aria-label="Find"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <span className="w-[72px] shrink-0 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">{label}</span>
        <Tip label="Match case">
          <Button variant="ghost" size="icon-xs" aria-label="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((c) => !c)} className={cn(caseSensitive && "bg-muted text-foreground")}>
            <CaseSensitive />
          </Button>
        </Tip>
        <Tip label={`Previous (${shift}Enter)`}>
          <Button variant="ghost" size="icon-xs" aria-label="Previous match" disabled={!count.total} onClick={() => step(-1)}><ChevronUp /></Button>
        </Tip>
        <Tip label="Next (Enter)">
          <Button variant="ghost" size="icon-xs" aria-label="Next match" disabled={!count.total} onClick={() => step(1)}><ChevronDown /></Button>
        </Tip>
        <Tip label="Close (Esc)">
          <Button variant="ghost" size="icon-xs" aria-label="Close find" onClick={close}><X /></Button>
        </Tip>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1 pl-7">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onReplaceKey}
            placeholder="Replace with"
            aria-label="Replace with"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Tip label="Replace (Enter)">
            <Button variant="ghost" size="xs" disabled={!count.total} onClick={() => doReplace(false)}><Replace /> Replace</Button>
          </Tip>
          <Tip label={`Replace all (${mod}Enter)`}>
            <Button variant="ghost" size="xs" disabled={!count.total} onClick={() => doReplace(true)}>All</Button>
          </Tip>
        </div>
      )}
    </div>
  )
}

export const replaceShortcut = mod === "⌘" ? "⌥⌘F" : "Ctrl+H"

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
