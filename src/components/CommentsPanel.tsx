import { useState } from "react"
import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { api, type Comment } from "@/lib/api"
import { cn } from "@/lib/utils"

export type Compose =
  | { kind: "new"; quote: string | null; start: number | null }
  | { kind: "reply"; id: number }
  | { kind: "edit"; id: number }

type Props = {
  doc: string
  comments: Comment[]
  missing: Set<number>
  active: number | null
  setActive: (id: number) => void
  compose: Compose | null
  setCompose: (c: Compose | null) => void
  reload: () => Promise<void>
  jump: (id: number) => void
}

const fmtDate = (s: string) =>
  new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function Composer({ initial = "", label, submit, cancel }: { initial?: string; label: string; submit: (body: string) => Promise<void>; cancel: () => void }) {
  const [text, setText] = useState(initial)
  const send = async () => {
    const body = text.trim()
    if (!body) return
    try {
      await submit(body)
    } catch (e) {
      toast.error(String(e))
    }
  }
  return (
    <div className="mt-2 grid gap-2 first:mt-0" onClick={(e) => e.stopPropagation()}>
      <Textarea
        autoFocus
        value={text}
        placeholder="Write a comment… (Markdown)"
        aria-label="Comment"
        className="min-h-20 text-sm"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) (e.preventDefault(), send())
          else if (e.key === "Escape") (e.preventDefault(), cancel())
        }}
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">⌘↩ save · Esc cancel</span>
        <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={send} disabled={!text.trim()}>{label}</Button>
      </div>
    </div>
  )
}

const Quote = ({ text, onClick }: { text: string | null; onClick?: () => void }) =>
  text == null ? (
    <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">General note</div>
  ) : (
    <button
      onClick={onClick && ((e) => (e.stopPropagation(), onClick()))}
      title="Show in doc"
      className="mb-2 line-clamp-3 w-full border-l-[3px] border-amber-400 pl-2 text-left text-[13px] text-muted-foreground hover:text-foreground"
    >
      {text}
    </button>
  )

export function CommentsPanel(p: Props) {
  const [showResolved, setShowResolved] = useState(false)
  const roots = p.comments.filter((c) => c.parent_id == null)
  const open = roots.filter((c) => !c.resolved)
  const resolved = roots.filter((c) => c.resolved)
  const repliesOf = (id: number) => p.comments.filter((c) => c.parent_id === id)
  const cancel = () => p.setCompose(null)
  const done = async () => (p.setCompose(null), await p.reload())
  const run = async (f: Promise<void>) => {
    try { await f } catch (e) { toast.error(String(e)) }
    await p.reload()
  }

  const item = (c: Comment, isRoot: boolean) => {
    if (p.compose?.kind === "edit" && p.compose.id === c.id)
      return <Composer key={c.id} initial={c.body} label="Save" cancel={cancel} submit={async (b) => (await api.editComment(c.id, b), await done())} />
    const n = isRoot ? repliesOf(c.id).length : 0
    const del = async () => {
      const msg = n ? `Delete this thread and its ${n} ${n > 1 ? "replies" : "reply"}?` : "Delete this comment?"
      if (await ask(msg, { title: "Delete comment", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" })) run(api.deleteComment(c.id))
    }
    const act = (label: string, f: () => void, danger = false) => (
      <button className={cn("hover:underline", danger ? "text-destructive" : "hover:text-foreground")} onClick={(e) => (e.stopPropagation(), f())}>{label}</button>
    )
    return (
      <div key={c.id} className="select-text">
        <div className="comment-body text-[13px]" dangerouslySetInnerHTML={{ __html: c.body_html }} />
        <div className="mt-1 flex items-center gap-2.5 text-xs text-muted-foreground select-none">
          <span className="flex-1">{fmtDate(c.created_at)}</span>
          {isRoot && !c.resolved && act("Reply", () => p.setCompose({ kind: "reply", id: c.id }))}
          {act("Edit", () => p.setCompose({ kind: "edit", id: c.id }))}
          {isRoot && act(c.resolved ? "Reopen" : "Resolve", () => run(api.resolveComment(c.id, !c.resolved)))}
          {act("Delete", del, true)}
        </div>
      </div>
    )
  }

  const thread = (c: Comment) => {
    const replies = repliesOf(c.id)
    return (
      <div
        key={c.id}
        onClick={() => p.setActive(c.id)}
        className={cn("rounded-lg border bg-card p-3", c.id === p.active && "ring-2 ring-primary/60", c.resolved && "opacity-70")}
      >
        <Quote text={c.quote} onClick={() => p.jump(c.id)} />
        {p.missing.has(c.id) && <p className="mb-1.5 text-xs text-destructive">Text changed — no longer found in the doc</p>}
        {item(c, true)}
        {replies.length > 0 && <div className="mt-2 ml-1 grid gap-2 border-l-2 pl-3">{replies.map((r) => item(r, false))}</div>}
        {p.compose?.kind === "reply" && p.compose.id === c.id && (
          <Composer label="Reply" cancel={cancel} submit={async (b) => (await api.addComment(p.doc, c.id, null, null, b), await done())} />
        )}
      </div>
    )
  }

  const C = p.compose
  return (
    <div className="grid gap-2.5 p-3">
      {C?.kind === "new" && (
        <div className="rounded-lg border bg-card p-3 ring-2 ring-primary/60">
          <Quote text={C.quote} />
          <Composer label="Comment" cancel={cancel} submit={async (b) => (await api.addComment(p.doc, null, C.quote, C.start, b), await done())} />
        </div>
      )}
      {!roots.length && C?.kind !== "new" && (
        <p className="px-1 text-sm text-muted-foreground">No comments yet. Select text in the preview to comment, or add a note.</p>
      )}
      {open.map(thread)}
      {resolved.length > 0 && (
        <button className="justify-self-start px-1 text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
        </button>
      )}
      {showResolved && resolved.map(thread)}
    </div>
  )
}
