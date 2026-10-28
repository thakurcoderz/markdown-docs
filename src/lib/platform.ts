/** macOS vs Linux wording for shortcuts and the file manager. */
export const isMac = navigator.userAgent.includes("Mac")

/** Prefix for shortcut labels: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export const mod = isMac ? "⌘" : "Ctrl+"
export const shift = isMac ? "⇧" : "Shift+"

export const fileManager = isMac ? "Finder" : "Files"

/** The platform's primary shortcut modifier is held (⌘ on macOS, Ctrl elsewhere). */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)
