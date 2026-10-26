import { invoke } from "@tauri-apps/api/core"

export type TreeNode = { name: string; id: string; children: TreeNode[] | null }
export type Doc = { content: string; mtime: string }
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

export const api = {
  rootDir: () => invoke<string>("root_dir"),
  revealRoot: () => invoke<void>("reveal_root"),
  tree: () => invoke<TreeNode[]>("tree"),
  readDoc: (id: string) => invoke<Doc>("read_doc", { id }),
  saveDoc: (id: string, content: string, mtime: string, force: boolean) =>
    invoke<string>("save_doc", { id, content, mtime, force }),
  createDoc: (id: string) => invoke<string>("create_doc", { id }),
  renameDoc: (from: string, to: string) => invoke<string>("rename_doc", { from, to }),
  deleteDoc: (id: string) => invoke<void>("delete_doc", { id }),
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
