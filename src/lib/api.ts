import { invoke } from "@tauri-apps/api/core"

export type TreeNode = { name: string; id: string; children: TreeNode[] | null }
export type Hit = { id: string; lines: string[] }
export type Doc = { content: string; mtime: string }
export type Saved = { Ok: string } | { Err: string }
export type Comment = {
  id: number
  parent_id: number | null
  quote: string | null
  quote_start: number | null
  body: string
  body_html: string
  resolved: boolean
  created_at: string
}

/** Where docs are stored; `unavailable` is the chosen folder when it couldn't be opened at launch. */
export type Location = { dir: string; isDefault: boolean; unavailable: string | null }

export const api = {
  rootDir: () => invoke<string>("root_dir"),
  revealRoot: () => invoke<void>("reveal_root"),
  docsLocation: () => invoke<Location>("docs_location"),
  /** `path = null` switches back to the default folder; `copy` copies the current docs into the new folder first. */
  setDocsFolder: (path: string | null, copy: boolean) => invoke<Location>("set_docs_folder", { path, copy }),
  tree: () => invoke<TreeNode[]>("tree"),
  readDoc: (id: string) => invoke<Doc>("read_doc", { id }),
  saveDoc: (id: string, content: string, mtime: string, force: boolean) =>
    invoke<string>("save_doc", { id, content, mtime, force }),
  createDoc: (id: string) => invoke<string>("create_doc", { id }),
  renameDoc: (from: string, to: string) => invoke<string>("rename_doc", { from, to }),
  deleteDoc: (id: string) => invoke<void>("delete_doc", { id }),
  /** Saves an image beside the doc and returns its doc-relative path, e.g. "img/shot.png". */
  saveImage: (doc: string, name: string, data: ArrayBuffer) =>
    invoke<string>("save_image", data, { headers: { doc: encodeURIComponent(doc), name: encodeURIComponent(name) } }),
  /** Copies image files in beside the doc; one `{ Ok: path }` or `{ Err: message }` per file. */
  importImages: (doc: string, paths: string[]) => invoke<Saved[]>("import_images", { doc, paths }),
  /** Saves the image on the system clipboard (Linux), or returns null when there isn't one. */
  pasteImage: (doc: string, name: string) => invoke<string | null>("paste_image", { doc, name }),
  search: (query: string) => invoke<Hit[]>("search", { query }),
  render: (md: string) => invoke<string>("render", { md }),
  comments: (doc: string) => invoke<Comment[]>("list_comments", { doc }),
  addComment: (doc: string, parentId: number | null, quote: string | null, quoteStart: number | null, body: string) =>
    invoke<void>("add_comment", { doc, parentId, quote, quoteStart, body }),
  editComment: (id: number, body: string) => invoke<void>("edit_comment", { id, body }),
  deleteComment: (id: number) => invoke<void>("delete_comment", { id }),
  resolveComment: (id: number, resolved: boolean) => invoke<void>("resolve_comment", { id, resolved }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  print: () => invoke<void>("print"),
  quit: () => invoke<void>("quit"),
}
