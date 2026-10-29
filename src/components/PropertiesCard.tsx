import { TriangleAlert } from "lucide-react"
import type { Properties } from "@/lib/properties"
import { cn } from "@/lib/utils"

/** Shown by name elsewhere in the card (or as the heading), so not repeated in the list of other properties. */
const KNOWN = new Set(["title", "description", "tags", "status", "created", "updated"])

const STATUS_TONE: Record<string, string> = {
  draft: "var(--chart-4)",
  review: "var(--chart-1)",
  "in review": "var(--chart-1)",
  final: "var(--chart-3)",
  done: "var(--chart-3)",
  published: "var(--chart-3)",
  archived: "var(--chart-5)",
}

const text = (v: unknown): string =>
  v == null ? "" : Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v).trim()

/** "2026-10-29" → "Oct 29, 2026"; anything else is shown as written. */
function fmtDate(v: unknown) {
  const s = text(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return s
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

const label = (k: string) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())

type Props = {
  props: Properties
  /** The doc's first heading; the title property is only shown when it says something else. */
  heading: string | undefined
}

/** The doc's YAML properties above the preview: status, tags, dates, description and any other fields. */
export function PropertiesCard({ props, heading }: Props) {
  const v = props.values
  if (props.error)
    return (
      <div className="properties flex items-center gap-2 text-sm text-destructive">
        <TriangleAlert className="size-4 shrink-0" /> The properties at the top of this doc couldn’t be read: {props.error}
      </div>
    )
  const title = text(v.title), status = text(v.status), description = text(v.description)
  const tags = (Array.isArray(v.tags) ? v.tags : text(v.tags).split(",")).map(text).filter(Boolean)
  const created = fmtDate(v.created), updated = fmtDate(v.updated)
  const others = Object.entries(v).filter(([k, val]) => !KNOWN.has(k) && text(val))
  const showTitle = title && title !== heading?.trim()
  if (!showTitle && !status && !description && !tags.length && !created && !updated && !others.length) return null
  const tone = STATUS_TONE[status.toLowerCase()] ?? "var(--muted-foreground)"
  return (
    <div className="properties grid gap-2 text-sm" aria-label="Properties">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {status && (
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] uppercase"
            style={{ color: tone, borderColor: `color-mix(in oklab, ${tone} 40%, transparent)`, background: `color-mix(in oklab, ${tone} 10%, transparent)` }}
          >
            {status}
          </span>
        )}
        {tags.map((t) => (
          <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{t}</span>
        ))}
        {(created || updated) && (
          <span className={cn("text-xs text-muted-foreground", (status || tags.length) && "ml-auto")}>
            {created && <>Created {created}</>}
            {created && updated && " · "}
            {updated && <>Updated {updated}</>}
          </span>
        )}
      </div>
      {showTitle && <div className="font-heading text-base font-semibold">{title}</div>}
      {description && <p className="text-[15px] text-muted-foreground italic" style={{ fontFamily: "var(--doc-font)" }}>{description}</p>}
      {others.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs">
          {others.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{label(k)}</dt>
              <dd className="min-w-0 break-words">{text(val)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
