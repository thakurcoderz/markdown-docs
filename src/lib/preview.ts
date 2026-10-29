import katex from "katex"
import hljs from "highlight.js/lib/common"
import { convertFileSrc } from "@tauri-apps/api/core"
import type { Comment } from "./api"
import { localAsset } from "./links"

let mermaidSeq = 0

/**
 * Post-processes sanitized HTML in place: relative images, scrollable tables, code highlighting, KaTeX math,
 * Mermaid diagrams. `doc`/`rootDir` locate relative image paths.
 */
export async function enhance(root: HTMLElement, isCurrent: () => boolean, doc: string | null, rootDir: string) {
  for (const img of root.querySelectorAll("img")) {
    const p = doc && rootDir ? localAsset(doc, img.getAttribute("src") ?? "") : null
    if (p) img.src = convertFileSrc(`${rootDir}/${p}`)
  }
  // Only blocks with a known language; guessing languages for untagged blocks is often wrong.
  for (const code of root.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) {
    const lang = [...code.classList].find((c) => c.startsWith("language-"))!.slice(9)
    if (lang !== "mermaid" && hljs.getLanguage(lang)) hljs.highlightElement(code)
  }
  for (const t of root.querySelectorAll("table")) {
    const wrap = document.createElement("div")
    wrap.className = "table-wrap"
    t.replaceWith(wrap)
    wrap.append(t)
  }
  for (const m of root.querySelectorAll<HTMLElement>("[data-math-style], .math-inline, .math-display")) {
    const displayMode = m.dataset.mathStyle === "display" || m.classList.contains("math-display")
    try {
      katex.render(m.textContent ?? "", m, { displayMode, throwOnError: false })
    } catch {
      /* leave the TeX source visible */
    }
  }
  const blocks = [...root.querySelectorAll("pre > code.language-mermaid")]
  if (!blocks.length) return
  const { default: mermaid } = await import("mermaid")
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
  })
  for (const code of blocks) {
    if (!isCurrent()) return
    const box = document.createElement("div")
    const src = code.textContent ?? ""
    code.parentElement!.replaceWith(box)
    const id = `mmd-${++mermaidSeq}`
    try {
      box.className = "mermaid"
      box.innerHTML = (await mermaid.render(id, src)).svg
    } catch (e) {
      document.getElementById(id)?.remove()
      document.getElementById("d" + id)?.remove()
      box.className = "mermaid-error"
      box.textContent = `Mermaid error: ${(e as Error)?.message ?? e}`
    }
  }
}

export type Heading = { id: string; text: string; level: number }

export const headingEls = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")]

export const readHeadings = (root: HTMLElement): Heading[] =>
  headingEls(root).map((h) => ({ id: h.id, text: h.textContent ?? "", level: Number(h.tagName[1]) }))

// ---- Comment anchoring: offsets are over the preview's concatenated text nodes ----

type TextIndex = { nodes: Text[]; starts: number[]; text: string }

function textIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [], starts: number[] = []
  let text = ""
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode() as Text | null); ) {
    nodes.push(n)
    starts.push(text.length)
    text += n.data
  }
  return { nodes, starts, text }
}

function rangeAt(ix: TextIndex, s: number, e: number) {
  // ponytail: linear scan per lookup; binary search if docs get huge
  const find = (off: number, isEnd: boolean): [Text, number] => {
    let i = 0
    while (i + 1 < ix.nodes.length && (isEnd ? ix.starts[i + 1] < off : ix.starts[i + 1] <= off)) i++
    return [ix.nodes[i], off - ix.starts[i]]
  }
  const r = document.createRange()
  r.setStart(...find(s, false))
  r.setEnd(...find(e, true))
  return r
}

/** First case-insensitive occurrence of `q` in the preview text, as a Range. */
export function findText(root: HTMLElement, q: string) {
  const ix = textIndex(root)
  const i = ix.text.toLowerCase().indexOf(q.toLowerCase())
  return i < 0 ? null : rangeAt(ix, i, i + q.length)
}

/** Every occurrence of `q` in the preview text, as Ranges in document order. */
export function findAll(root: HTMLElement, q: string, caseSensitive: boolean) {
  if (!q) return []
  const ix = textIndex(root)
  const hay = caseSensitive ? ix.text : ix.text.toLowerCase()
  const needle = caseSensitive ? q : q.toLowerCase()
  const out: Range[] = []
  for (let i = hay.indexOf(needle); i >= 0 && out.length < 5000; i = hay.indexOf(needle, i + needle.length))
    out.push(rangeAt(ix, i, i + needle.length))
  return out
}

/** Selection → { quote, start } in the same offset space used for anchoring. */
export function selectionAnchor(root: HTMLElement, r: Range) {
  const before = document.createRange()
  before.setStart(root, 0)
  before.setEnd(r.startContainer, r.startOffset)
  return { quote: r.toString(), start: before.toString().length }
}

/**
 * Locates each root comment's quote (quote_start first, then first occurrence) and paints highlights
 * with the CSS Custom Highlight API (macOS 14+), which doesn't touch the DOM so offsets stay stable.
 */
export function anchor(root: HTMLElement, comments: Comment[], active: number | null) {
  const ranges = new Map<number, Range>()
  const missing = new Set<number>()
  const ix = textIndex(root)
  const open: Range[] = [], act: Range[] = []
  for (const c of comments) {
    if (c.parent_id != null || !c.quote) continue
    const hinted = c.quote_start != null && ix.text.substr(c.quote_start, c.quote.length) === c.quote
    const s = hinted ? c.quote_start! : ix.text.indexOf(c.quote)
    if (s < 0) {
      missing.add(c.id)
      continue
    }
    const r = rangeAt(ix, s, s + c.quote.length)
    ranges.set(c.id, r)
    if (c.id === active) act.push(r)
    else if (!c.resolved) open.push(r)
  }
  if (CSS.highlights) {
    CSS.highlights.set("c-open", new Highlight(...open))
    const a = new Highlight(...act)
    a.priority = 1
    CSS.highlights.set("c-active", a)
  }
  return { ranges, missing }
}
