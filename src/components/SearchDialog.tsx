import { Fragment, useEffect, useState } from "react"
import { FileText, History, X } from "lucide-react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { api, type Hit, type SearchMatch } from "@/lib/api"
import { addRecentSearch, recentSearches, removeRecentSearch } from "@/lib/recent"

type Props = { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string, query: string, match: SearchMatch | null) => void }

/** Wait for a pause in typing before searching, since each search reads every doc. */
const DEBOUNCE_MS = 250

/** Highlights each case-insensitive occurrence of `q` in `text`. */
function Marked({ text, q }: { text: string; q: string }) {
  const lower = text.toLowerCase(), needle = q.toLowerCase()
  const out: React.ReactNode[] = []
  for (let i = 0, j; (j = lower.indexOf(needle, i)) >= 0 && needle; i = j + needle.length) {
    out.push(text.slice(i, j), <mark key={j} className="rounded-[2px] bg-[var(--mark-open)] font-medium text-foreground">{text.slice(j, j + needle.length)}</mark>)
    if (lower.indexOf(needle, j + needle.length) < 0) out.push(text.slice(j + needle.length))
  }
  return <>{out.length ? out : text}</>
}

/** ⌘K: past searches until you type, then results for what you typed. */
export function SearchDialog({ open, onOpenChange, onPick }: Props) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  // The query `hits` answers; anything else means a search is still on its way.
  const [answered, setAnswered] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const query = q.trim()

  useEffect(() => {
    if (open) setRecent(recentSearches())
    else setQ("")
  }, [open])

  useEffect(() => {
    if (!query) return setHits([]), setAnswered("")
    let live = true
    const t = setTimeout(() => api.search(query).then((h) => { if (live) setHits(h), setAnswered(query) }, () => live && setAnswered(query)), DEBOUNCE_MS)
    return () => { live = false; clearTimeout(t) }
  }, [query])

  const pick = (id: string, match: SearchMatch | null = null) => {
    addRecentSearch(query)
    onOpenChange(false)
    onPick(id, query, match)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search docs" description="Search doc names and text" className="sm:max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search names and text…" />
        <CommandList className="max-h-96">
          <CommandEmpty>{!query ? "Type to search your docs." : answered === query ? "No matches." : "Searching…"}</CommandEmpty>
          {query ? (
            <CommandGroup heading="Results">
              {hits.map((h) => (
                <Fragment key={h.id}>
                  <CommandItem value={h.id} onSelect={() => pick(h.id, h.matches[0] ?? null)}>
                    <FileText />
                    <span className="min-w-0 flex-1 truncate font-medium"><Marked text={h.id} q={query} /></span>
                    {h.total > 0 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{h.total} {h.total === 1 ? "match" : "matches"}</span>}
                  </CommandItem>
                  {h.matches.map((m) => (
                    <CommandItem key={`${m.line}:${m.nth}`} value={`${h.id}\n${m.line}:${m.nth}`} onSelect={() => pick(h.id, m)} className="py-1 pl-8">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {m.before}<mark className="rounded-[2px] bg-[var(--mark-active)] font-medium text-foreground">{m.text}</mark>{m.after}
                      </span>
                    </CommandItem>
                  ))}
                </Fragment>
              ))}
            </CommandGroup>
          ) : recent.length > 0 && (
            <CommandGroup heading="Recent searches">
              {recent.map((r) => (
                <CommandItem key={r} value={`recent\n${r}`} onSelect={() => setQ(r)} className="py-1">
                  <History className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r}</span>
                  <button
                    type="button"
                    aria-label={`Remove “${r}” from recent searches`}
                    title="Remove"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setRecent(removeRecentSearch(r)) }}
                    className="-mr-6 shrink-0 rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
