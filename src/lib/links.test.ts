import { expect, test } from "vitest"
import { docLink, localAsset, resolvePath } from "./links"

test("resolvePath", () => {
  expect(resolvePath("team/standup", "notes.md")).toBe("team/notes.md")
  expect(resolvePath("team/standup", "../notes.md")).toBe("notes.md")
  expect(resolvePath("team/standup", "./img/a.png")).toBe("team/img/a.png")
  expect(resolvePath("team/standup", "/root.md")).toBe("root.md")
  expect(resolvePath("standup", "../escape.md")).toBeNull()
})

test("docLink", () => {
  expect(docLink("team/standup", "../My%20Notes.md#set-up")).toEqual({ id: "My Notes", hash: "set-up" })
  expect(docLink("a", "b.md")).toEqual({ id: "b", hash: "" })
  expect(docLink("a", "https://x.com/b.md")).toBeNull()
  expect(docLink("a", "#heading")).toBeNull()
  expect(docLink("a", "image.png")).toBeNull()
})

test("localAsset", () => {
  expect(localAsset("team/standup", "img/a%20b.png?x=1")).toBe("team/img/a b.png")
  expect(localAsset("a", "https://x.com/a.png")).toBeNull()
  expect(localAsset("a", "data:image/png;base64,xx")).toBeNull()
})
