# Markdown Docs

[![CI](https://github.com/thakurcoderz/markdown-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/thakurcoderz/markdown-docs/actions/workflows/ci.yml)

A local app for macOS and Linux for reading and editing Markdown docs, with comment threads anchored to the text — like Google Docs comments, but for plain `.md` files on your machine.

**Website:** https://thakurcoderz.github.io/markdown-docs/

Built with [Tauri v2](https://tauri.app) (Rust backend, native WKWebView on macOS / WebKitGTK on Linux) and React + [shadcn/ui](https://ui.shadcn.com).

## Download

Get the latest build from the [website](https://thakurcoderz.github.io/markdown-docs/#download) or [Releases](https://github.com/thakurcoderz/markdown-docs/releases/latest).

### macOS

Download the **`.dmg`**. It's a universal build for Apple Silicon and Intel Macs on macOS 14 or later.

The app isn't signed yet, so on first launch right-click it → **Open**, or run:

```sh
xattr -dr com.apple.quarantine "/Applications/Markdown Docs.app"
```

### Linux

- **Ubuntu / Debian:** download the **`.deb`** and run `sudo apt install ./Markdown-Docs_*_amd64.deb`. The app then appears in your applications menu.
- **Other distros:** download the **`.AppImage`**, run `chmod +x Markdown-Docs_*.AppImage`, then launch it.

## Features

- **Docs without folder wrangling** — create, rename and delete docs from the app. Name a doc `team/standup` and it's grouped under "team" automatically.
- **Plain files** — every doc is a normal `.md` file, so you can still open, edit, back up or version it with any other tool. Changes made outside the app show up live.
- **Search** — ⌘K opens a palette: type to search doc names and contents, or pick from all docs. Opening a result highlights the first match.
- **Rich preview** — GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks, footnotes), syntax-highlighted code blocks, KaTeX math (`$inline$`, `$$block$$`), and Mermaid diagrams. Raw HTML is allowed but sanitized.
- **Links and images between docs** — `[setup](../guides/setup.md#install)` opens that doc at that heading; `![](img/diagram.png)` loads images relative to the doc.
- **Paste or drop images** — paste a screenshot or drag image files into the editor; they're saved to an `img/` folder next to the doc and linked at the cursor (`![shot](img/shot.png)`). Existing files are never overwritten.
- **Editor** — CodeMirror with Markdown highlighting, line numbers, and find/replace (⌘F). Switch between **Preview**, **Split** (editor + live preview), and **Markdown**.
- **Autosave** — changes are saved a second after you stop typing (⌘S still works). Saves are atomic, and you're asked before overwriting a file that changed on disk since you opened it; if you decline or a save fails, autosave pauses until you save manually.
- **Table of contents** — built from h1–h4, with smooth scrolling and scroll-spy highlighting.
- **Anchored comments** — select text in the preview and click **Comment**, or add a general note. Threads support replies, edits, deletion, and resolve/reopen. Comment bodies are Markdown. If the quoted text disappears from the doc, the thread is flagged.
- **Export PDF** — prints just the rendered doc, with no app chrome.
- **Settings** (⌘,) — a settings page for app preferences: pick any font installed on your computer for the interface/docs and for code/the editor, and choose where your docs are stored. Saved to `settings.json` in the app data folder.
- **Choose your docs folder** — keep docs anywhere, e.g. in a Dropbox, Google Drive or Syncthing folder to use them on several computers. When you switch, the app can copy your current docs and comments across; it never overwrites files that are already there.
- Follows the system light/dark appearance.

On Linux, use <kbd>Ctrl</kbd> wherever this README says <kbd>⌘</kbd>.

## Requirements

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 20.19+ and npm
- **macOS:** macOS 14 (Sonoma) or later — comment highlights use the CSS Custom Highlight API — and Xcode Command Line Tools (`xcode-select --install`)
- **Linux (Ubuntu/Debian):** the WebKitGTK and build packages Tauri needs:

  ```sh
  sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev
  ```

## Getting started

```sh
git clone https://github.com/thakurcoderz/markdown-docs.git
cd markdown-docs
npm install
npm run dev        # run with hot reload
```

### Build the app

On macOS:

```sh
npm run build
```

Outputs:

- `src-tauri/target/release/bundle/macos/Markdown Docs.app`
- `src-tauri/target/release/bundle/dmg/Markdown Docs_<version>_<arch>.dmg`

The build is unsigned. On first launch, right-click the app → **Open** (or allow it in System Settings → Privacy & Security).

On Linux:

```sh
npx tauri build --bundles deb          # add ,appimage for an AppImage too
```

Output: `src-tauri/target/release/bundle/deb/Markdown Docs_<version>_amd64.deb`. Install it with `sudo apt install "./src-tauri/target/release/bundle/deb/Markdown Docs_<version>_amd64.deb"`.

### Publish a release

Releases are built by GitHub Actions (`.github/workflows/release.yml`). Bump `version` in `src-tauri/tauri.conf.json`, commit, then push a matching tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The workflow runs the tests on macOS and Linux, builds a universal `.dmg` and `.app.zip` plus a Linux `.deb` and `.AppImage`, and publishes one GitHub Release with checksums and generated notes. **Actions → Release → Run workflow** does a dry run that uploads the builds as workflow artifacts without publishing. Adding the `APPLE_*` secrets listed at the top of the workflow turns on code signing and notarization.

### Run the tests

CI (`.github/workflows/ci.yml`) runs these on every branch push.

```sh
npm test                    # frontend (Vitest)
cd src-tauri && cargo test  # backend
```

## Where your data lives

By default the docs folder is `~/Library/Application Support/dev.thakurcoder.markdown-docs/Docs/` on macOS and `~/.local/share/dev.thakurcoder.markdown-docs/Docs/` on Linux. Choose a different one in **Settings → Docs folder**; the choice is saved in `location.json` in the app data folder. If that folder can't be found at launch (say, an unplugged drive), the app opens the default folder and tells you.

```
Docs/
├── welcome.md
├── team/
│   └── standup.md
└── .docs/
    └── comments.db      # SQLite: all comment threads
# in the app data folder: settings.json (app preferences), location.json (chosen docs folder)
```

Use **File → Show Docs in Finder** (⇧⌘R) to open it in your file manager. Folders and files starting with `.` are hidden from the sidebar. A doc's id is its path without `.md` (e.g. `team/standup`); comments are keyed by that id and follow the doc when you rename it in the app.

Because comments live inside the docs folder, copying or syncing that folder brings them along. Avoid having the app open on two computers that write to the same synced folder at once: the comments database is a single file, so simultaneous comment edits can produce a sync conflict copy.

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
| ⇧⌘R | Show docs folder |
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
- **Live updates** — a file watcher ([notify](https://github.com/notify-rs/notify): FSEvents on macOS, inotify on Linux) refreshes the tree and reloads the open doc when files change outside the app. Unsaved edits are never overwritten.
- **Links** never navigate the app window: `#anchors` scroll the preview and web links open in your browser.

## Limitations

- macOS and Linux only; there's no Windows build yet.
- Some menu items still use macOS wording on Linux (e.g. "Show Docs in Finder"), and Hide / Hide Others do nothing there.
- No multiple libraries, sync, or comment authors yet.
- Search rescans files on each query — instant for hundreds of docs, not built for tens of thousands.
- Images inside dot-folders (e.g. `.assets/`) aren't loaded.
- Comments are lost if a doc is renamed or moved outside the app.
