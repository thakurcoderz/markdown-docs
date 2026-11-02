import { beforeEach, expect, test, vi } from "vitest"
import { addRecentSearch, clearRecentSearches, recentSearches, removeRecentSearch } from "./recent"

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
})

test("recent searches", () => {
  expect(recentSearches()).toEqual([])
  addRecentSearch("alpha")
  addRecentSearch("beta")
  expect(addRecentSearch("ALPHA")).toEqual(["ALPHA", "beta"])
  for (let i = 0; i < 12; i++) addRecentSearch(`t${i}`)
  expect(recentSearches()).toHaveLength(10)
  expect(recentSearches()[0]).toBe("t11")
  expect(removeRecentSearch("t11")[0]).toBe("t10")
  expect(clearRecentSearches()).toEqual([])
  expect(recentSearches()).toEqual([])
})
