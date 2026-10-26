import { useEffect, useRef, useState } from "react"
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
import { NameDialog, type NameRequest } from "@/components/NameDialog"
import { Sidebar } from "@/components/Sidebar"
import { api, type Comment, type Doc, type TreeNode } from "@/lib/api"
import { anchor, enhance, headingEls, readHeadings, selectionAnchor, type Heading } from "@/lib/preview"
import { cn } from "@/lib/utils"

type Mode = "preview" | "markdown"
const err = (e: unknown) => toast.error(String(e))

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
  const [fab, setFab] = useState<{ x: number; y: number } | null>(null)

  const previewRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const renderWaiters = useRef<(() => void)[]>([])
  const dirty = !!doc && !!disk && draft !== disk.content

  // Async flows (dialogs, menu events) read the latest state through this ref, never through closures.
  const S = useRef({ doc, disk, draft, mode, html, comments, dirty })
  S.current = { doc, disk, draft, mode, html, comments, dirty }

  // ---------- Rendering ----------

  useEffect(() => {
    const el = previewRef.current!
    let live = true
    el.innerHTML = html // sanitized by ammonia in Rust
    enhance(el, () => live).then(() => {
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

  // ---------- Doc actions ----------

  const refreshTree = () => api.tree().then(setTree, err)

  const loadComments = async (id = S.current.doc) => {
    try { setComments(id ? await api.comments(id) : []) } catch (e) { err(e) }
  }

  const confirmDiscard = async () =>
    !S.current.dirty || ask("You have unsaved changes. Discard them?", { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" })

  const openDoc = async (id: string, startMode: Mode = "preview") => {
    if (id === S.current.doc || !(await confirmDiscard())) return
    let d: Doc
    try { d = await api.readDoc(id) } catch (e) { return err(e) }
    setDoc(id); setDisk(d); setDraft(d.content); setMode(startMode)
    setActive(null); setCompose(null); setFab(null)
    S.current = { ...S.current, doc: id, disk: d, draft: d.content, mode: startMode, dirty: false }
    await loadComments(id)
    await showHtml(await api.render(d.content))
    scrollRef.current?.scrollTo(0, 0)
  }

  /** Called when files change outside the app: refresh the tree and reload the open doc if it has no unsaved edits. */
  const syncFromDisk = async () => {
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
    if (S.current.mode === "preview") await showHtml(await api.render(d.content))
  }

  const closeDoc = () => {
    setDoc(null); setDisk(null); setDraft(""); setComments([]); setCompose(null); setActive(null); setHtml("")
    S.current = { ...S.current, doc: null, disk: null, draft: "", dirty: false }
  }

  const save = async () => {
    const { doc, disk, draft, dirty } = S.current
    if (!dirty || !doc || !disk) return true
    try {
      let mtime: string
      try {
        mtime = await api.saveDoc(doc, draft, disk.mtime, false)
      } catch (e) {
        if (e !== "conflict") throw e
        const ok = await ask(`“${doc}” changed on disk after you opened it. Overwrite it with your version?`,
          { title: "File changed on disk", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" })
        if (!ok) return false
        mtime = await api.saveDoc(doc, draft, disk.mtime, true)
      }
      const saved = { content: draft, mtime }
      setDisk(saved)
      S.current = { ...S.current, disk: saved, dirty: S.current.draft !== draft }
      return true
    } catch (e) {
      toast.error(`Couldn’t save: ${e}`, { duration: 10_000 })
      return false
    }
  }

  const switchMode = async (m: Mode) => {
    if (m === S.current.mode || !S.current.doc) return true
    if (m === "preview") {
      if (!(await save())) return false
      setMode("preview")
      S.current.mode = "preview"
      await showHtml(await api.render(S.current.draft))
    } else {
      setMode("markdown")
      S.current.mode = "markdown"
    }
    return true
  }

  const jumpToHeading = async (id: string) => {
    if (!(await switchMode("preview"))) return
    previewRef.current!.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const jumpToThread = async (id: number) => {
    setActive(id)
    if (!(await switchMode("preview"))) return
    const r = anchor(previewRef.current!, S.current.comments, id).ranges.get(id)
    const box = scrollRef.current!
    if (r) box.scrollTo({ top: r.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 80, behavior: "smooth" })
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
        await openDoc(id, "markdown")
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

  const deleteDoc = async (id: string) => {
    const unsaved = id === S.current.doc && S.current.dirty ? " Unsaved changes will be lost." : ""
    const ok = await ask(`Move “${id}” to the Trash? Its comments will be deleted.${unsaved}`,
      { title: "Delete doc", kind: "warning", okLabel: "Move to Trash", cancelLabel: "Cancel" })
    if (!ok) return
    try { await api.deleteDoc(id) } catch (e) { return err(e) }
    if (id === S.current.doc) closeDoc()
    refreshTree()
  }

  const startNote = () => { setCompose({ kind: "new", quote: null, start: null }); setTab("comments") }

  // ---------- Selection → floating Comment button ----------

  const selectionInPreview = () => {
    const sel = getSelection()
    if (S.current.mode !== "preview" || !sel?.rangeCount || sel.isCollapsed) return null
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
    if (S.current.mode !== "preview") return
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

  const A = useRef({ save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading })
  A.current = { save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading }

  useEffect(() => {
    A.current.syncFromDisk()
    const onFocus = () => A.current.syncFromDisk()
    const onSel = () => A.current.placeFab()
    // Links never navigate the webview: anchors scroll, web links open in the browser.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute("href")!
      if (href.startsWith("#")) A.current.jumpToHeading(decodeURIComponent(href.slice(1)))
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

  useEffect(() => {
    if (mode === "markdown") editorRef.current?.focus()
  }, [mode, doc])

  const openCount = comments.filter((c) => c.parent_id == null && !c.resolved).length

  return (
    <div className="grid h-screen grid-cols-[250px_minmax(0,1fr)_300px] overflow-hidden select-none">
      <Sidebar tree={tree} current={doc} onOpen={openDoc} onNew={newDoc} onRename={renameDoc} onDelete={deleteDoc} onReveal={() => api.revealRoot().catch(err)} />

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{doc ?? ""}</h1>
          {doc && (
            <>
              {dirty && <Button size="sm" onClick={save}><Save /> Save</Button>}
              <ToggleGroup variant="outline" size="sm" value={[mode]} onValueChange={(v: string[]) => v[0] && switchMode(v[0] as Mode)}>
                <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
                <ToggleGroupItem value="markdown">Markdown</ToggleGroupItem>
              </ToggleGroup>
              <Button size="sm" variant="ghost" onClick={startNote}><MessageSquareText /> Add note</Button>
              <Button size="sm" variant="ghost" onClick={exportPdf}><FileDown /> Export PDF</Button>
            </>
          )}
        </header>
        <div ref={scrollRef} onScroll={() => (spy(), placeFab())} className="flex min-h-0 flex-1 flex-col overflow-auto">
          <article ref={previewRef} className={cn("markdown select-text", (!doc || mode !== "preview") && "hidden")} />
          {doc && mode === "markdown" && (
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Markdown source"
              className="flex-1 resize-none bg-background px-8 py-6 font-mono text-[13px] leading-relaxed outline-none"
            />
          )}
          {!doc && (
            <div className="m-auto grid justify-items-center gap-3 text-center text-sm text-muted-foreground">
              <p>{tree.length ? "Pick a doc from the sidebar, or start a new one." : "Create your first doc to get started."}</p>
              <Button onClick={newDoc}><Plus /> New doc</Button>
            </div>
          )}
        </div>
      </main>

      <aside className="flex min-h-0 flex-col border-l bg-sidebar">
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
    </div>
  )
}
