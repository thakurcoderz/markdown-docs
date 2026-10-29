import { expect, test } from "vitest"
import { addProperties, frontMatter, readProperties, withUpdated } from "./properties"

const DOC = '---\ntitle: "Kickoff"\ntags: [meeting, q4]\ncreated: 2026-10-01\nupdated: 2026-10-01\n---\n\n# Kickoff\n'

test("frontMatter", () => {
  expect(frontMatter(DOC)?.end).toBe(DOC.indexOf("\n# Kickoff"))
  expect(frontMatter("---\nno end")).toBeNull()
  expect(frontMatter("# x\n---\n")).toBeNull()
  expect(frontMatter("---\na: 1\n---")?.yaml).toBe("a: 1\n")
})

test("readProperties", () => {
  expect(readProperties(DOC)?.values).toEqual({ title: "Kickoff", tags: ["meeting", "q4"], created: "2026-10-01", updated: "2026-10-01" })
  expect(readProperties("# none")).toBeNull()
  expect(readProperties("---\na: [\n---\n")?.error).toBeTruthy()
})

test("withUpdated", () => {
  const d = withUpdated(DOC, "2026-10-29")
  expect(d).toBe(DOC.replace("updated: 2026-10-01", "updated: 2026-10-29"))
  expect(withUpdated(d, "2026-10-29")).toBe(d)
  expect(withUpdated("# x\nupdated: 1", "2026-10-29")).toBe("# x\nupdated: 1")
})

test("addProperties", () => {
  const d = addProperties('# Say "hi"\n\nbody', "file", "2026-10-29")
  expect(readProperties(d)?.values).toMatchObject({ title: 'Say "hi"', tags: [], status: "draft", created: "2026-10-29" })
  expect(d.endsWith('---\n\n# Say "hi"\n\nbody')).toBe(true)
  expect(readProperties(addProperties("no heading", "file", "2026-10-29"))?.values.title).toBe("file")
})
