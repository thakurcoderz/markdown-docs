import { expect, test } from "vitest"
import { diffLines } from "./diff"
import { countWords, readingMinutes } from "./words"

test("countWords", () => {
  expect(countWords("# Hello world\n\nIt's a *nice* day.")).toBe(6)
  expect(countWords("See [the docs](https://example.com/a/b) and ![a cat](img/cat.png)")).toBe(6)
  expect(countWords("---\ntitle: x y z\n---\nOne two")).toBe(2)
  expect(countWords("- [ ] buy milk\n- [x] 2 eggs")).toBe(4)
  expect(countWords("日本語 text")).toBe(4)
  expect(countWords("")).toBe(0)
  expect(readingMinutes(0)).toBe(1)
  expect(readingMinutes(1000)).toBe(4)
})

test("diffLines", () => {
  const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne")
  expect(d).toEqual([
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "same", text: "c" },
    { kind: "same", text: "d" },
    { kind: "add", text: "e" },
  ])
  expect(diffLines("x", "x")).toEqual([{ kind: "same", text: "x" }])
  expect(diffLines("", "new").map((l) => l.kind)).toEqual(["del", "add"])
})
