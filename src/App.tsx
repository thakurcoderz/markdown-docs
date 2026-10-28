import { useCallback, useEffect, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { FileDown, MessageSquarePlus, MessageSquareText, Plus, Save } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CommentsPanel, type Compose } from "@/components/CommentsPanel"
import { Editor } from "@/components/Editor"
import { NameDialog, type NameRequest } from "@/components/NameDialog"
import { SearchDialog } from "@/components/SearchDialog"
import { SettingsPage } from "@/components/SettingsPage"
import { Sidebar } from "@/components/Sidebar"
import { api, type Comment, type Doc, type Location, type TreeNode } from "@/lib/api"
import { docLink } from "@/lib/links"
import { anchor, enhance, findText, headingEls, readHeadings, selectionAnchor, type Heading } from "@/lib/preview"
import { applySettings, DEFAULTS, loadSettings, saveSettings, type Settings } from "@/lib/settings"
import { checkForUpdates } from "@/lib/updates"
import { cn } from "@/lib/utils"

type Mode = "preview" | "split" | "markdown"
const err = (e: unknown) => toast.error(String(e))
const AUTOSAVE_MS = 1000

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [doc, setDoc] = useState<string | null>(null)
  const [disk, setDisk] = useState<Doc | null>(null)
  const [draft, setDraft] = useState("")
  const [mode, setMode] = useState<Mode>("preview")
  const [html, setHtml] = useState("")
  const [renderTick, setRenderTick] = useState(0)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [spied, setSpied] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [compose, setCompose] = useState<Compose | null>(null)
  const [missing, setMissing] = useState<Set<number>>(new Set())
  const [tab, setTab] = useState("toc")
  const [nameReq, setNameReq] = useState<NameRequest | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [location, setLocation] = useState<Location | null>(null)
  const [fab, setFab] = useState<{ x: number; y: number } | null>(null)
  // Set when an autosave fails or an overwrite is declined; ⌘S / the Save button retries and clears it.
  const [autosavePaused, setAutosavePaused] = useState(false)

  const previewRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const renderWaiters = useRef<(() => void)[]>([])
  const rootDir = useRef("")
  const saving = useRef(false)
  const dirty = !!doc && !!disk && draft !== disk.content

  // Async flows (dialogs, menu events) read the latest state through this ref, never through closures.
  const S = useRef({ doc, disk, draft, mode, html, comments, dirty })
  S.current = { doc, disk, draft, mode, html, comments, dirty }

  // ---------- Rendering ----------

  useEffect(() => {
    const el = previewRef.current!
    let live = true
    el.innerHTML = html // sanitized by ammonia in Rust
    CSS.highlights?.delete("search")
    enhance(el, () => live, S.current.doc, rootDir.current).then(() => {
      if (!live) return
      setHeadings(readHeadings(el))
      setRenderTick((t) => t + 1)
      renderWaiters.current.splice(0).forEach((f) => f())
    })
    return () => void (live = false)
  }, [html])

  useEffect(() => {
    setMissing(anchor(previewRef.current!, comments, active).missing)
  }, [comments, active, renderTick])

  const showHtml = (next: string) =>
    new Promise<void>((resolve) => {
      if (next === S.current.html) return resolve()
      renderWaiters.current.push(resolve)
      setHtml(next)
    })

  // Split view: live preview of the unsaved draft.
  useEffect(() => {
    if (mode !== "split") return
    const t = setTimeout(async () => {
      const h = await api.render(S.current.draft)
      if (S.current.mode === "split") showHtml(h)
    }, 200)
    return () => clearTimeout(t)
  }, [draft, mode])

  // ---------- Doc actions ----------

  const refreshTree = () => api.tree().then(setTree, err)

  const loadComments = async (id = S.current.doc) => {
    try { setComments(id ? await api.comments(id) : []) } catch (e) { err(e) }
  }

  const confirmDiscard = async () =>
    !S.current.dirty || ask("You have unsaved changes. Discard them?", { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" })

  const openDoc = async (id: string, startMode?: Mode) => {
    setSettingsOpen(false)
    if (id === S.current.doc || !(await confirmDiscard())) return
    let d: Doc
    try { d = await api.readDoc(id) } catch (e) { return err(e) }
    // Keep the current editing mode when hopping between docs, unless a mode is requested.
    const m = startMode ?? S.current.mode
    setDoc(id); setDisk(d); setDraft(d.content); setMode(m)
    setActive(null); setCompose(null); setFab(null); setAutosavePaused(false)
    S.current = { ...S.current, doc: id, disk: d, draft: d.content, mode: m, dirty: false }
    await loadComments(id)
    await showHtml(await api.render(d.content))
    scrollRef.current?.scrollTo(0, 0)
  }

  /** Called when files change outside the app: refresh the tree and reload the open doc if it has no unsaved edits. */
  const syncFromDisk = async () => {
    if (moving.current) return
    refreshTree()
    const { doc, disk, dirty } = S.current
    if (!doc || !disk) return
    let d: Doc
    try { d = await api.readDoc(doc) } catch {
      if (!dirty) { closeDoc(); toast.info(`“${doc}” was moved or deleted outside the app`) }
      return
    }
    if (d.mtime === disk.mtime || dirty || S.current.doc !== doc) return // unsaved edits win; save's conflict check covers them
    setDisk(d); setDraft(d.content)
    S.current = { ...S.current, disk: d, draft: d.content }
    if (S.current.mode !== "markdown") await showHtml(await api.render(d.content))
  }

  const closeDoc = () => {
    setDoc(null); setDisk(null); setDraft(""); setComments([]); setCompose(null); setActive(null); setHtml("")
    S.current = { ...S.current, doc: null, disk: null, draft: "", dirty: false }
  }

  const save = async (auto = false) => {
    const { doc, disk, draft, dirty } = S.current
    if (!dirty || !doc || !disk) return true
    if (saving.current) return false
    if (!auto) setAutosavePaused(false)
    saving.current = true
    try {
      let mtime: string
      try {
        mtime = await api.saveDoc(doc, draft, disk.mtime, false)
      } catch (e) {
        if (e !== "conflict") throw e
        const ok = await ask(`“${doc}” changed on disk after you opened it. Overwrite it with your version?`,
          { title: "File changed on disk", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" })
        if (!ok) return setAutosavePaused(true), false
        mtime = await api.saveDoc(doc, draft, disk.mtime, true)
      }
      const saved = { content: draft, mtime }
      setDisk(saved)
      S.current = { ...S.current, disk: saved, dirty: S.current.draft !== draft }
      return true
    } catch (e) {
      setAutosavePaused(true)
      toast.error(`Couldn’t save: ${e}`, { description: auto ? "Autosave is paused. Press ⌘S to retry." : undefined, duration: 10_000 })
      return false
    } finally {
      saving.current = false
    }
  }

  useEffect(() => {
    if (!dirty || autosavePaused) return
    const t = setTimeout(() => A.current.save(true), AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [draft, disk, dirty, autosavePaused])

  const switchMode = async (m: Mode) => {
    if (m === S.current.mode || !S.current.doc) return true
    if (m === "preview" && !(await save())) return false
    setMode(m)
    S.current.mode = m
    if (m !== "markdown") await showHtml(await api.render(S.current.draft))
    return true
  }

  /** Makes sure the preview is on screen (leaving Markdown-only mode saves first). */
  const ensurePreview = async () => S.current.mode !== "markdown" || switchMode("preview")

  const scrollToRange = (r: Range) => {
    const box = scrollRef.current!
    box.scrollTo({ top: r.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 80, behavior: "smooth" })
  }

  const jumpToHeading = async (id: string) => {
    if (!(await ensurePreview())) return
    previewRef.current!.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const jumpToThread = async (id: number) => {
    setActive(id)
    if (!(await ensurePreview())) return
    const r = anchor(previewRef.current!, S.current.comments, id).ranges.get(id)
    if (r) scrollToRange(r)
  }

  /** Opens a search result and marks the first match in the preview. */
  const openSearchResult = async (id: string, q: string) => {
    await openDoc(id)
    if (!q || S.current.doc !== id || S.current.mode === "markdown") return
    const r = findText(previewRef.current!, q)
    if (!r) return
    CSS.highlights?.set("search", new Highlight(r))
    scrollToRange(r)
  }

  const openLink = async (id: string, hash: string) => {
    await openDoc(id)
    if (hash && S.current.doc === id) jumpToHeading(hash)
  }

  const exportPdf = async () => {
    if (!S.current.doc || !(await switchMode("preview"))) return
    getSelection()?.removeAllRanges()
    api.print().catch(err)
  }

  const newDoc = () =>
    setNameReq({
      title: "New doc", action: "Create", initial: "",
      submit: async (name) => {
        const id = await api.createDoc(name)
        await refreshTree()
        await openDoc(id, S.current.mode === "preview" ? "markdown" : S.current.mode)
      },
    })

  const renameDoc = (id: string) =>
    setNameReq({
      title: "Rename doc", action: "Rename", initial: id,
      submit: async (name) => {
        if (id === S.current.doc && !(await save())) throw "Save your changes first"
        const next = await api.renameDoc(id, name)
        if (S.current.doc === id) { setDoc(next); S.current.doc = next }
        await refreshTree()
      },
    })

  // Set while a move runs, so the watcher's sync doesn't mistake the open doc's old path for a deletion.
  const moving = useRef(false)

  const moveItem = async (id: string, folder: boolean, to: string) => {
    const cur = S.current.doc
    // Links in the open doc may be rewritten, so its edits are saved first.
    if (cur && S.current.dirty && !(await save())) return
    moving.current = true
    let next: string
    try {
      next = await api.moveItem(id, folder, to)
    } catch (e) {
      err(e)
      // "Moved, but some links couldn't be updated": the files did move.
      if (!String(e).startsWith("Moved,")) return void (moving.current = false)
      const name = id.split("/").pop()!
      next = to ? `${to}/${name}` : name
    }
    moving.current = false
    if (cur && (folder ? cur.startsWith(id + "/") : cur === id)) {
      const nd = next + cur.slice(id.length)
      setDoc(nd)
      S.current.doc = nd
      await loadComments(nd)
    }
    await syncFromDisk()
  }

  const deleteDoc = async (id: string) => {
    const unsaved = id === S.current.doc && S.current.dirty ? " Unsaved changes will be lost." : ""
    const ok = await ask(`Move “${id}” to the Trash? Its comments will be deleted.${unsaved}`,
      { title: "Delete doc", kind: "warning", okLabel: "Move to Trash", cancelLabel: "Cancel" })
    if (!ok) return
    try { await api.deleteDoc(id) } catch (e) { return err(e) }
    if (id === S.current.doc) closeDoc()
    refreshTree()
  }

  /** Switches the docs folder, offering to copy the current docs into it. The old folder is left untouched. */
  const changeDocsFolder = async (path: string | null) => {
    if (!(await confirmDiscard())) return
    const copy = tree.length > 0 && await ask(
      "Copy your current docs and comments into the new folder? They also stay where they are now. Choose “Don’t copy” to just open the new folder.",
      { title: "Change docs folder", okLabel: "Copy docs", cancelLabel: "Don’t copy" },
    )
    try {
      const loc = await api.setDocsFolder(path, copy)
      closeDoc()
      setLocation(loc)
      rootDir.current = loc.dir
      refreshTree()
      toast.success(copy ? "Docs copied to the new folder" : "Docs folder changed", { description: loc.dir })
    } catch (e) { err(e) }
  }

  const updateSettings = (next: Settings) => {
    setSettings(next)
    applySettings(next)
    saveSettings(next).catch(err)
  }

  const checkUpdates = (quiet: boolean) => checkForUpdates({ quiet, beforeRestart: confirmDiscard })

  const startNote = () => { setCompose({ kind: "new", quote: null, start: null }); setTab("comments") }

  // ---------- Selection → floating Comment button ----------

  const selectionInPreview = () => {
    const sel = getSelection()
    if (S.current.mode === "markdown" || !sel?.rangeCount || sel.isCollapsed) return null
    const r = sel.getRangeAt(0)
    return previewRef.current!.contains(r.commonAncestorContainer) && r.toString().trim() ? r : null
  }

  const placeFab = () => {
    const r = selectionInPreview()
    if (!r) return setFab(null)
    const rects = r.getClientRects()
    const last = rects[rects.length - 1] ?? r.getBoundingClientRect()
    setFab({ x: Math.min(last.right, innerWidth - 120), y: last.bottom + 6 })
  }

  const commentOnSelection = () => {
    const r = selectionInPreview()
    if (!r) return
    const { quote, start } = selectionAnchor(previewRef.current!, r)
    setCompose({ kind: "new", quote, start })
    setTab("comments")
    getSelection()?.removeAllRanges()
    setFab(null)
  }

  const spy = () => {
    if (S.current.mode === "markdown") return
    const top = scrollRef.current!.getBoundingClientRect().top + 16
    let cur: string | null = null
    for (const h of headingEls(previewRef.current!)) {
      if (h.getBoundingClientRect().top > top) break
      cur = h.id
    }
    setSpied(cur)
  }
  useEffect(spy, [renderTick, mode])

  // ---------- Global wiring ----------

  const A = useRef({ save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading, openLink, checkUpdates })
  A.current = { save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading, openLink, checkUpdates }

  useEffect(() => {
    api.rootDir().then((d) => (rootDir.current = d), err)
    api.docsLocation().then((loc) => {
      setLocation(loc)
      if (loc.unavailable) toast.warning("Your docs folder couldn’t be opened", { description: `Using the default folder instead of ${loc.unavailable}. You can choose it again in Settings.`, duration: 10000 })
    }, err)
    loadSettings().then((s) => {
      setSettings(s)
      applySettings(s)
      // Dev builds would only ever offer to replace themselves with the latest release.
      if (s.checkUpdates && !import.meta.env.DEV) A.current.checkUpdates(true)
    }, err)
    A.current.syncFromDisk()
    const onFocus = () => A.current.syncFromDisk()
    const onSel = () => A.current.placeFab()
    // Links never navigate the webview: anchors scroll, .md links open the doc, web links open in the browser.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute("href")!
      const target = docLink(S.current.doc ?? "", href)
      if (href.startsWith("#")) A.current.jumpToHeading(decodeURIComponent(href.slice(1)))
      else if (target) A.current.openLink(target.id, target.hash)
      else if (/^(https?:|mailto:)/i.test(href)) api.openUrl(a.href).catch(err)
    }
    addEventListener("focus", onFocus)
    document.addEventListener("selectionchange", onSel)
    document.addEventListener("click", onClick)
    // FSEvents bursts (several events per save) collapse into one sync.
    let syncTimer: ReturnType<typeof setTimeout> | undefined
    const unlisten = [
      listen("fs-changed", () => {
        clearTimeout(syncTimer)
        syncTimer = setTimeout(() => A.current.syncFromDisk(), 150)
      }),
      listen<string>("menu", async ({ payload }) => {
        const a = A.current
        if (payload === "quit") { if (await a.confirmDiscard()) api.quit() }
        else if (payload === "save") a.save()
        else if (payload === "new-doc") a.newDoc()
        else if (payload === "search") setSearchOpen(true)
        else if (payload === "settings") setSettingsOpen(true)
        else if (payload === "check-updates") a.checkUpdates(false)
        else if (payload === "reveal") api.revealRoot().catch(err)
        else if (payload === "export-pdf") a.exportPdf()
        else if (payload === "toggle-mode") a.switchMode(S.current.mode === "preview" ? "markdown" : "preview")
      }),
      getCurrentWindow().onCloseRequested(async (e) => {
        if (!(await A.current.confirmDiscard())) e.preventDefault()
      }),
    ]
    return () => {
      removeEventListener("focus", onFocus)
      document.removeEventListener("selectionchange", onSel)
      document.removeEventListener("click", onClick)
      unlisten.forEach((p) => p.then((f) => f()))
    }
  }, [])

  // The window title doubles as the default file name in the print-to-PDF dialog.
  useEffect(() => {
    const name = doc?.split("/").pop() ?? "Markdown Docs"
    document.title = name
    getCurrentWindow().setTitle(name)
  }, [doc])

  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  const openCount = comments.filter((c) => c.parent_id == null && !c.resolved).length

  return (
    <div className="grid h-screen grid-cols-[250px_minmax(0,1fr)_300px] overflow-hidden select-none">
      <Sidebar
        tree={tree} current={doc} onOpen={openDoc} onNew={newDoc} onRename={renameDoc} onMove={moveItem} onDelete={deleteDoc}
        onSearch={() => setSearchOpen(true)} onSettings={() => setSettingsOpen(true)} onReveal={() => api.revealRoot().catch(err)}
      />

      {settingsOpen && <SettingsPage settings={settings} onChange={updateSettings} onClose={closeSettings} location={location} onDocsFolder={changeDocsFolder} onCheckUpdates={() => checkUpdates(false)} />}

      <main className={cn("flex min-h-0 min-w-0 flex-col", settingsOpen && "hidden")}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{doc ?? ""}</h1>
          {doc && (
            <>
              {dirty && (autosavePaused
                ? <Button size="sm" onClick={() => save()}><Save /> Save</Button>
                : <span className="text-xs text-muted-foreground">Saving…</span>)}
              <ToggleGroup variant="outline" size="sm" value={[mode]} onValueChange={(v: string[]) => v[0] && switchMode(v[0] as Mode)}>
                <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
                <ToggleGroupItem value="split">Split</ToggleGroupItem>
                <ToggleGroupItem value="markdown">Markdown</ToggleGroupItem>
              </ToggleGroup>
              <Button size="sm" variant="ghost" onClick={startNote}><MessageSquareText /> Add note</Button>
              <Button size="sm" variant="ghost" onClick={exportPdf}><FileDown /> Export PDF</Button>
            </>
          )}
        </header>
        <div className="flex min-h-0 flex-1">
          {doc && mode !== "preview" && (
            <div className={cn("min-h-0 min-w-0 flex-1", mode === "split" && "border-r")}>
              <Editor docKey={doc} value={draft} onChange={setDraft} />
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={() => (spy(), placeFab())}
            className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-auto", doc && mode === "markdown" && "hidden")}
          >
            <article ref={previewRef} className={cn("markdown select-text", !doc && "hidden")} />
            {!doc && (
              <div className="m-auto grid justify-items-center gap-3 text-center text-sm text-muted-foreground">
                <p>{tree.length ? "Pick a doc from the sidebar, or start a new one." : "Create your first doc to get started."}</p>
                <Button onClick={newDoc}><Plus /> New doc</Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <aside className={cn("flex min-h-0 flex-col border-l bg-sidebar", settingsOpen && "hidden")}>
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList variant="line" className="w-full shrink-0 justify-start border-b px-3 pt-2 pb-0">
            <TabsTrigger value="toc">Contents</TabsTrigger>
            <TabsTrigger value="comments">
              Comments {openCount > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{openCount}</Badge>}
            </TabsTrigger>
          </TabsList>
          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="toc">
              <nav className="grid p-2" aria-label="Table of contents">
                {doc && !headings.length && <p className="p-2 text-sm text-muted-foreground">No headings in this doc</p>}
                {headings.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => jumpToHeading(h.id)}
                    style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                    className={cn("truncate rounded-md py-1 pr-2 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      h.id === spied && "font-semibold text-foreground")}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
            </TabsContent>
            <TabsContent value="comments">
              {doc ? (
                <CommentsPanel
                  doc={doc} comments={comments} missing={missing} active={active} setActive={setActive}
                  compose={compose} setCompose={setCompose} reload={() => loadComments()} jump={jumpToThread}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Open a doc to see its comments.</p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </aside>

      {fab && (
        <Button
          size="sm"
          className="fixed z-50 shadow-lg"
          style={{ left: fab.x, top: fab.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={commentOnSelection}
        >
          <MessageSquarePlus /> Comment
        </Button>
      )}
      <NameDialog req={nameReq} onClose={() => setNameReq(null)} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} tree={tree} onPick={openSearchResult} />
    </div>
  )
}
