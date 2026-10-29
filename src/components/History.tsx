import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Eye, GitCompareArrows, History as HistoryIcon, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, type Version } from "@/lib/api"
import { diffLines, type DiffLine } from "@/lib/diff"
import { enhance } from "@/lib/preview"
import { cn } from "@/lib/utils"

const dayLabel = (d: Date) => {
  const today = new Date(), y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === y.toDateString()) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })
}
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

/** "Oct 29, 2026, 2:32 PM" for a version id (Unix ms). */
export const versionDate = (id: string) => new Date(Number(id)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

type PanelProps = {
  doc: string
  /** The doc's mtime; the list reloads after each save, when a new snapshot may have been taken. */
  mtime: string | undefined
  selected: string | null
  onSelect: (version: string | null) => void
}

/** Right-panel list of a doc's earlier versions, grouped by day. Picking one opens it in the doc area. */
export function HistoryPanel({ doc, mtime, selected, onSelect }: PanelProps) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  useEffect(() => {
    let live = true
    api.listVersions(doc).then((v) => live && setVersions(v), () => live && setVersions([]))
    return () => void (live = false)
  }, [doc, mtime])

  if (!versions) return null
  const savedAt = mtime ? new Date(Number(BigInt(mtime) / 1_000_000n)) : null
  let lastDay = ""
  return (
    <div className="grid gap-0.5 p-2">
      <button
        onClick={() => onSelect(null)}
        className={cn("grid rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent", !selected && "bg-sidebar-accent")}
      >
        <span className="text-sm font-medium">Current version</span>
        {savedAt && <span className="text-xs text-muted-foreground">Saved {dayLabel(savedAt) === "Today" ? "at" : dayLabel(savedAt) + ","} {timeLabel(savedAt)}</span>}
      </button>
      {versions.length === 0 && (
        <div className="grid justify-items-center gap-2 px-3 py-8 text-center">
          <HistoryIcon className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">No earlier versions yet. As you edit, a copy is kept every few minutes.</p>
        </div>
      )}
      {versions.map((v) => {
        const d = new Date(Number(v.id))
        const day = dayLabel(d)
        const header = day !== lastDay
        lastDay = day
        return (
          <Fragment key={v.id}>
            {header && <h3 className="mt-3 mb-0.5 px-2 font-mono text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{day}</h3>}
            <button
              onClick={() => onSelect(v.id)}
              title={versionDate(v.id)}
              aria-current={selected === v.id ? "true" : undefined}
              className={cn("flex items-baseline rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent", selected === v.id && "bg-sidebar-accent font-medium")}
            >
              <span className="flex-1">{timeLabel(d)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{fmtSize(v.size)}</span>
            </button>
          </Fragment>
        )
      })}
      {versions.length > 0 && (
        <p className="mt-4 px-2 text-xs text-muted-foreground">
          Older versions are thinned out over time: hourly after a day, daily after a week, weekly after 90 days.
        </p>
      )}
    </div>
  )
}

const CONTEXT = 3

type Segment = { kind: "lines"; lines: DiffLine[] } | { kind: "gap"; lines: DiffLine[] }

/** Changed lines with a few lines of context around each change; longer unchanged stretches fold into gaps. */
function segments(diff: DiffLine[]): Segment[] {
  const out: Segment[] = []
  let i = 0
  while (i < diff.length) {
    let j = i
    while (j < diff.length && diff[j].kind === "same") j++
    const run = diff.slice(i, j)
    const keepBefore = i === 0 ? 0 : CONTEXT, keepAfter = j === diff.length ? 0 : CONTEXT
    if (run.length > keepBefore + keepAfter + 1) {
      if (keepBefore) out.push({ kind: "lines", lines: run.slice(0, keepBefore) })
      out.push({ kind: "gap", lines: run.slice(keepBefore, run.length - keepAfter) })
      if (keepAfter) out.push({ kind: "lines", lines: run.slice(run.length - keepAfter) })
    } else if (run.length) out.push({ kind: "lines", lines: run })
    i = j
    while (j < diff.length && diff[j].kind !== "same") j++
    if (j > i) out.push({ kind: "lines", lines: diff.slice(i, j) })
    i = j
  }
  return out
}

function Changes({ from, to }: { from: string; to: string }) {
  const diff = useMemo(() => diffLines(from, to), [from, to])
  const segs = useMemo(() => segments(diff), [diff])
  const [open, setOpen] = useState<Set<number>>(new Set())
  useEffect(() => setOpen(new Set()), [segs])
  const added = diff.filter((l) => l.kind === "add").length, removed = diff.filter((l) => l.kind === "del").length
  if (!added && !removed) return <p className="p-8 text-center text-sm text-muted-foreground">This version is the same as the current text.</p>
  const line = (l: DiffLine, k: number) => (
    <div
      key={k}
      className={cn(
        "flex min-h-[1.65em] whitespace-pre-wrap break-words",
        l.kind === "add" && "bg-[color-mix(in_oklab,var(--chart-3)_16%,transparent)]",
        l.kind === "del" && "bg-[color-mix(in_oklab,var(--destructive)_13%,transparent)] text-muted-foreground line-through decoration-[color-mix(in_oklab,var(--destructive)_45%,transparent)]",
      )}
    >
      <span aria-hidden className={cn("w-6 shrink-0 text-center select-none", l.kind === "add" ? "text-[var(--chart-3)]" : l.kind === "del" ? "text-destructive" : "text-transparent")}>
        {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
      </span>
      <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "del" ? "Removed: " : ""}</span>
      <span className="min-w-0 flex-1 pr-4">{l.text || "​"}</span>
    </div>
  )
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-5">
      <p className="mb-3 text-xs text-muted-foreground">
        From this version to the current text: <span className="text-[var(--chart-3)]">+{added}</span> added, <span className="text-destructive">−{removed}</span> removed {added + removed === 1 ? "line" : "lines"}
      </p>
      <div className="overflow-hidden rounded-lg border font-mono text-[12.5px] leading-[1.65] select-text" style={{ fontFamily: "var(--code-font)" }}>
        {segs.map((s, k) =>
          s.kind === "lines" || open.has(k) ? (
            <Fragment key={k}>{s.lines.map((l, i) => line(l, i))}</Fragment>
          ) : (
            <button
              key={k}
              onClick={() => setOpen((o) => new Set(o).add(k))}
              className="block w-full border-y border-dashed bg-muted/50 py-1 text-center font-sans text-xs text-muted-foreground first:border-t-0 last:border-b-0 hover:text-foreground"
            >
              Show {s.lines.length} unchanged {s.lines.length === 1 ? "line" : "lines"}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

type ViewProps = {
  doc: string
  version: string
  /** The doc's current text (including unsaved edits), to compare against. */
  current: string
  rootDir: string
  onRestore: (version: string) => void
  onClose: () => void
}

/** An earlier version in the doc area: what changed since, or how it looked, with a way to restore it. */
export function VersionView({ doc, version, current, rootDir, onRestore, onClose }: ViewProps) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"changes" | "preview">("changes")
  const article = useRef<HTMLElement>(null)

  useEffect(() => {
    let live = true
    setText(null)
    setError(null)
    api.readVersion(doc, version).then((t) => live && setText(t), (e) => live && setError(String(e)))
    return () => void (live = false)
  }, [doc, version])

  useEffect(() => {
    if (tab !== "preview" || text == null) return
    let live = true
    api.render(text).then((html) => {
      const el = article.current
      if (!live || !el) return
      el.innerHTML = html // sanitized by ammonia in Rust
      enhance(el, () => live, doc, rootDir)
    })
    return () => void (live = false)
  }, [tab, text, doc, rootDir])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-sidebar px-4 py-2">
        <HistoryIcon className="size-4 text-muted-foreground" />
        <span className="mr-auto text-sm">
          Version from <span className="font-medium">{versionDate(version)}</span>
        </span>
        <div role="radiogroup" aria-label="Show" className="flex rounded-lg bg-muted p-0.5">
          {([["changes", "Changes", GitCompareArrows], ["preview", "Preview", Eye]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              role="radio"
              aria-checked={tab === id}
              onClick={() => setTab(id)}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground", tab === id && "bg-background text-foreground shadow-sm")}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <Button size="sm" disabled={text == null} onClick={() => onRestore(version)}><RotateCcw /> Restore</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Back to the current version" title="Back to the current version" onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-8 text-center text-sm text-destructive">{error}</p>
        ) : text == null ? null : tab === "changes" ? (
          <Changes from={text} to={current} />
        ) : (
          <article ref={article} className="markdown select-text" />
        )}
      </div>
    </div>
  )
}
