//! Keeps relative links and images pointing at the same files after docs or folders move.
//! Paths here are relative to the docs root and use '/', like doc ids ("team/standup.md").

use percent_encoding::percent_decode_str;

/// Rewrites the relative link and image destinations in `md`, a doc that moved from `old_doc` to `new_doc`,
/// after files moved as `map` describes. Code blocks and code spans are left alone.
/// Returns None when nothing needed changing.
pub fn rewrite(md: &str, old_doc: &str, new_doc: &str, map: &dyn Fn(&str) -> String) -> Option<String> {
    let (old_dir, new_dir) = (parent(old_doc), parent(new_doc));
    let mut edits: Vec<(usize, usize, String)> = vec![];
    for (start, end) in destinations(md) {
        if let Some(new) = relink(&md[start..end], old_dir, new_dir, map) {
            edits.push((start, end, new));
        }
    }
    if edits.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(md.len());
    let mut last = 0;
    for (start, end, new) in edits {
        out.push_str(&md[last..start]);
        out.push_str(&new);
        last = end;
    }
    out.push_str(&md[last..]);
    Some(out)
}

/// The new destination for `dest`, or None when it's not relative or still points at the right file.
fn relink(dest: &str, old_dir: &str, new_dir: &str, map: &dyn Fn(&str) -> String) -> Option<String> {
    let has_scheme = dest.split_once(':').is_some_and(|(s, _)| {
        s.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    });
    if dest.is_empty() || dest.starts_with(['#', '/']) || has_scheme {
        return None;
    }
    let cut = dest.find(['?', '#']).unwrap_or(dest.len());
    let (path, suffix) = dest.split_at(cut);
    let decoded = percent_decode_str(path).decode_utf8().ok()?;
    let target = map(&resolve(old_dir, &decoded)?);
    if resolve(new_dir, &decoded).as_deref() == Some(target.as_str()) {
        return None;
    }
    Some(format!("{}{suffix}", encode(&relative(new_dir, &target))))
}

/// Spaces and parentheses would end or confuse a Markdown destination.
fn encode(path: &str) -> String {
    path.replace('%', "%25").replace(' ', "%20").replace('(', "%28").replace(')', "%29")
}

fn parent(file: &str) -> &str {
    file.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// `path` relative to folder `dir` → a root-relative path, or None if it climbs above the root.
pub fn resolve(dir: &str, path: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// The relative path from folder `dir` to root-relative `target`.
fn relative(dir: &str, target: &str) -> String {
    let from: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    let to: Vec<&str> = target.split('/').filter(|s| !s.is_empty()).collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts = vec![".."; from.len() - common];
    parts.extend(&to[common..]);
    if parts.is_empty() { ".".into() } else { parts.join("/") }
}

/// Byte ranges of link/image destinations: inline `[text](dest "title")`, `<dest>` forms, and reference
/// definitions `[ref]: dest`. Skips fenced code blocks and code spans.
fn destinations(md: &str) -> Vec<(usize, usize)> {
    let mut out = vec![];
    let mut fence: Option<(char, usize)> = None;
    let mut offset = 0;
    for line in md.split_inclusive('\n') {
        let base = offset;
        offset += line.len();
        let trimmed = line.trim_start_matches(' ');
        let indent = line.len() - trimmed.len();
        let run = |c: char| trimmed.chars().take_while(|&x| x == c).count();
        if indent <= 3 {
            if let Some((c, n)) = fence {
                if run(c) >= n && trimmed.trim_start_matches(c).trim().is_empty() {
                    fence = None;
                }
                continue;
            }
            if let Some(c) = ['`', '~'].into_iter().find(|&c| run(c) >= 3) {
                fence = Some((c, run(c)));
                continue;
            }
            // Reference definition: [label]: dest
            if trimmed.starts_with('[') && !trimmed.starts_with("[^") {
                if let Some(close) = trimmed.find("]:") {
                    let rest = &trimmed[close + 2..];
                    let skip = rest.len() - rest.trim_start().len();
                    let at = base + indent + close + 2 + skip;
                    if let Some(range) = destination_at(md, at) {
                        out.push(range);
                    }
                    continue;
                }
            }
        } else if fence.is_some() {
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'`' => {
                    // Skip a code span: the matching run of backticks.
                    let n = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                    let tick = "`".repeat(n);
                    i = match line[i + n..].find(&tick) {
                        Some(j) => i + n + j + n,
                        None => i + n,
                    };
                }
                b']' if bytes.get(i + 1) == Some(&b'(') => {
                    let rest = &line[i + 2..];
                    let at = base + i + 2 + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
                    if let Some(range) = destination_at(md, at) {
                        i = range.1 - base;
                        out.push(range);
                    } else {
                        i += 2;
                    }
                }
                _ => i += 1,
            }
        }
    }
    out
}

/// The destination starting at byte `at`: `<…>` (inner range) or a run up to whitespace or an unbalanced ')'.
fn destination_at(md: &str, at: usize) -> Option<(usize, usize)> {
    let s = &md[at..];
    if let Some(inner) = s.strip_prefix('<') {
        let end = inner.find(['>', '\n'])?;
        return (inner.as_bytes()[end] == b'>' && end > 0).then_some((at + 1, at + 1 + end));
    }
    let mut depth = 0usize;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return (i > 0).then_some((at, at + i)),
            ')' => depth -= 1,
            c if c.is_whitespace() => return (i > 0).then_some((at, at + i)),
            _ => {}
        }
    }
    (!s.is_empty()).then_some((at, md.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same(p: &str) -> String {
        p.to_string()
    }

    #[test]
    fn moved_doc_keeps_its_links() {
        let md = "![shot](img/shot.png) [setup](../guides/setup.md#install) [web](https://x.io/a) [top](#top)\n";
        let out = rewrite(md, "team/standup.md", "standup.md", &same).unwrap();
        assert_eq!(out, "![shot](team/img/shot.png) [setup](guides/setup.md#install) [web](https://x.io/a) [top](#top)\n");
        assert_eq!(rewrite(md, "team/standup.md", "team/standup.md", &same), None, "nothing moved");
    }

    #[test]
    fn links_follow_moved_targets() {
        // "team" moved into "archive"; a doc outside links into it.
        let map = |p: &str| match p.strip_prefix("team") {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("archive/team{rest}"),
            _ => p.to_string(),
        };
        let md = "[s](team/standup.md) [n](notes.md) [ref]\n\n[ref]: ./team/img/a%20b.png \"title\"\n";
        let out = rewrite(md, "index.md", "index.md", &map).unwrap();
        assert_eq!(out, "[s](archive/team/standup.md) [n](notes.md) [ref]\n\n[ref]: archive/team/img/a%20b.png \"title\"\n");
        // A doc inside the moved folder linking to a sibling needs no change.
        assert_eq!(rewrite("[b](b.md) ![](img/x.png)", "team/a.md", "archive/team/a.md", &map), None);
        // ...but its link out of the folder does.
        assert_eq!(rewrite("[n](../notes.md)", "team/a.md", "archive/team/a.md", &map).unwrap(), "[n](../../notes.md)");
    }

    #[test]
    fn leaves_code_and_odd_destinations_alone() {
        let md = "```\n[a](x.md)\n```\n`[b](x.md)` [c](<my doc.md>) [d](x_(1).md) [e](../../out.md)\n";
        let out = rewrite(md, "f/g.md", "g.md", &same).unwrap();
        assert_eq!(out, "```\n[a](x.md)\n```\n`[b](x.md)` [c](<f/my%20doc.md>) [d](f/x_%281%29.md) [e](../../out.md)\n");
    }

    #[test]
    fn paths() {
        assert_eq!(resolve("a/b", "../c/./d.md").as_deref(), Some("a/c/d.md"));
        assert_eq!(resolve("a", "../../x"), None);
        assert_eq!(relative("a/b", "a/c/d.md"), "../c/d.md");
        assert_eq!(relative("", "x/y.png"), "x/y.png");
        assert_eq!(relative("a", "a"), ".");
    }
}
