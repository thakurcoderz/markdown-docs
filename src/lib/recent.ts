/** Recently opened docs for the welcome screen. A per-computer convenience, so it lives in localStorage. */
const KEY = "recentDocs"
const MAX = 8

export function recentDocs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((d) => typeof d === "string") : []
  } catch {
    return []
  }
}

function save(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX))) } catch { /* storage unavailable: just forget */ }
}

export const addRecent = (id: string) => save([id, ...recentDocs().filter((d) => d !== id)])

/** Keeps entries pointing at a doc (or the docs under a folder) after it moved from `from` to `to`. */
export const moveRecent = (from: string, folder: boolean, to: string) =>
  save(recentDocs().map((d) => (!folder && d === from ? to : folder && d.startsWith(from + "/") ? to + d.slice(from.length) : d)))
