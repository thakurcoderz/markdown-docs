import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { MessageSquarePlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CommentsPanel, type Compose } from "@/components/CommentsPanel"
import { DocHeader, type Mode } from "@/components/DocHeader"
import { Editor } from "@/components/Editor"
import { FindBar } from "@/components/FindBar"
import { HistoryPanel, VersionView, versionDate } from "@/components/History"
import { NameDialog, type NameRequest } from "@/components/NameDialog"
import { SearchDialog } from "@/components/SearchDialog"
import { ResizeHandle } from "@/components/ResizeHandle"
import { SettingsPage } from "@/components/SettingsPage"
import { Sidebar } from "@/components/Sidebar"
import { Welcome } from "@/components/Welcome"
import { api, type Comment, type Doc, type Location, type TreeNode } from "@/lib/api"
import { docLink } from "@/lib/links"
import { anchor, enhance, findText, headingEls, readHeadings, selectionAnchor, type Heading } from "@/lib/preview"
import { applySettings, DEFAULTS, loadSettings, saveSettings, type Settings } from "@/lib/settings"
import { mod } from "@/lib/platform"
import { addRecent, moveRecent, recentDocs } from "@/lib/recent"
import { checkForUpdates } from "@/lib/updates"
import { cn } from "@/lib/utils"
import { countWords } from "@/lib/words"
import { addProperties, localDate, readProperties, withUpdated } from "@/lib/properties"
import { PropertiesCard } from "@/components/PropertiesCard"

const err = (e: unknown) => toast.error(String(e))
const AUTOSAVE_MS = 1000
/** Below this window width the right panel opens over the doc instead of beside it. */
const NARROW = 1040

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
  // Layout: focus mode hides both side panels; in narrow windows the right panel is an overlay, closed by default.
  const [narrow, setNarrow] = useState(() => innerWidth < NARROW)
  const [focus, setFocus] = useState(false)
  const [panelOverlay, setPanelOverlay] = useState(false)
  // Live widths while dragging a panel edge; saved to settings when the drag ends.
  const [widths, setWidths] = useState({ sidebar: DEFAULTS.sidebarWidth, panel: DEFAULTS.panelWidth })
  // Set when an autosave fails or an overwrite is declined; ⌘S / the Save button retries and clears it.
  const [autosavePaused, setAutosavePaused] = useState(false)
  // Find bar: open with or without the replace row; `tick` refocuses it when ⌘F is pressed again.
  const [find, setFind] = useState<{ replace: boolean; tick: number } | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  // An earlier version being looked at, shown in place of the doc.
  const [viewing, setViewing] = useState<string | null>(null)

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
    addRecent(id)
    setDoc(id); setDisk(d); setDraft(d.content); setMode(m)
    setActive(null); setCompose(null); setFab(null); setAutosavePaused(false); setViewing(null)
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
    setDoc(null); setDisk(null); setDraft(""); setComments([]); setCompose(null); setActive(null); setHtml(""); setViewing(null); setFind(null)
    S.current = { ...S.current, doc: null, disk: null, draft: "", dirty: false }
  }

  const save = async (auto = false) => {
    const { doc, disk, draft, dirty } = S.current
    if (!dirty || !doc || !disk) return true
    if (saving.current) return false
    if (!auto) setAutosavePaused(false)
    saving.current = true
    // Saving keeps the `updated` property current.
    const content = withUpdated(draft, localDate())
    try {
      let mtime: string
      try {
        mtime = await api.saveDoc(doc, content, disk.mtime, false)
      } catch (e) {
        if (e !== "conflict") throw e
        const ok = await ask(`“${doc}” changed on disk after you opened it. Overwrite it with your version?`,
          { title: "File changed on disk", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" })
        if (!ok) return setAutosavePaused(true), false
        mtime = await api.saveDoc(doc, content, disk.mtime, true)
      }
      const saved = { content, mtime }
      setDisk(saved)
      // A bumped date goes into the editor too, along with anything typed while saving.
      const next = content === draft ? S.current.draft : withUpdated(S.current.draft, localDate())
      if (next !== S.current.draft) setDraft(next)
      S.current = { ...S.current, disk: saved, draft: next, dirty: next !== content }
      return true
    } catch (e) {
      setAutosavePaused(true)
      toast.error(`Couldn’t save: ${e}`, { description: auto ? `Autosave is paused. Press ${mod}S to retry.` : undefined, duration: 10_000 })
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
    setViewing(null)
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

  /** Opens the find bar; replacing edits the Markdown, so in Preview the editor opens beside it first. */
  const openFind = async (replace: boolean) => {
    if (!S.current.doc) return
    setViewing(null)
    if (replace && S.current.mode === "preview" && !(await switchMode("split"))) return
    setFind((f) => ({ replace: replace || !!f?.replace, tick: (f?.tick ?? 0) + 1 }))
  }

  const showReplace = async (show: boolean) => {
    if (show && S.current.mode === "preview" && !(await switchMode("split"))) return
    setFind((f) => f && { ...f, replace: show })
  }

  /** Puts back an earlier version after saving any edits; the replaced text stays in the history. */
  const restoreVersion = async (version: string) => {
    const id = S.current.doc
    if (!id) return
    const ok = await ask(`Replace the current text with the version from ${versionDate(version)}? The current text is kept in the history, so you can switch back.`,
      { title: "Restore version", okLabel: "Restore", cancelLabel: "Cancel" })
    if (!ok || !(await save()) || S.current.doc !== id) return
    let d: Doc
    try {
      await api.restoreVersion(id, version)
      d = await api.readDoc(id)
    } catch (e) { return err(e) }
    setDisk(d); setDraft(d.content); setViewing(null)
    S.current = { ...S.current, disk: d, draft: d.content, dirty: false }
    if (S.current.mode !== "markdown") await showHtml(await api.render(d.content))
    toast.success("Version restored")
  }

  /** Asks for a name and template, then creates the doc and opens it for editing. `initial` prefills a folder. */
  const newDoc = async (initial = "") => {
    let templates: string[] = []
    try { templates = await api.listTemplates() } catch (e) { err(e) }
    setNameReq({
      title: "New doc", action: "Create", initial, select: initial ? "end" : "all", templates,
      submit: async (name, template) => {
        const id = await api.createDoc(name, template)
        await refreshTree()
        await openDoc(id, S.current.mode === "preview" ? "markdown" : S.current.mode)
      },
    })
  }

  /** Inserts the default properties at the top of the open doc (it autosaves like any edit). */
  const addDocProperties = async () => {
    const { doc, draft } = S.current
    if (!doc || readProperties(draft)) return
    const next = addProperties(draft, doc.split("/").pop()!, localDate())
    setDraft(next)
    S.current = { ...S.current, draft: next, dirty: next !== S.current.disk?.content }
  }

  const saveAsTemplate = () => {
    const { doc } = S.current
    if (!doc) return
    setNameReq({
      title: "Save as template", action: "Save template", initial: doc.split("/").pop()!,
      description: "New docs can start from this one. Its title and dates become placeholders that are filled in for each new doc.",
      submit: async (name) => {
        await api.saveTemplate(name, S.current.draft)
        toast.success(`Saved template “${name}”`, { description: "Pick it when creating a new doc." })
      },
    })
  }

  // Set while a move runs, so the watcher's sync doesn't mistake the open doc's old path for a deletion.
  const moving = useRef(false)

  /**
   * Runs a move or rename of `id` (`expected` = its new id). The open doc follows to its new path and is reloaded,
   * since links in it may have been rewritten. Throws on failure, except "Moved, but some links couldn't be
   * updated", where the files did move.
   */
  const relocate = async (id: string, folder: boolean, run: () => Promise<string>, expected: string) => {
    const cur = S.current.doc
    if (cur && S.current.dirty && !(await save())) throw "Save your changes first"
    moving.current = true
    let next: string
    try {
      next = await run()
    } catch (e) {
      if (!String(e).startsWith("Moved,")) throw e
      err(e)
      next = expected
    } finally {
      moving.current = false
    }
    moveRecent(id, folder, next)
    if (cur && (folder ? cur.startsWith(id + "/") : cur === id)) {
      const nd = next + cur.slice(id.length)
      setDoc(nd)
      S.current.doc = nd
      await loadComments(nd)
    }
    await syncFromDisk()
  }

  const moveItem = (id: string, folder: boolean, to: string) => {
    const name = id.split("/").pop()!
    relocate(id, folder, () => api.moveItem(id, folder, to), to ? `${to}/${name}` : name).catch(err)
  }

  const renameItem = (id: string, folder: boolean) =>
    setNameReq({
      title: folder ? "Rename folder" : "Rename doc", action: "Rename", initial: id,
      submit: (name) => {
        const to = name.trim().replace(/^\/+|\/+$/g, "").replace(/\.md$/, "")
        return relocate(id, folder, () => (folder ? api.renameFolder(id, name) : api.renameDoc(id, name)), to)
      },
    })

  const newDocIn = (folder: string) => newDoc(`${folder}/`)

  const deleteFolder = async (id: string) => {
    const inside = (d: string) => d.startsWith(id + "/")
    const count = (nodes: TreeNode[]): number => nodes.reduce((n, c) => n + (c.children ? count(c.children) : inside(c.id) ? 1 : 0), 0)
    const n = count(tree)
    const unsaved = S.current.doc && inside(S.current.doc) && S.current.dirty ? " Unsaved changes will be lost." : ""
    const ok = await ask(`Move the folder “${id}” and its ${n} ${n === 1 ? "doc" : "docs"} to the Trash? Their comments will be deleted.${unsaved}`,
      { title: "Delete folder", kind: "warning", okLabel: "Move to Trash", cancelLabel: "Cancel" })
    if (!ok) return
    try { await api.deleteFolder(id) } catch (e) { return err(e) }
    if (S.current.doc && inside(S.current.doc)) closeDoc()
    refreshTree()
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
      addMissingProperties()
      closeDoc()
      setLocation(loc)
      rootDir.current = loc.dir
      refreshTree()
      toast.success(copy ? "Docs copied to the new folder" : "Docs folder changed", { description: loc.dir })
    } catch (e) { err(e) }
  }

  /** First time a docs folder is opened: give docs without properties the default ones. */
  const addMissingProperties = async () => {
    try {
      const n = await api.addMissingProperties()
      if (n) toast.success(`Added properties to ${n} ${n === 1 ? "doc" : "docs"}`, { description: "Each doc’s original text is in its version history.", duration: 8000 })
    } catch (e) { err(e) }
  }

  /** Merges `patch` into the latest settings (not this render's copy, so back-to-back changes don't undo each other). */
  const latestSettings = useRef(settings)
  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...latestSettings.current, ...patch }
    latestSettings.current = next
    setSettings(next)
    applySettings(next)
    saveSettings(next).catch(err)
  }

  // ---------- Layout ----------

  useEffect(() => setWidths({ sidebar: settings.sidebarWidth, panel: settings.panelWidth }), [settings.sidebarWidth, settings.panelWidth])
  useEffect(() => {
    const onResize = () => setNarrow(innerWidth < NARROW)
    addEventListener("resize", onResize)
    return () => removeEventListener("resize", onResize)
  }, [])
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && setFocus(false)
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [focus])

  // Settings is a full page with its own navigation, so the docs sidebar steps aside.
  const showSidebar = settings.sidebarOpen && !focus && !settingsOpen
  const showPanel = !!doc && !focus && (narrow ? panelOverlay : settings.panelOpen)
  const toggleSidebar = () => (setFocus(false), updateSettings({ sidebarOpen: !showSidebar }))
  const togglePanel = () => {
    setFocus(false)
    if (narrow) setPanelOverlay(!showPanel)
    else updateSettings({ panelOpen: !showPanel })
  }
  /** Shows the right panel on `t` (e.g. when starting a comment), opening it if hidden. */
  const openTab = (t: string) => {
    setTab(t)
    setFocus(false)
    if (narrow) setPanelOverlay(true)
    else if (!settings.panelOpen) updateSettings({ panelOpen: true })
  }

  const checkUpdates = (quiet: boolean) => checkForUpdates({ quiet, beforeRestart: confirmDiscard })

  /** Recent docs that still exist, for the welcome screen. */
  const recentInTree = () => {
    const ids = new Set<string>()
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => (n.children ? walk(n.children) : ids.add(n.id)))
    walk(tree)
    return recentDocs().filter((id) => ids.has(id)).slice(0, 6)
  }

  const startNote = () => { setCompose({ kind: "new", quote: null, start: null }); openTab("comments") }

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
    openTab("comments")
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

  const A = useRef({ save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading, openLink, checkUpdates, toggleSidebar, togglePanel, setFocus, openFind, openTab, addMissingProperties })
  A.current = { save, switchMode, newDoc, exportPdf, confirmDiscard, syncFromDisk, placeFab, jumpToHeading, openLink, checkUpdates, toggleSidebar, togglePanel, setFocus, openFind, openTab, addMissingProperties }

  useEffect(() => {
    api.rootDir().then((d) => (rootDir.current = d), err)
    api.docsLocation().then((loc) => {
      setLocation(loc)
      if (loc.unavailable) toast.warning("Your docs folder couldn’t be opened", { description: `Using the default folder instead of ${loc.unavailable}. You can choose it again in Settings.`, duration: 10000 })
    }, err)
    loadSettings().then((s) => {
      latestSettings.current = s
      setSettings(s)
      applySettings(s)
      // Dev builds would only ever offer to replace themselves with the latest release.
      if (s.checkUpdates && !import.meta.env.DEV) A.current.checkUpdates(true)
    }, err)
    A.current.addMissingProperties().then(() => A.current.syncFromDisk())
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
        else if (payload === "toggle-sidebar") a.toggleSidebar()
        else if (payload === "toggle-panel") a.togglePanel()
        else if (payload === "focus-mode") a.setFocus((f) => !f)
        else if (payload === "find") a.openFind(false)
        else if (payload === "replace") a.openFind(true)
        else if (payload === "history" && S.current.doc) a.openTab("history")
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

  const deferredDraft = useDeferredValue(draft)
  const words = useMemo(() => countWords(deferredDraft), [deferredDraft])
  const properties = useMemo(() => readProperties(deferredDraft), [deferredDraft])
  const openCount = comments.filter((c) => c.parent_id == null && !c.resolved).length

  return (
    <div className="relative flex h-screen overflow-hidden select-none">
      {showSidebar && <Sidebar
        style={{ width: widths.sidebar }}
        tree={tree} current={doc} onOpen={openDoc} onNew={() => newDoc()} onRename={(id) => renameItem(id, false)} onMove={moveItem} onDelete={deleteDoc}
        onRenameFolder={(id) => renameItem(id, true)} onDeleteFolder={deleteFolder} onNewIn={newDocIn}
        onSearch={() => setSearchOpen(true)} onSettings={() => setSettingsOpen(true)} onReveal={() => api.revealRoot().catch(err)}
      />}
      {showSidebar && (
        <ResizeHandle
          side="left" width={widths.sidebar} min={180} max={420} defaultWidth={DEFAULTS.sidebarWidth}
          onResize={(sidebar) => setWidths((w) => ({ ...w, sidebar }))}
          onDone={(sidebarWidth) => updateSettings({ sidebarWidth })}
        />
      )}

      {settingsOpen && <SettingsPage settings={settings} onChange={updateSettings} onClose={closeSettings} location={location} onDocsFolder={changeDocsFolder} onCheckUpdates={() => checkUpdates(false)} />}

      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col", settingsOpen && "hidden")}>
        <DocHeader
          doc={doc} mode={mode} dirty={dirty} paused={autosavePaused} compact={narrow} words={words}
          sidebarOpen={showSidebar} panelOpen={showPanel}
          onMode={switchMode} onSave={() => save()} onToggleSidebar={toggleSidebar} onTogglePanel={togglePanel}
          onAddNote={startNote} onExportPdf={exportPdf} onRename={() => doc && renameItem(doc, false)}
          onReveal={() => api.revealRoot().catch(err)} onFocus={() => setFocus(true)} onDelete={() => doc && deleteDoc(doc)}
          onFind={() => openFind(false)} onHistory={() => openTab("history")}
          hasProperties={!!properties} onAddProperties={addDocProperties} onSaveTemplate={saveAsTemplate}
        />
        <div className="relative flex min-h-0 flex-1">
          {doc && viewing && (
            <VersionView doc={doc} version={viewing} current={draft} rootDir={rootDir.current} onRestore={restoreVersion} onClose={() => setViewing(null)} />
          )}
          {doc && mode !== "preview" && (
            <div className={cn("min-h-0 min-w-0 flex-1", mode === "split" && "border-r", viewing && "hidden")}>
              <Editor docKey={doc} value={draft} onChange={setDraft} onView={setEditorView} onFind={openFind} />
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={() => (spy(), placeFab())}
            className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-auto", doc && (mode === "markdown" || viewing) && "hidden")}
          >
            {doc && properties && <PropertiesCard props={properties} heading={headings.find((h) => h.level === 1)?.text} />}
            <article ref={previewRef} className={cn("markdown select-text", !doc && "hidden")} />
            {!doc && <Welcome hasDocs={tree.length > 0} recent={recentInTree()} onNew={() => newDoc()} onSearch={() => setSearchOpen(true)} onOpen={openDoc} />}
          </div>
          {doc && find && !viewing && (
            <FindBar
              editor={editorView} preview={previewRef.current} version={editorView ? draft : renderTick}
              replace={find.replace} onReplace={showReplace} focusTick={find.tick} scrollTo={scrollToRange} onClose={() => setFind(null)}
            />
          )}
        </div>
      </main>

      {showPanel && !settingsOpen && !narrow && (
        <ResizeHandle
          side="right" width={widths.panel} min={240} max={520} defaultWidth={DEFAULTS.panelWidth}
          onResize={(panel) => setWidths((w) => ({ ...w, panel }))}
          onDone={(panelWidth) => updateSettings({ panelWidth })}
        />
      )}
      <aside
        style={{ width: narrow ? Math.min(widths.panel, 340) : widths.panel }}
        className={cn(
          "flex min-h-0 shrink-0 flex-col border-l bg-sidebar",
          (!showPanel || settingsOpen) && "hidden",
          narrow && "absolute top-12 right-0 bottom-0 z-30 shadow-xl",
        )}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList variant="line" className="w-full shrink-0 justify-start border-b px-3 pt-2 pb-0">
            <TabsTrigger value="toc">Contents</TabsTrigger>
            <TabsTrigger value="comments">
              Comments {openCount > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{openCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
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
                  compose={compose} setCompose={setCompose} reload={() => loadComments()} jump={jumpToThread} onAddNote={startNote}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Open a doc to see its comments.</p>
              )}
            </TabsContent>
            <TabsContent value="history">
              {doc ? (
                <HistoryPanel doc={doc} mtime={disk?.mtime} selected={viewing} onSelect={(v) => (setViewing(v), v && setFind(null))} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Open a doc to see its history.</p>
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
