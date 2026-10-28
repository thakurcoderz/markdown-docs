import { useEffect, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { ArrowLeft, Check, ChevronsUpDown, FolderOpen, Palette } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Location } from "@/lib/api"
import { fontAvailable, listFonts, type Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"

type Props = {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  location: Location | null
  /** Switches the docs folder; `null` = the default one. */
  onDocsFolder: (path: string | null) => void
}

/** Sections of the settings page. New settings get a new entry here (or a row in an existing one). */
const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "storage", label: "Docs folder", icon: FolderOpen },
] as const

function FontPicker({ value, fonts, placeholder, onPick }: { value: string | null; fonts: string[]; placeholder: string; onPick: (f: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const pick = (f: string | null) => {
    setOpen(false)
    if (f && !fontAvailable(f)) toast.warning(`“${f}” can’t be used by the app`, { description: "macOS didn’t make it available to web content, so the default font is shown instead." })
    onPick(f)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="w-72 justify-between font-normal" />}>
        <span className="truncate" style={value ? { fontFamily: `"${value}"` } : undefined}>{value ?? placeholder}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fonts…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No fonts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__default ${placeholder}`} onSelect={() => pick(null)}>
                <Check className={cn(value != null && "opacity-0")} /> {placeholder}
              </CommandItem>
              {fonts.map((f) => (
                <CommandItem key={f} value={f} onSelect={() => pick(f)}>
                  <Check className={cn(f !== value && "opacity-0")} />
                  {/* ponytail: each row previews in its own font; fine for a few hundred families */}
                  <span className="truncate" style={{ fontFamily: `"${f}"` }}>{f}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function SettingsPage({ settings, onChange, onClose, location, onDocsFolder }: Props) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("appearance")
  const [fonts, setFonts] = useState<string[]>([])

  useEffect(() => {
    listFonts().then(setFonts, (e) => toast.error(String(e)))
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[data-slot=popover-content]") && onClose()
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="col-span-2 grid min-h-0 grid-cols-[200px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-1 border-r p-3" aria-label="Settings sections">
        <Button variant="ghost" size="sm" className="mb-2 justify-start" onClick={onClose}><ArrowLeft /> Back to docs</Button>
        {SECTIONS.map((s) => (
          <Button key={s.id} variant={section === s.id ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => setSection(s.id)}>
            <s.icon /> {s.label}
          </Button>
        ))}
      </nav>
      <ScrollArea className="min-h-0">
        <div className="mx-auto max-w-2xl px-8 py-8">
          <h1 className="text-xl font-semibold">Settings</h1>
          {section === "appearance" && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Appearance</h2>
              <Row title="Interface & document font" description="Used for the app and for rendered docs. Pick any font installed on your computer.">
                <FontPicker value={settings.appFont} fonts={fonts} placeholder="Default (Geist)" onPick={(appFont) => onChange({ ...settings, appFont })} />
              </Row>
              <Row title="Code font" description="Used in the Markdown editor and code blocks. Monospaced fonts work best.">
                <FontPicker value={settings.codeFont} fonts={fonts} placeholder="Default (SF Mono)" onPick={(codeFont) => onChange({ ...settings, codeFont })} />
              </Row>
              <div className="mt-6 rounded-lg border p-5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Preview</p>
                <p className="mt-2 font-sans text-[15px] leading-relaxed">The quick brown fox jumps over the lazy dog. 0123456789</p>
                <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-[13px]">{"fn main() {\n    println!(\"Hello, docs!\");\n}"}</pre>
              </div>
            </section>
          )}
          {section === "storage" && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Docs folder</h2>
              <Row
                title="Where your docs are stored"
                description="Docs and their comments live in this folder. Pick a folder that Dropbox, Google Drive, Syncthing or similar keeps in sync to use the same docs on several computers."
              >
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const dir = await open({ directory: true, title: "Choose docs folder", defaultPath: location?.dir })
                      if (typeof dir === "string") onDocsFolder(dir)
                    }}
                  >
                    <FolderOpen /> Change…
                  </Button>
                  {location && !location.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => onDocsFolder(null)}>Use default folder</Button>
                  )}
                </div>
              </Row>
              <div className="rounded-lg border bg-muted/40 px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{location?.isDefault ? "Current folder (default)" : "Current folder"}</p>
                <p className="mt-1 font-mono text-[13px] break-all select-text">{location?.dir ?? "…"}</p>
              </div>
              {location?.unavailable && (
                <p className="mt-3 text-sm text-destructive">
                  Your chosen folder <span className="font-mono break-all">{location.unavailable}</span> couldn’t be opened, so the default folder is in use. Choose it again once it’s available.
                </p>
              )}
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
