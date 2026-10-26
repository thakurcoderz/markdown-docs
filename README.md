# Markdown Docs

[![CI](https://github.com/thakurcoderz/markdown-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/thakurcoderz/markdown-docs/actions/workflows/ci.yml)

A local macOS app for reading and editing Markdown docs, with comment threads anchored to the text — like Google Docs comments, but for plain `.md` files on your machine.

Built with [Tauri v2](https://tauri.app) (Rust backend, native WKWebView) and React + [shadcn/ui](https://ui.shadcn.com).

## Download

Get the latest **`.dmg`** from [Releases](https://github.com/thakurcoderz/markdown-docs/releases/latest). It's a universal build for Apple Silicon and Intel Macs on macOS 14 or later.

The app isn't signed yet, so on first launch right-click it → **Open**, or run:

```sh
xattr -dr com.apple.quarantine "/Applications/Markdown Docs.app"
```

## Features

- **Docs without folder wrangling** — create, rename and delete docs from the app. Name a doc `team/standup` and it's grouped under "team" automatically.
- **Plain files** — every doc is a normal `.md` file, so you can still open, edit, back up or version it with any other tool. Changes made outside the app show up live.
- **Search** — ⌘K opens a palette: type to search doc names and contents, or pick from all docs. Opening a result highlights the first match.
- **Rich preview** — GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks, footnotes), syntax-highlighted code blocks, KaTeX math (`$inline$`, `$$block$$`), and Mermaid diagrams. Raw HTML is allowed but sanitized.
- **Links and images between docs** — `[setup](../guides/setup.md#install)` opens that doc at that heading; `![](img/diagram.png)` loads images relative to the doc.
- **Editor** — CodeMirror with Markdown highlighting, line numbers, and find/replace (⌘F). Switch between **Preview**, **Split** (editor + live preview), and **Markdown**.
- **Autosave** — changes are saved a second after you stop typing (⌘S still works). Saves are atomic, and you're asked before overwriting a file that changed on disk since you opened it; if you decline or a save fails, autosave pauses until you save manually.
- **Table of contents** — built from h1–h4, with smooth scrolling and scroll-spy highlighting.
- **Anchored comments** — select text in the preview and click **Comment**, or add a general note. Threads support replies, edits, deletion, and resolve/reopen. Comment bodies are Markdown. If the quoted text disappears from the doc, the thread is flagged.
- **Export PDF** — prints just the rendered doc, with no app chrome.
- **Settings** (⌘,) — a settings page for app preferences, starting with fonts: pick any font installed on your Mac for the interface/docs and for code/the editor. Saved to `settings.json` in the app data folder.
- Follows the system light/dark appearance.

## Requirements

- macOS 14 (Sonoma) or later — comment highlights use the CSS Custom Highlight API
- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 20.19+ and npm
- Xcode Command Line Tools (`xcode-select --install`)

## Getting started

```sh
git clone https://github.com/thakurcoderz/markdown-docs.git
cd markdown-docs
npm install
npm run dev        # run with hot reload
```

### Build the app

```sh
npm run build
```

Outputs:

- `src-tauri/target/release/bundle/macos/Markdown Docs.app`
- `src-tauri/target/release/bundle/dmg/Markdown Docs_<version>_<arch>.dmg`

The build is unsigned. On first launch, right-click the app → **Open** (or allow it in System Settings → Privacy & Security).

### Publish a release

Releases are built by GitHub Actions (`.github/workflows/release.yml`). Bump `version` in `src-tauri/tauri.conf.json`, commit, then push a matching tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The workflow runs the tests, builds a universal `.dmg` and `.app.zip`, and publishes a GitHub Release with checksums and generated notes. **Actions → Release → Run workflow** does a dry run that uploads the builds as workflow artifacts without publishing. Adding the `APPLE_*` secrets listed at the top of the workflow turns on code signing and notarization.

### Run the tests

CI (`.github/workflows/ci.yml`) runs these on every branch push.

```sh
npm test                    # frontend (Vitest)
cd src-tauri && cargo test  # backend
```

## Where your data lives

```
~/Library/Application Support/dev.thakurcoder.markdown-docs/Docs/
├── welcome.md
├── team/
│   └── standup.md
└── .docs/
    └── comments.db      # SQLite: all comment threads
# and next to Docs/: settings.json (app preferences)
```

Use **File → Show Docs in Finder** (⇧⌘R) to open it. Folders and files starting with `.` are hidden from the sidebar. A doc's id is its path without `.md` (e.g. `team/standup`); comments are keyed by that id and follow the doc when you rename it in the app.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘K | Search / quick open |
| ⌘, | Settings |
| ⌘N | New doc |
| ⌘S | Save now |
| ⌘F | Find / replace in the editor |
| ⌘E | Toggle Preview / Markdown |
| ⌘P | Export PDF |
| ⇧⌘R | Show docs in Finder |
| ⌘↩ / Esc | Save / cancel a comment |

## Project layout

```
src/                     React frontend
├── App.tsx              layout, doc state, save / mode / export flows
├── components/
│   ├── Sidebar.tsx      doc tree, new / rename / delete
│   ├── CommentsPanel.tsx
│   ├── Editor.tsx       CodeMirror 6 editor
│   ├── SearchDialog.tsx ⌘K palette
│   ├── SettingsPage.tsx settings page (add new sections here)
│   ├── NameDialog.tsx
│   └── ui/              shadcn components
└── lib/
    ├── api.ts           typed wrappers around Tauri commands
    ├── settings.ts      settings shape, defaults, load/save, applies fonts via CSS variables
    ├── links.ts         relative doc links / image paths (tested with Vitest)
    └── preview.ts       images, code highlighting, KaTeX, Mermaid, comment anchoring

src-tauri/src/           Rust backend
├── main.rs              commands, menu, file watcher
├── docs.rs              file tree, search, safe paths, atomic save, Markdown → sanitized HTML
└── comments.rs          SQLite comment store
```

## How it works

- **Rendering** — Markdown is converted to HTML in Rust with [comrak](https://github.com/kivikakk/comrak) and sanitized with [ammonia](https://github.com/rust-ammonia/ammonia) (keeping only `language-*` / `math-*` classes). The frontend then renders math with KaTeX and diagrams with Mermaid (`securityLevel: strict`).
- **Saving** — writes to a temp file, then renames it over the original. The file's mtime at load time is compared at save time to detect outside edits.
- **Path safety** — every doc path is resolved and checked to stay inside the docs folder (no `../` traversal or symlink escapes).
- **Comment anchoring** — a comment stores its quoted text and its character offset in the preview's text. To place a highlight, the app tries the offset first, then falls back to the first occurrence of the quote.
- **Live updates** — an FSEvents watcher (via [notify](https://github.com/notify-rs/notify)) refreshes the tree and reloads the open doc when files change outside the app. Unsaved edits are never overwritten.
- **Links** never navigate the app window: `#anchors` scroll the preview and web links open in your browser.

## Limitations

- macOS only (the app is built around WKWebView and FSEvents).
- No multiple libraries, sync, or comment authors yet.
- Search rescans files on each query — instant for hundreds of docs, not built for tens of thousands.
- Images inside dot-folders (e.g. `.assets/`) aren't loaded.
- Comments are lost if a doc is renamed or moved outside the app.
