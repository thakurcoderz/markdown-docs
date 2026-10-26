# Markdown Docs

A local macOS app for reading and editing Markdown docs, with comment threads anchored to the text — like Google Docs comments, but for plain `.md` files on your machine.

Built with [Tauri v2](https://tauri.app) (Rust backend, native WKWebView) and React + [shadcn/ui](https://ui.shadcn.com).

## Features

- **Docs without folder wrangling** — create, rename and delete docs from the app. Name a doc `team/standup` and it's grouped under "team" automatically.
- **Plain files** — every doc is a normal `.md` file, so you can still open, edit, back up or version it with any other tool. Changes made outside the app show up live.
- **Rich preview** — GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks, footnotes), KaTeX math (`$inline$`, `$$block$$`), and Mermaid diagrams. Raw HTML is allowed but sanitized.
- **Editor** — toggle between Preview and raw Markdown. Saves are atomic, and you're asked before overwriting a file that changed on disk since you opened it.
- **Table of contents** — built from h1–h4, with smooth scrolling and scroll-spy highlighting.
- **Anchored comments** — select text in the preview and click **Comment**, or add a general note. Threads support replies, edits, deletion, and resolve/reopen. Comment bodies are Markdown. If the quoted text disappears from the doc, the thread is flagged.
- **Export PDF** — prints just the rendered doc, with no app chrome.
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

### Run the tests

```sh
cd src-tauri && cargo test
```

## Where your data lives

```
~/Library/Application Support/dev.thakurcoder.markdown-docs/Docs/
├── welcome.md
├── team/
│   └── standup.md
└── .docs/
    └── comments.db      # SQLite: all comment threads
```

Use **File → Show Docs in Finder** (⇧⌘R) to open it. Folders and files starting with `.` are hidden from the sidebar. A doc's id is its path without `.md` (e.g. `team/standup`); comments are keyed by that id and follow the doc when you rename it in the app.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘N | New doc |
| ⌘S | Save |
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
│   ├── NameDialog.tsx
│   └── ui/              shadcn components
└── lib/
    ├── api.ts           typed wrappers around Tauri commands
    └── preview.ts       KaTeX + Mermaid rendering, comment anchoring & highlights

src-tauri/src/           Rust backend
├── main.rs              commands, menu, file watcher
├── docs.rs              file tree, safe paths, atomic save, Markdown → sanitized HTML
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
- No search, multiple libraries, sync, or comment authors yet.
- Images with relative paths (`![](img.png)`) aren't loaded in the preview.
- Comments are lost if a doc is renamed or moved outside the app.
