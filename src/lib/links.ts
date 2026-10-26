const hasScheme = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")

/**
 * Resolves a relative path against the folder of `docId` ("team/standup" → "team/").
 * A leading "/" means the docs root. Returns null for paths that climb above the root.
 */
export function resolvePath(docId: string, path: string): string | null {
  const parts = path.startsWith("/") ? [] : docId.split("/").slice(0, -1)
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length ? parts.join("/") : null
}

/** `../notes.md#setup` from "team/standup" → { id: "notes", hash: "setup" }. Null if it isn't a link to a doc. */
export function docLink(docId: string, href: string): { id: string; hash: string } | null {
  if (hasScheme(href) || href.startsWith("#")) return null
  const [path, hash = ""] = href.split("#")
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { return null }
  if (!/\.md$/i.test(decoded)) return null
  const p = resolvePath(docId, decoded)
  return p ? { id: p.replace(/\.md$/i, ""), hash: decodeURIComponent(hash) } : null
}

/** Relative image src → path inside the docs root, or null when it's absolute/remote. */
export function localAsset(docId: string, src: string): string | null {
  if (hasScheme(src)) return null
  try { return resolvePath(docId, decodeURIComponent(src.split(/[?#]/)[0])) } catch { return null }
}
