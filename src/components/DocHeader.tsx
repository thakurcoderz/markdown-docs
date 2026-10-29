import { Check, Code, Columns2, Eye, FileDown, FolderOpen, Maximize2, MessageSquareText, MoreHorizontal, PanelLeft, PanelRight, Pencil, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconButton } from "@/components/Sidebar"
import { fileManager, mod, shift } from "@/lib/platform"
import { cn } from "@/lib/utils"

export type Mode = "preview" | "split" | "markdown"

const MODES = [
  { id: "preview", label: "Preview", icon: Eye },
  { id: "split", label: "Split", icon: Columns2 },
  { id: "markdown", label: "Markdown", icon: Code },
] as const

type Props = {
  doc: string | null
  mode: Mode
  /** Unsaved edits exist; with `paused`, autosave has stopped and a Save button shows instead. */
  dirty: boolean
  paused: boolean
  /** Narrow window: the mode switch shows icons only. */
  compact: boolean
  sidebarOpen: boolean
  panelOpen: boolean
  onMode: (m: Mode) => void
  onSave: () => void
  onToggleSidebar: () => void
  onTogglePanel: () => void
  onAddNote: () => void
  onExportPdf: () => void
  onRename: () => void
  onReveal: () => void
  onFocus: () => void
  onDelete: () => void
}

/** Top bar of the doc area: panel toggles, folder path + doc name, save state, view switch and a ⋯ menu. */
export function DocHeader(p: Props) {
  const slash = p.doc?.lastIndexOf("/") ?? -1
  const folder = p.doc && slash > 0 ? p.doc.slice(0, slash) : ""
  const name = p.doc?.slice(slash + 1) ?? ""
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <IconButton label={`${p.sidebarOpen ? "Hide" : "Show"} sidebar (${mod}\\)`} onClick={p.onToggleSidebar}><PanelLeft /></IconButton>
      <h1 className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden text-sm" title={p.doc ?? undefined}>
        {/* The folder path gives way first, then the name. */}
        {folder && <span className="min-w-0 shrink-[4] truncate text-muted-foreground">{folder.split("/").join(" / ")} /</span>}
        <span className="min-w-0 truncate font-heading text-[15px] font-semibold">{name}</span>
        {p.doc && (
          <span className="ml-1 shrink-0 text-xs text-muted-foreground" aria-live="polite">
            {p.dirty ? (p.paused ? "" : "Saving…") : <span className="inline-flex items-center gap-1"><Check className="size-3" /> Saved</span>}
          </span>
        )}
      </h1>
      {p.doc && (
        <>
          {p.dirty && p.paused && <Button size="sm" onClick={p.onSave}><Save /> Save</Button>}
          <div role="radiogroup" aria-label="View" className="flex shrink-0 rounded-lg bg-muted p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={p.mode === m.id}
                aria-label={m.label}
                title={p.compact ? m.label : undefined}
                onClick={() => p.onMode(m.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                  p.mode === m.id && "bg-background text-foreground shadow-sm",
                )}
              >
                <m.icon className="size-3.5" />
                {!p.compact && m.label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={p.onAddNote}><MessageSquareText /> Add note</DropdownMenuItem>
              <DropdownMenuItem onClick={p.onExportPdf}><FileDown /> Export PDF… <DropdownMenuShortcut>{mod}P</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onClick={p.onFocus}><Maximize2 /> Focus mode <DropdownMenuShortcut>{mod}{shift}F</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={p.onRename}><Pencil /> Rename…</DropdownMenuItem>
              <DropdownMenuItem onClick={p.onReveal}><FolderOpen /> Show in {fileManager}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={p.onDelete}><Trash2 /> Move to Trash</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={`${p.panelOpen ? "Hide" : "Show"} panel (${mod}${shift}\\)`} onClick={p.onTogglePanel}><PanelRight /></IconButton>
        </>
      )}
    </header>
  )
}
