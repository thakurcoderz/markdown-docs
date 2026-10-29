import { useEffect, useState } from "react"
import { ChevronRight, FilePlus, FileText, Folder, FolderOpen, MoreHorizontal, Pencil, Search, Settings, SquarePen, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { TreeNode } from "@/lib/api"
import { fileManager, mod } from "@/lib/platform"
import { cn } from "@/lib/utils"

type Props = {
  tree: TreeNode[]
  current: string | null
  onOpen: (id: string) => void
  onNew: () => void
  /** New doc inside folder `folder`. */
  onNewIn: (folder: string) => void
  onRename: (id: string) => void
  onRenameFolder: (id: string) => void
  /** Moves a doc or folder into folder `to` ("" = top level). */
  onMove: (id: string, folder: boolean, to: string) => void
  onDelete: (id: string) => void
  onDeleteFolder: (id: string) => void
  onSearch: () => void
  onSettings: () => void
  onReveal: () => void
  style?: React.CSSProperties
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

  const row = (n: TreeNode, depth: number) => {
    const folder = !!n.children
    const open = folder && !collapsed.has(n.id)
    const selected = !folder && n.id === p.current
    const Icon = folder ? (open ? FolderOpen : Folder) : FileText
    return (
      <div
        className={cn(
          "group flex items-center rounded-md text-sm transition-colors hover:bg-foreground/[0.05]",
          selected && "bg-foreground/[0.08] font-medium hover:bg-foreground/[0.08]",
        )}
      >
        <button
          {...dragProps({ id: n.id, folder })}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          style={{ paddingLeft: 6 + depth * 14 }}
          title={n.id}
          aria-expanded={folder ? open : undefined}
          aria-current={selected ? "page" : undefined}
          onClick={() => (folder ? toggle(n.id) : p.onOpen(n.id))}
        >
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !folder && "invisible", open && "rotate-90")} />
          <Icon className={cn("size-3.5 shrink-0", folder ? "text-muted-foreground" : "opacity-60")} />
          <span className="truncate">{n.name}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${n.name}`} className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 hover:bg-transparent" />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {folder ? (
              <>
                <DropdownMenuItem onClick={() => p.onNewIn(n.id)}><FilePlus /> New doc here…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => p.onRenameFolder(n.id)}><Pencil /> Rename folder…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => p.onDeleteFolder(n.id)}><Trash2 /> Move folder to Trash</DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={() => p.onRename(n.id)}><Pencil /> Rename…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => p.onDelete(n.id)}><Trash2 /> Move to Trash</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  const list = (nodes: TreeNode[], depth: number) => (
    <ul>
      {nodes.map((n) => (
        <li
          key={n.id}
          {...dropProps(n.children ? n.id : parentOf(n.id))}
          className={cn("rounded-md", n.children && over === n.id && "bg-sidebar-accent ring-1 ring-sidebar-ring", dragged?.id === n.id && "opacity-50")}
        >
          {row(n, depth)}
          {n.children && !collapsed.has(n.id) && list(n.children, depth + 1)}
        </li>
      ))}
    </ul>
  )

  return (
    <aside style={p.style} className="flex min-h-0 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
        <span className="flex-1 font-heading text-[17px] font-semibold">Docs</span>
        <IconButton label={`New doc (${mod}N)`} onClick={p.onNew}><SquarePen /></IconButton>
      </div>
      <div className="px-2 pb-2">
        <button
          onClick={p.onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-[11px]">{mod}K</kbd>
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav
          {...dropProps("")}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
          className={cn("min-h-full rounded-md px-2 pb-12", over === "" && "bg-sidebar-accent/60")}
          aria-label="Documents"
        >
          {p.tree.length ? list(p.tree, 0) : <p className="px-2 py-6 text-center text-sm text-muted-foreground">No docs yet</p>}
        </nav>
      </ScrollArea>
      <div className="flex shrink-0 items-center gap-1 border-t px-2 py-1.5">
        <Button variant="ghost" size="sm" className="flex-1 justify-start text-muted-foreground" onClick={p.onSettings}>
          <Settings /> Settings
        </Button>
        <IconButton label={`Show docs in ${fileManager}`} onClick={p.onReveal}><FolderOpen /></IconButton>
      </div>
    </aside>
  )
}
