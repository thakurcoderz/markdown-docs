import { useEffect, useState } from "react"
import { FileText } from "lucide-react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { api, type Hit, type TreeNode } from "@/lib/api"

type Props = { open: boolean; onOpenChange: (o: boolean) => void; tree: TreeNode[]; onPick: (id: string, query: string) => void }

const allDocs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.children ? allDocs(n.children) : [n.id]))

/** Bolds each case-insensitive occurrence of `q` in `text`. */
function Marked({ text, q }: { text: string; q: string }) {
  const lower = text.toLowerCase(), needle = q.toLowerCase()
  const out: React.ReactNode[] = []
  for (let i = 0, j; (j = lower.indexOf(needle, i)) >= 0 && needle; i = j + needle.length) {
    out.push(text.slice(i, j), <mark key={j} className="bg-transparent font-semibold text-foreground">{text.slice(j, j + needle.length)}</mark>)
    if (lower.indexOf(needle, j + needle.length) < 0) out.push(text.slice(j + needle.length))
  }
  return <>{out.length ? out : text}</>
}

/** ⌘K: quick-open by name when empty, full-text search as you type. */
export function SearchDialog({ open, onOpenChange, tree, onPick }: Props) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const query = q.trim()

  useEffect(() => {
    if (!open) setQ("")
  }, [open])

  useEffect(() => {
    if (!query) return setHits([])
    let live = true
    const t = setTimeout(() => api.search(query).then((h) => live && setHits(h), () => {}), 100)
    return () => { live = false; clearTimeout(t) }
  }, [query])

  const pick = (id: string) => { onOpenChange(false); onPick(id, query) }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search docs" description="Search doc names and contents" className="sm:max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search docs…" />
        <CommandList className="max-h-96">
          <CommandEmpty>{query ? "No matches." : "No docs yet."}</CommandEmpty>
          {query ? (
            <CommandGroup heading="Results">
              {hits.map((h) => (
                <CommandItem key={h.id} value={h.id} onSelect={() => pick(h.id)} className="items-start">
                  <FileText className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate"><Marked text={h.id} q={query} /></div>
                    {h.lines.map((l, i) => (
                      <div key={i} className="truncate text-xs text-muted-foreground"><Marked text={l} q={query} /></div>
                    ))}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <CommandGroup heading="All docs">
              {allDocs(tree).map((id) => (
                <CommandItem key={id} value={id} onSelect={() => pick(id)}>
                  <FileText /> <span className="truncate">{id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
