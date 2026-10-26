use serde::Serialize;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct Node {
    name: String,
    id: String,
    children: Option<Vec<Node>>,
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

/// Returns the normalized id that was created.
pub fn create(root: &Path, id: &str) -> Result<String, String> {
    let p = new_doc_path(root, id)?;
    let title = p.file_stem().unwrap().to_string_lossy();
    fs::write(&p, format!("# {title}\n\n")).map_err(|e| e.to_string())?;
    Ok(id_of(root, &p))
}

pub fn rename(root: &Path, from: &str, to: &str) -> Result<String, String> {
    let src = doc_path(root, from)?;
    let dst = new_doc_path(root, to)?;
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(id_of(root, &dst))
}

/// Moves the doc to the macOS Trash so a mistaken delete is recoverable.
pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    trash::delete(doc_path(root, id)?).map_err(|e| e.to_string())
}

fn id_of(root: &Path, p: &Path) -> String {
    let rel = p.strip_prefix(root).unwrap_or(p).with_extension("");
    rel.to_string_lossy().into_owned()
}

fn mtime(p: &Path) -> Result<String, String> {
    let t = fs::metadata(p).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string())
}

pub fn read(root: &Path, id: &str) -> Result<Doc, String> {
    let p = doc_path(root, id)?;
    let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(Doc { content, mtime: mtime(&p)? })
}

/// Returns the new mtime, or Err("conflict") when the file changed since `expected` and `force` is false.
pub fn save(root: &Path, id: &str, content: &str, expected: &str, force: bool) -> Result<String, String> {
    let p = doc_path(root, id)?;
    if !force && mtime(&p)? != expected {
        return Err("conflict".into());
    }
    let tmp = p.with_file_name(format!(".{}.{}.tmp", p.file_name().unwrap().to_string_lossy(), std::process::id()));
    let res = (|| {
        fs::write(&tmp, content)?;
        fs::set_permissions(&tmp, fs::metadata(&p)?.permissions())?;
        fs::File::open(&tmp)?.sync_all()?;
        fs::rename(&tmp, &p)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    mtime(&p)
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
    o.extension.header_id_prefix = Some(String::new());
    o.render.r#unsafe = true;
    let html = comrak::markdown_to_html(md, &o);
    ammonia::Builder::default()
        .add_tags(["input"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("span", ["data-math-style"])
        .add_generic_attributes(["class", "id"])
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
        assert_eq!(create(&root, "team/standup.md").unwrap(), "team/standup");
        assert!(create(&root, "team/standup").is_err(), "duplicate");
        assert!(create(&root, "../evil").is_err() && create(&root, ".hidden").is_err() && create(&root, " ").is_err());
        assert_eq!(rename(&root, "team/standup", "daily/standup").unwrap(), "daily/standup");
        assert!(root.join("daily/standup.md").exists() && !root.join("team/standup.md").exists());
        assert!(rename(&root, "a", "daily/standup").is_err(), "no overwrite on rename");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sanitizes_and_keeps_classes() {
        let h = render("# Hi there\n\n<script>x</script><b class=\"evil math-x\" onclick=\"y\">b</b>\n\n```rust\nfn\n```\n\n$a^2$");
        assert!(!h.contains("<script") && !h.contains("onclick") && !h.contains("evil"), "{h}");
        assert!(h.contains(r#"class="math-x""#) && h.contains("language-rust") && h.contains(r#"id="hi-there""#), "{h}");
        assert!(h.contains(r#"data-math-style="inline""#), "{h}");
    }
}
