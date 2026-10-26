import { useState } from "react"
import { ChevronRight, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { TreeNode } from "@/lib/api"
import { cn } from "@/lib/utils"

type Props = {
  tree: TreeNode[]
  current: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onReveal: () => void
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Sidebar(p: Props) {
  // Folders start expanded; we only remember which ones the user collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const list = (nodes: TreeNode[], depth: number) => (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          {n.children ? (
            <>
              <button
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm font-medium text-muted-foreground hover:bg-sidebar-accent"
                style={{ paddingLeft: 8 + depth * 12 }}
                aria-expanded={!collapsed.has(n.id)}
                onClick={() => toggle(n.id)}
              >
                <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !collapsed.has(n.id) && "rotate-90")} />
                <span className="truncate">{n.name}</span>
              </button>
              {!collapsed.has(n.id) && list(n.children, depth + 1)}
            </>
          ) : (
            <div
              className={cn(
                "group flex items-center rounded-md text-sm hover:bg-sidebar-accent",
                n.id === p.current && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary",
              )}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                style={{ paddingLeft: 8 + depth * 12 }}
                title={n.id}
                onClick={() => p.onOpen(n.id)}
              >
                <FileText className="size-3.5 shrink-0 opacity-60" />
                <span className="truncate">{n.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${n.name}`} className="mr-1 opacity-0 group-hover:opacity-100 data-popup-open:opacity-100 hover:bg-transparent" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => p.onRename(n.id)}><Pencil /> Rename…</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => p.onDelete(n.id)}><Trash2 /> Move to Trash</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </li>
      ))}
    </ul>
  )

  return (
    <aside className="flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="flex-1 text-sm font-semibold">Docs</span>
        <IconButton label="Show in Finder" onClick={p.onReveal}><FolderOpen /></IconButton>
        <IconButton label="New doc (⌘N)" onClick={p.onNew}><Plus /></IconButton>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="px-2 pb-3" aria-label="Documents">
          {p.tree.length ? (
            list(p.tree, 0)
          ) : (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              <p className="mb-3">No docs yet.</p>
              <Button size="sm" onClick={p.onNew}><Plus /> New doc</Button>
            </div>
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}
