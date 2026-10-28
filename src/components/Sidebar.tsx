import { useEffect, useState } from "react"
import { ChevronRight, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Search, Settings, Trash2 } from "lucide-react"
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
  /** Moves a doc or folder into folder `to` ("" = top level). */
  onMove: (id: string, folder: boolean, to: string) => void
  onDelete: (id: string) => void
  onSearch: () => void
  onSettings: () => void
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

/** Drag payload type; deliberately not text/uri-list, which the native file-drop handler would claim. */
const DRAG_TYPE = "application/x-markdown-docs"
type Dragged = { id: string; folder: boolean }
const parentOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf("/")))

/** Whether `d` can move into folder `to`: not where it already is, and a folder not into itself. */
const canDrop = (d: Dragged | null, to: string): d is Dragged =>
  !!d && parentOf(d.id) !== to && !(d.folder && (to === d.id || to.startsWith(d.id + "/")))

export function Sidebar(p: Props) {
  // Folders start expanded; we only remember which ones the user collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  // Drag a doc or folder onto a folder (or anything in it) to move it there; onto top-level items or the
  // empty space below the list to move it to the top level.
  const [dragged, setDragged] = useState<Dragged | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const dragProps = (item: Dragged) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, item.id)
      e.dataTransfer.effectAllowed = "move"
      setDragged(item)
    },
    onDragEnd: () => (setDragged(null), setOver(null)),
  })
  // Every drop zone stops propagation, so an invalid spot doesn't fall through to an outer folder.
  const dropProps = (to: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation()
      if (!canDrop(dragged, to)) return setOver(null)
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setOver(to)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragged(null)
      setOver(null)
      if (canDrop(dragged, to)) p.onMove(dragged.id, dragged.folder, to)
    },
  })

  // Hovering a collapsed folder while dragging opens it.
  useEffect(() => {
    if (!over || !collapsed.has(over)) return
    const t = setTimeout(() => toggle(over), 600)
    return () => clearTimeout(t)
  }, [over, collapsed])

  const list = (nodes: TreeNode[], depth: number) => (
    <ul>
      {nodes.map((n) => (
        <li
          key={n.id}
          {...dropProps(n.children ? n.id : parentOf(n.id))}
          className={cn("rounded-md", n.children && over === n.id && "bg-sidebar-accent ring-1 ring-sidebar-ring", dragged?.id === n.id && "opacity-50")}
        >
          {n.children ? (
            <>
              <button
                {...dragProps({ id: n.id, folder: true })}
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
                {...dragProps({ id: n.id, folder: false })}
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
        <IconButton label="Search (⌘K)" onClick={p.onSearch}><Search /></IconButton>
        <IconButton label="Show in Finder" onClick={p.onReveal}><FolderOpen /></IconButton>
        <IconButton label="New doc (⌘N)" onClick={p.onNew}><Plus /></IconButton>
        <IconButton label="Settings (⌘,)" onClick={p.onSettings}><Settings /></IconButton>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav
          {...dropProps("")}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
          className={cn("min-h-full rounded-md px-2 pb-12", over === "" && "bg-sidebar-accent/60")}
          aria-label="Documents"
        >
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
