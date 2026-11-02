use serde::Serialize;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct Node {
    name: String,
    pub(crate) id: String,
    pub(crate) children: Option<Vec<Node>>,
}

#[derive(Serialize)]
pub struct Doc {
    content: String,
    mtime: String,
}

/// Recursive listing: `.md` files and folders that contain one, dot-entries skipped.
pub fn tree(root: &Path) -> Vec<Node> {
    walk(root, "")
}

fn walk(dir: &Path, prefix: &str) -> Vec<Node> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut out = vec![];
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // ponytail: file_type() doesn't follow symlinks, so symlinked folders are skipped (no loop risk)
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let id = format!("{prefix}{name}");
            let children = walk(&e.path(), &format!("{id}/"));
            if !children.is_empty() {
                out.push(Node { name, id, children: Some(children) });
            }
        } else if let Some(stem) = name.strip_suffix(".md") {
            out.push(Node { name: stem.into(), id: format!("{prefix}{stem}"), children: None });
        }
    }
    out.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    out
}

/// One place a query matched: the text around it, and where it is so the app can go there.
#[derive(Serialize)]
pub struct Match {
    /// 1-based line in the file.
    line: usize,
    /// Which occurrence on that line (0 = first).
    nth: usize,
    before: String,
    text: String,
    after: String,
    /// In the YAML properties, which Preview shows as a card rather than as doc text.
    properties: bool,
}

#[derive(Serialize)]
pub struct Hit {
    id: String,
    /// The first few matches.
    matches: Vec<Match>,
    /// Matches in the whole doc.
    total: usize,
}

const SHOWN_MATCHES: usize = 5;

/// A line as a reader sees it: without emphasis and code markers, block prefixes or link targets.
fn plain_line(line: &str) -> String {
    let line = line.trim();
    let line = line.trim_start_matches(['#', '>']).trim_start();
    let line = ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "* [X] ", "- ", "+ ", "* "].iter().find_map(|p| line.strip_prefix(p)).unwrap_or(line);
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' | '`' => i += 1,
            '~' if chars.get(i + 1) == Some(&'~') => i += 2,
            '!' if chars.get(i + 1) == Some(&'[') => i += 1,
            '[' => {
                // [text](target) keeps only the text.
                let close = chars[i..].iter().position(|&c| c == ']').map(|n| i + n);
                let end = close.filter(|&c| chars.get(c + 1) == Some(&'(')).and_then(|c| chars[c..].iter().position(|&c| c == ')').map(|n| (c, c + n)));
                match end {
                    Some((c, e)) => {
                        out += &plain_line(&chars[i + 1..c].iter().collect::<String>());
                        i = e + 1;
                    }
                    None => {
                        out.push('[');
                        i += 1;
                    }
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// Case folding that keeps one char per char, so match positions carry over to the original text.
fn folded(s: &str) -> Vec<char> {
    s.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect()
}

/// Every non-overlapping occurrence of `q` (folded) in `text`, with the text around it.
fn matches_in(text: &str, q: &[char], line: usize, prefix: &str, properties: bool) -> Vec<Match> {
    let chars: Vec<char> = text.chars().collect();
    let hay: Vec<char> = folded(text);
    let mut out = vec![];
    let mut i = 0;
    while i + q.len() <= hay.len() {
        if hay[i..i + q.len()] != *q {
            i += 1;
            continue;
        }
        let end = i + q.len();
        // Little context before the match, so it stays visible when the snippet is cut to one row.
        let from = i.saturating_sub(40);
        let to = (end + 120).min(chars.len());
        let before = format!("{}{prefix}{}", if from > 0 { "…" } else { "" }, chars[from..i].iter().collect::<String>());
        let after = format!("{}{}", chars[end..to].iter().collect::<String>(), if to < chars.len() { "…" } else { "" });
        out.push(Match { line, nth: out.len(), before: before.trim_start().into(), text: chars[i..end].iter().collect(), after, properties });
        i = end;
    }
    out
}

/// A doc's matches. Text is compared as the reader sees it, then as written (for link targets and the like).
/// Property names aren't searched, or "status" would match every doc; properties only count when the body has no match.
fn doc_matches(text: &str, q: &[char]) -> Vec<Match> {
    let head = crate::meta::front_matter_len(text).unwrap_or(0);
    let head_lines = text[..head].lines().count();
    let (mut body, mut props) = (vec![], vec![]);
    for (n, l) in text.lines().enumerate() {
        if n < head_lines {
            let (key, value) = match l.split_once(':') {
                Some((k, v)) if !k.starts_with(char::is_whitespace) && !k.starts_with('-') => (format!("{k}: "), v.trim()),
                _ => (String::new(), l.trim()),
            };
            if n > 0 && n + 1 < head_lines {
                props.extend(matches_in(value, q, n + 1, &key, true));
            }
            continue;
        }
        let found = matches_in(&plain_line(l), q, n + 1, "", false);
        body.extend(if found.is_empty() { matches_in(l.trim(), q, n + 1, "", false) } else { found });
    }
    if body.is_empty() { props } else { body }
}

/// Case-insensitive full-text search over names and contents. Name matches rank first, then by match count.
/// ponytail: rescans every file per query; fine for hundreds of docs, add an FTS5 index if libraries get big.
pub fn search(root: &Path, query: &str) -> Vec<Hit> {
    let q = query.trim();
    if q.is_empty() {
        return vec![];
    }
    let needle = folded(q);
    let name_q = q.to_lowercase();
    let mut ids = vec![];
    fn flatten(nodes: Vec<Node>, out: &mut Vec<String>) {
        for n in nodes {
            match n.children {
                Some(c) => flatten(c, out),
                None => out.push(n.id),
            }
        }
    }
    flatten(tree(root), &mut ids);
    let mut hits: Vec<(bool, Hit)> = ids
        .into_iter()
        .filter_map(|id| {
            let text = fs::read_to_string(root.join(format!("{id}.md"))).unwrap_or_default();
            let mut matches = doc_matches(&text, &needle);
            let in_name = id.to_lowercase().contains(&name_q);
            (in_name || !matches.is_empty()).then(|| {
                let total = matches.len();
                matches.truncate(SHOWN_MATCHES);
                (in_name, Hit { id, matches, total })
            })
        })
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total.cmp(&a.1.total)).then_with(|| natural_cmp(&a.1.id, &b.1.id)));
    hits.into_iter().take(50).map(|h| h.1).collect()
}

/// Case-insensitive, numeric-aware: "2" < "10".
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut x, mut y) = (a.as_str(), b.as_str());
    loop {
        match (x.chars().next(), y.chars().next()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let n = x.find(|c: char| !c.is_ascii_digit()).unwrap_or(x.len());
                let m = y.find(|c: char| !c.is_ascii_digit()).unwrap_or(y.len());
                let (p, q) = (x[..n].trim_start_matches('0'), y[..m].trim_start_matches('0'));
                let o = p.len().cmp(&q.len()).then_with(|| p.cmp(q));
                if o != Ordering::Equal {
                    return o;
                }
                (x, y) = (&x[n..], &y[m..]);
            }
            (Some(c), Some(d)) => {
                if c != d {
                    return c.cmp(&d);
                }
                (x, y) = (&x[c.len_utf8()..], &y[d.len_utf8()..]);
            }
        }
    }
}

/// Resolves a doc id to its file, rejecting anything that lands outside `root` (which is canonical).
fn doc_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let rel = Path::new(id);
    if id.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Invalid doc path: {id}"));
    }
    let p = fs::canonicalize(root.join(format!("{id}.md"))).map_err(|e| e.to_string())?;
    if !p.starts_with(root) {
        return Err(format!("Doc is outside the folder: {id}"));
    }
    Ok(p)
}

/// Path for a doc that doesn't exist yet. Creates missing parent folders ("team/standup" → team/).
fn new_doc_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let id = id.trim().trim_end_matches(".md");
    let ok = Path::new(id).components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
    if id.is_empty() || !ok {
        return Err("Use a plain name like \"notes\" or \"team/standup\"".into());
    }
    let p = root.join(format!("{id}.md"));
    if p.exists() {
        return Err(format!("\"{id}\" already exists"));
    }
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    if !fs::canonicalize(p.parent().unwrap()).map_err(|e| e.to_string())?.starts_with(root) {
        return Err("Doc is outside the folder".into());
    }
    Ok(p)
}

/// Creates a doc from template `template` (None = blank, with default properties). Returns the normalized id.
pub fn create(root: &Path, id: &str, template: Option<&str>) -> Result<String, String> {
    let p = new_doc_path(root, id)?;
    let text = crate::meta::new_doc_text(root, &p.file_stem().unwrap().to_string_lossy(), template)?;
    fs::write(&p, text).map_err(|e| e.to_string())?;
    Ok(id_of(root, &p))
}

/// Path for a folder that doesn't exist yet, with the same naming rules as docs. Creates missing parents.
fn new_folder_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let ok = Path::new(id).components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
    if id.is_empty() || !ok {
        return Err("Use a plain name like \"notes\" or \"team/2026\"".into());
    }
    let p = root.join(id);
    if p.exists() {
        return Err(format!("\"{id}\" already exists"));
    }
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    if !fs::canonicalize(p.parent().unwrap()).map_err(|e| e.to_string())?.starts_with(root) {
        return Err("Folder is outside the docs folder".into());
    }
    Ok(p)
}

/// Moves the doc to the Trash so a mistaken delete is recoverable. Its version history is dropped.
pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    trash::delete(doc_path(root, id)?).map_err(|e| e.to_string())?;
    crate::history::delete(root, &format!("{id}.md"));
    Ok(())
}

/// Moves a folder and everything in it to the Trash.
pub fn delete_folder(root: &Path, id: &str) -> Result<(), String> {
    let p = folder_path(root, id)?;
    if p == root {
        return Err("Can't delete the docs folder itself".into());
    }
    trash::delete(p).map_err(|e| e.to_string())?;
    crate::history::delete(root, id);
    Ok(())
}

/// Doc ids always use '/', matching `tree`, even where the OS separator is '\'.
fn id_of(root: &Path, p: &Path) -> String {
    rel_path(root, &p.with_extension(""))
}

/// `p` relative to `root`, '/'-separated. Folder ids are this (no extension to strip: "v1.2" stays "v1.2").
fn rel_path(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

fn mtime(p: &Path) -> Result<String, String> {
    let t = fs::metadata(p).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string())
}

fn mtime_ms(p: &Path) -> u64 {
    let t = fs::metadata(p).and_then(|m| m.modified()).ok();
    t.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

pub fn read(root: &Path, id: &str) -> Result<Doc, String> {
    let p = doc_path(root, id)?;
    let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(Doc { content, mtime: mtime(&p)? })
}

/// Returns the new mtime, or Err("conflict") when the file changed since `expected` and `force` is false.
/// The text being replaced goes into the version history first (see `history::snapshot`).
pub fn save(root: &Path, id: &str, content: &str, expected: &str, force: bool) -> Result<String, String> {
    let p = doc_path(root, id)?;
    if !force && mtime(&p)? != expected {
        return Err("conflict".into());
    }
    keep_version(root, id, &p, false);
    write_atomic(&p, content)?;
    mtime(&p)
}

/// Snapshots the doc's current text. Best effort: a history problem never stops a save.
fn keep_version(root: &Path, id: &str, p: &Path, force: bool) {
    if let Ok(old) = fs::read_to_string(p) {
        let _ = crate::history::snapshot(root, id, &old, mtime_ms(p), force);
    }
}

/// Puts back an earlier version of the doc, keeping the current text in the history first. Returns the new mtime.
pub fn restore(root: &Path, id: &str, version: &str) -> Result<String, String> {
    let p = doc_path(root, id)?;
    let text = crate::history::read(root, id, version)?;
    keep_version(root, id, &p, true);
    write_atomic(&p, &text)?;
    mtime(&p)
}

/// Replaces an existing file via a temp file + rename, keeping its permissions.
pub(crate) fn write_atomic(p: &Path, content: &str) -> Result<(), String> {
    let tmp = p.with_file_name(format!(".{}.{}.tmp", p.file_name().unwrap().to_string_lossy(), std::process::id()));
    let res = (|| {
        fs::write(&tmp, content)?;
        fs::set_permissions(&tmp, fs::metadata(p)?.permissions())?;
        // Write access: Windows refuses to flush a read-only handle.
        fs::OpenOptions::new().write(true).open(&tmp)?.sync_all()?;
        fs::rename(&tmp, p)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// Resolves a folder id ("" = the root) to its path, rejecting anything outside `root`.
fn folder_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let ok = id.is_empty() || Path::new(id).components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
    if !ok {
        return Err(format!("Invalid folder: {id}"));
    }
    let p = fs::canonicalize(root.join(id)).map_err(|_| format!("Folder not found: {id}"))?;
    if !p.starts_with(root) || !p.is_dir() {
        return Err(format!("Folder not found: {id}"));
    }
    Ok(p)
}

/// Moves a doc (or a folder, with everything in it) into folder `to` ("" = the top level), keeping its name.
/// See `relocate`. Returns the moved item's new id.
pub fn move_item(root: &Path, from: &str, folder: bool, to: &str) -> Result<String, String> {
    let src = if folder { folder_path(root, from)? } else { doc_path(root, from)? };
    let dst_dir = folder_path(root, to)?;
    if src.parent() == Some(dst_dir.as_path()) {
        return Ok(from.to_string());
    }
    let name = from.rsplit('/').next().unwrap();
    relocate(root, from, folder, &if to.is_empty() { name.to_string() } else { format!("{to}/{name}") })
}

/// Moves or renames a doc or folder to the id `to` ("team/standup"); missing parent folders are created.
/// Never overwrites, and a folder can't go inside itself. Afterwards relative links and images in every doc
/// are rewritten so they still point at the same files. Returns the new id.
pub fn relocate(root: &Path, from: &str, folder: bool, to: &str) -> Result<String, String> {
    let src = if folder { folder_path(root, from)? } else { doc_path(root, from)? };
    if src == root {
        return Err("Can't move the docs folder itself".into());
    }
    let to = to.trim().trim_matches('/');
    let wanted = if folder { root.join(to) } else { root.join(format!("{}.md", to.trim_end_matches(".md"))) };
    if wanted == src {
        return Ok(from.to_string());
    }
    if folder && wanted.starts_with(&src) {
        return Err("A folder can't be moved into itself".into());
    }
    let dst = if folder { new_folder_path(root, to)? } else { new_doc_path(root, to)? };
    let id = |p: &Path| if folder { rel_path(root, p) } else { id_of(root, p) };
    let (old, new) = (id(&src), id(&dst));
    // Every doc's text and where it lives now, read before anything moves.
    let mut docs = vec![];
    fn flatten(nodes: Vec<Node>, out: &mut Vec<String>) {
        for n in nodes {
            match n.children {
                Some(c) => flatten(c, out),
                None => out.push(n.id),
            }
        }
    }
    flatten(tree(root), &mut docs);
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;

    // Root-relative file paths: the moved doc's file, or anything under the moved folder.
    let (old_file, new_file) = if folder { (old.clone(), new.clone()) } else { (format!("{old}.md"), format!("{new}.md")) };
    let map = |p: &str| -> String {
        match p.strip_prefix(old_file.as_str()) {
            Some(rest) if rest.is_empty() || (folder && rest.starts_with('/')) => format!("{new_file}{rest}"),
            _ => p.to_string(),
        }
    };
    let _ = crate::history::relocate(root, &old_file, &new_file);
    let mut failed = vec![];
    for id in docs {
        let (was, now) = (format!("{id}.md"), map(&format!("{id}.md")));
        let p = root.join(&now);
        let Ok(text) = fs::read_to_string(&p) else { continue };
        if let Some(fixed) = crate::relink::rewrite(&text, &was, &now, &map) {
            if let Err(e) = write_atomic(&p, &fixed) {
                failed.push(format!("{now}: {e}"));
            }
        }
    }
    if !failed.is_empty() {
        return Err(format!("Moved, but some links couldn’t be updated ({})", failed.join("; ")));
    }
    Ok(new)
}

const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"];

/// Saves an image into an `img/` folder beside the doc and returns its path relative to the doc, for `![](…)`.
/// The name is reduced to letters, digits, '-' and '_', and never overwrites: "shot.png" → "shot-2.png".
pub fn save_image(root: &Path, doc: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    let name = Path::new(name);
    let ext = name
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| IMAGE_EXTS.contains(&e.as_str()))
        .ok_or("Only PNG, JPEG, GIF, WebP, SVG and AVIF images can be added")?;
    let stem = name.file_stem().unwrap_or_default().to_string_lossy();
    let stem = stem.split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_')).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    let stem = if stem.is_empty() { "image".into() } else { stem };
    let dir = doc_path(root, doc)?.parent().unwrap().join("img");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if !fs::canonicalize(&dir).map_err(|e| e.to_string())?.starts_with(root) {
        return Err("The img folder is outside the docs folder".into());
    }
    for n in 1.. {
        let file = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") };
        let p = dir.join(&file);
        match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                return match f.write_all(bytes) {
                    Ok(()) => Ok(format!("img/{file}")),
                    Err(e) => {
                        let _ = fs::remove_file(&p);
                        Err(e.to_string())
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    unreachable!()
}

/// GFM + math to sanitized HTML. Keeps ids, `language-*`/`math-*` classes and comrak's math spans.
pub fn render(md: &str) -> String {
    let mut o = comrak::Options::default();
    o.extension.table = true;
    o.extension.tasklist = true;
    o.extension.strikethrough = true;
    o.extension.autolink = true;
    o.extension.footnotes = true;
    o.extension.math_dollars = true;
    // Properties are shown as a card by the app, not as text.
    o.extension.front_matter_delimiter = Some("---".into());
    o.extension.header_id_prefix = Some(String::new());
    o.render.r#unsafe = true;
    // Lets a search result find the block its source line became.
    o.render.sourcepos = true;
    let html = comrak::markdown_to_html(md, &o);
    ammonia::Builder::default()
        .add_tags(["input"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("span", ["data-math-style"])
        .add_generic_attributes(["class", "id", "data-sourcepos"])
        .attribute_filter(|_, attr, val| {
            if attr != "class" {
                return Some(Cow::Borrowed(val));
            }
            let keep: Vec<_> = val.split_whitespace().filter(|c| c.starts_with("language-") || c.starts_with("math-")).collect();
            (!keep.is_empty()).then(|| Cow::Owned(keep.join(" ")))
        })
        .clean(&html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_text_as_read() {
        let q = |s: &str| folded(s);
        let doc = "---\ntitle: \"Plan\"\ntags: [q4, status]\nstatus: draft\n---\n\n# Big plan\n\n- [ ] Read **the big** [docs](https://example.com/guide) now\nplan plan\n";
        let m = doc_matches(doc, &q("the big docs"));
        assert_eq!((m[0].line, m[0].before.as_str(), m[0].text.as_str(), m[0].after.as_str()), (9, "Read ", "the big docs", " now"));
        let m = doc_matches(doc, &q("example.com"));
        assert_eq!(m[0].line, 9, "link targets match as written");
        assert_eq!(doc_matches(doc, &q("PLAN")).iter().map(|m| (m.line, m.nth)).collect::<Vec<_>>(), [(7, 0), (10, 0), (10, 1)], "body wins over properties");
        let m = doc_matches(doc, &q("draft"));
        assert!(m[0].properties && m[0].before == "status: " && m[0].line == 4, "property values match");
        assert_eq!(doc_matches("---\nstatus: x\ntags: []\n---\nbody", &q("status")).len(), 0, "property names don't");
        let long = format!("{} needle {}", "a".repeat(100), "b".repeat(200));
        let m = doc_matches(&long, &q("needle"));
        assert!(m[0].before.starts_with('…') && m[0].before.chars().count() <= 41 && m[0].after.ends_with('…'));
    }

    #[test]
    fn natural_order() {
        let mut v = vec!["10-b", "2-a", "Apple", "1", "item10", "item9", "banana"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["1", "2-a", "10-b", "Apple", "banana", "item9", "item10"]);
    }

    #[test]
    fn rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("mdtest-{}", std::process::id()));
        fs::create_dir_all(dir.join("root")).unwrap();
        fs::write(dir.join("secret.md"), "x").unwrap();
        let root = fs::canonicalize(dir.join("root")).unwrap();
        assert!(doc_path(&root, "../secret").is_err());
        assert!(doc_path(&root, "/etc/passwd").is_err());
        fs::write(root.join("a.md"), "hi").unwrap();
        let d = read(&root, "a").unwrap();
        assert_eq!(save(&root, "a", "new", "0", false), Err("conflict".into()));
        save(&root, "a", "new", &d.mtime, false).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "new");
        assert_eq!(create(&root, "team/standup.md", None).unwrap(), "team/standup");
        assert!(create(&root, "team/standup", None).is_err(), "duplicate");
        assert!(create(&root, "../evil", None).is_err() && create(&root, ".hidden", None).is_err() && create(&root, " ", None).is_err());
        assert_eq!(relocate(&root, "team/standup", false, "daily/standup").unwrap(), "daily/standup");
        assert!(root.join("daily/standup.md").exists() && !root.join("team/standup.md").exists());
        assert!(relocate(&root, "a", false, "daily/standup").is_err(), "no overwrite on rename");
        fs::write(root.join("b.md"), "Alpha\nbeta GAMMA\ngamma again").unwrap();
        let hits = search(&root, "gamma");
        assert_eq!(hits.len(), 1);
        let found: Vec<_> = hits[0].matches.iter().map(|m| (m.line, m.before.as_str(), m.text.as_str(), m.after.as_str())).collect();
        assert_eq!(found, [(2, "beta ", "GAMMA", ""), (3, "", "gamma", " again")]);
        assert_eq!(hits[0].total, 2);
        assert_eq!(search(&root, "standup")[0].id, "daily/standup", "name match");
        assert!(search(&root, "  ").is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saves_images_beside_the_doc() {
        let dir = std::env::temp_dir().join(format!("mdimg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("team")).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        fs::write(root.join("team/standup.md"), "").unwrap();
        assert_eq!(save_image(&root, "team/standup", "My Shot (1).PNG", b"a").unwrap(), "img/My-Shot-1.png");
        assert_eq!(save_image(&root, "team/standup", "My Shot (1).png", b"b").unwrap(), "img/My-Shot-1-2.png", "no overwrite");
        assert_eq!(fs::read(root.join("team/img/My-Shot-1.png")).unwrap(), b"a");
        assert_eq!(save_image(&root, "team/standup", "../../ .png", b"c").unwrap(), "img/image.png");
        assert!(save_image(&root, "team/standup", "notes.txt", b"x").is_err());
        assert!(save_image(&root, "../x", "a.png", b"x").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn moves_docs_and_folders_and_fixes_links() {
        let dir = std::env::temp_dir().join(format!("mdmove-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("team/img")).unwrap();
        fs::create_dir_all(dir.join("archive")).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        fs::write(root.join("team/standup.md"), "![s](img/s.png) [n](../notes.md) [r](retro.md)").unwrap();
        fs::write(root.join("team/retro.md"), "[s](standup.md)").unwrap();
        fs::write(root.join("team/img/s.png"), "png").unwrap();
        fs::write(root.join("notes.md"), "[s](team/standup.md) [r](team/retro.md)").unwrap();
        fs::write(root.join("archive/keep.md"), "").unwrap();
        let read = |p: &str| fs::read_to_string(root.join(p)).unwrap();

        // A doc out to the top level: its links and the links to it follow.
        assert_eq!(move_item(&root, "team/standup", false, "").unwrap(), "standup");
        assert_eq!(read("standup.md"), "![s](team/img/s.png) [n](notes.md) [r](team/retro.md)");
        assert_eq!(read("notes.md"), "[s](standup.md) [r](team/retro.md)");
        assert_eq!(read("team/retro.md"), "[s](../standup.md)");

        // A folder into another folder.
        assert_eq!(move_item(&root, "team", true, "archive").unwrap(), "archive/team");
        assert!(root.join("archive/team/img/s.png").exists() && !root.join("team").exists());
        assert_eq!(read("standup.md"), "![s](archive/team/img/s.png) [n](notes.md) [r](archive/team/retro.md)");
        assert_eq!(read("archive/team/retro.md"), "[s](../../standup.md)");

        // Renaming a folder fixes links into it; renaming a doc fixes links to it.
        assert_eq!(relocate(&root, "archive/team", true, "archive/crew").unwrap(), "archive/crew");
        assert_eq!(read("standup.md"), "![s](archive/crew/img/s.png) [n](notes.md) [r](archive/crew/retro.md)");
        assert_eq!(relocate(&root, "standup", false, "daily").unwrap(), "daily");
        assert_eq!(read("archive/crew/retro.md"), "[s](../../daily.md)");
        assert!(relocate(&root, "archive", true, "archive/crew/x").is_err(), "into itself");
        assert!(relocate(&root, "archive", true, ".hidden").is_err() && relocate(&root, "archive", true, "../out").is_err());

        // Folder names with dots keep them.
        fs::create_dir_all(root.join("v1.2")).unwrap();
        fs::write(root.join("v1.2/a.md"), "").unwrap();
        assert_eq!(move_item(&root, "v1.2", true, "archive").unwrap(), "archive/v1.2");

        // Same folder is a no-op; clashes, self-nesting and escapes are refused.
        assert_eq!(move_item(&root, "notes", false, "").unwrap(), "notes");
        assert_eq!(relocate(&root, "notes", false, "notes").unwrap(), "notes");
        fs::write(root.join("archive/crew/notes.md"), "").unwrap();
        assert!(move_item(&root, "notes", false, "archive/crew").is_err(), "clash");
        assert!(move_item(&root, "archive", true, "archive/crew").is_err(), "into itself");
        assert!(move_item(&root, "archive", true, "archive").is_err(), "into itself");
        assert!(move_item(&root, "notes", false, "../").is_err() && move_item(&root, "", true, "archive").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_versions_on_save_and_restores() {
        let dir = std::env::temp_dir().join(format!("mdver-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        fs::write(root.join("a.md"), "first").unwrap();
        let m = save(&root, "a", "second", &read(&root, "a").unwrap().mtime, false).unwrap();
        save(&root, "a", "third", &m, false).unwrap(); // within five minutes: no new snapshot
        let v = crate::history::list(&root, "a");
        assert_eq!(v.len(), 1);
        assert_eq!(crate::history::read(&root, "a", &v[0].id).unwrap(), "first");
        restore(&root, "a", &v[0].id).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "first");
        assert_eq!(crate::history::list(&root, "a").len(), 2, "the replaced text is kept");
        relocate(&root, "a", false, "b").unwrap();
        assert_eq!(crate::history::list(&root, "b").len(), 2, "history follows a rename");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sanitizes_and_keeps_classes() {
        let h = render("# Hi there\n\n<script>x</script><b class=\"evil math-x\" onclick=\"y\">b</b>\n\n```rust\nfn\n```\n\n$a^2$");
        assert!(!h.contains("<script") && !h.contains("onclick") && !h.contains("evil"), "{h}");
        assert!(h.contains(r#"class="math-x""#) && h.contains("language-rust") && h.contains(r#"id="hi-there""#), "{h}");
        assert!(h.contains(r#"data-math-style="inline""#), "{h}");
        let p = render("---\ntitle: x\n---\n\nHi");
        assert!(!p.contains("title") && p.contains(r#"data-sourcepos="5:1-5:2""#), "properties aren't rendered, lines count from the top of the file: {p}");
    }
}
