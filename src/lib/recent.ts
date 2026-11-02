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

const SEARCHES_KEY = "recentSearches"
const MAX_SEARCHES = 10

/** Past search terms, newest first. Kept on this computer only, like recent docs. */
export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEARCHES_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []
  } catch {
    return []
  }
}

function saveSearches(list: string[]) {
  try { localStorage.setItem(SEARCHES_KEY, JSON.stringify(list)) } catch { /* only a convenience */ }
  return list
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Puts a term first; the same term in another case replaces the old one. Returns the new list. */
export const addRecentSearch = (term: string) =>
  saveSearches([term, ...recentSearches().filter((s) => !same(s, term))].slice(0, MAX_SEARCHES))

export const removeRecentSearch = (term: string) => saveSearches(recentSearches().filter((s) => s !== term))

export const clearRecentSearches = () => saveSearches([])
