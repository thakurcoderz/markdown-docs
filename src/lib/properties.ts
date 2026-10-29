import { CORE_SCHEMA, load } from "js-yaml"

/** Front matter at the very top of `md`: the YAML between the `---` lines and where the body starts. Mirrors meta.rs. */
export function frontMatter(md: string): { yaml: string; end: number } | null {
  const open = md.startsWith("---\n") ? 4 : md.startsWith("---\r\n") ? 5 : 0
  if (!open) return null
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m
  const m = close.exec(md.slice(open))
  return m ? { yaml: md.slice(open, open + m.index), end: open + m.index + m[0].length } : null
}

export type Properties = { values: Record<string, unknown>; error: string | null }

/** The doc's properties, or null when it has no front matter. Dates stay as written (no timestamp parsing). */
export function readProperties(md: string): Properties | null {
  const fm = frontMatter(md)
  if (!fm) return null
  try {
    const v = load(fm.yaml, { schema: CORE_SCHEMA })
    return { values: v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}, error: null }
  } catch (e) {
    return { values: {}, error: (e as Error).message.split("\n")[0] }
  }
}

/** Today as YYYY-MM-DD in local time, the format the properties use. */
export function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Sets the `updated:` property to `date`, if the doc has one. Only that line changes. */
export function withUpdated(md: string, date: string) {
  const fm = frontMatter(md)
  if (!fm) return md
  const head = md.slice(0, fm.end).replace(/^updated:[ \t]*.*$/m, (line) => (line.slice(8).trim() === date ? line : `updated: ${date}`))
  return head + md.slice(fm.end)
}

/** Adds the default properties to a doc that has none, titled after its first heading or `fallback`. */
export function addProperties(md: string, fallback: string, date: string) {
  const title = /^# +(.+)$/m.exec(md)?.[1].trim() || fallback
  const q = JSON.stringify(title) // a valid YAML double-quoted string
  return `---\ntitle: ${q}\ndescription: ""\ntags: []\nstatus: draft\ncreated: ${date}\nupdated: ${date}\n---\n\n${md}`
}
