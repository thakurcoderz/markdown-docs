import { invoke } from "@tauri-apps/api/core"

/** All user preferences. Add new settings here with a default; old settings.json files merge over these. */
export type Settings = {
  /** Font family for the interface and rendered docs; null = app default. */
  appFont: string | null
  /** Font family for the editor and code blocks; null = system monospace. */
  codeFont: string | null
}

export const DEFAULTS: Settings = { appFont: null, codeFont: null }

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULTS, ...(await invoke<Partial<Settings>>("get_settings")) }
}

export const saveSettings = (settings: Settings) => invoke<void>("set_settings", { settings })

export const listFonts = () => invoke<string[]>("list_fonts")

const cssFamily = (f: string) => `"${f.replace(/["\\]/g, "")}"`

/** Pushes settings into the CSS variables that the whole UI (and the editor) reads. */
export function applySettings(s: Settings) {
  const root = document.documentElement.style
  const set = (name: string, family: string | null, fallback: string) =>
    family ? root.setProperty(name, `${cssFamily(family)}, ${fallback}`) : root.removeProperty(name)
  set("--app-font", s.appFont, "'Geist Variable', sans-serif")
  set("--code-font", s.codeFont, 'ui-monospace, "SF Mono", Menlo, monospace')
}

/**
 * Whether WebKit can actually render `family`; it silently falls back otherwise.
 * Compares text width against two different generic fallbacks.
 */
export function fontAvailable(family: string) {
  const ctx = document.createElement("canvas").getContext("2d")!
  const sample = "mmmmmmmmmmlli1WQ@#"
  return ["monospace", "serif"].some((generic) => {
    ctx.font = `72px ${generic}`
    const base = ctx.measureText(sample).width
    ctx.font = `72px ${cssFamily(family)}, ${generic}`
    return ctx.measureText(sample).width !== base
  })
}
