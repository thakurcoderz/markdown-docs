import { FileText, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mod } from "@/lib/platform"

type Props = {
  hasDocs: boolean
  /** Recently opened doc ids that still exist, newest first. */
  recent: string[]
  onNew: () => void
  onSearch: () => void
  onOpen: (id: string) => void
}

/** Shown when no doc is open: quick actions and recent docs, or a first-run hint when there are no docs yet. */
export function Welcome({ hasDocs, recent, onNew, onSearch, onOpen }: Props) {
  if (!hasDocs)
    return (
      <div className="m-auto grid max-w-sm justify-items-center gap-3 px-6 text-center">
        <FileText className="size-10 text-muted-foreground/60" strokeWidth={1.25} />
        <h2 className="font-heading text-2xl font-semibold">Welcome to Markdown Docs</h2>
        <p className="text-sm text-muted-foreground">
          Every doc is a plain Markdown file in your docs folder. Write, preview, and leave comments, all in one place.
        </p>
        <Button className="mt-2" onClick={onNew}><Plus /> Create your first doc</Button>
      </div>
    )
  return (
    <div className="m-auto w-full max-w-md px-6">
      <h2 className="font-heading text-3xl font-semibold tracking-tight">Markdown Docs</h2>
      <p className="mt-1 mb-6 text-lg text-muted-foreground italic" style={{ fontFamily: "var(--doc-font)" }}>Pick up where you left off, or start something new.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-auto justify-start py-3" onClick={onNew}>
          <Plus /> <span className="flex-1 text-left">New doc</span>
          <kbd className="font-sans text-[11px] text-muted-foreground">{mod}N</kbd>
        </Button>
        <Button variant="outline" className="h-auto justify-start py-3" onClick={onSearch}>
          <Search /> <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-[11px] text-muted-foreground">{mod}K</kbd>
        </Button>
      </div>
      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-2 text-xs font-mono font-medium tracking-[0.12em] text-muted-foreground uppercase">Recent</h2>
          <ul className="grid">
            {recent.map((id) => {
              const slash = id.lastIndexOf("/")
              return (
                <li key={id}>
                  <button
                    onClick={() => onOpen(id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/[0.05]"
                  >
                    <FileText className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{id.slice(slash + 1)}</span>
                    {slash > 0 && <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{id.slice(0, slash)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
