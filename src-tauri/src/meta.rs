//! Doc properties (a YAML front matter block at the top of each doc) and templates for new docs.
//! Templates are plain .md files in `.docs/templates/`; `{{title}}`, `{{date}}` and `{{time}}` are filled in.

use std::fs;
use std::path::{Path, PathBuf};

/// The properties every new doc starts with, unless its template says otherwise.
const BLANK: &str = "---
title: \"{{title}}\"
description: \"\"
tags: []
status: draft
created: {{date}}
updated: {{date}}
---

# {{title}}

";

/// Written into `.docs/templates/` the first time templates are needed; after that the folder is the user's.
const STARTERS: [(&str, &str); 4] = [
    ("Blank", BLANK),
    (
        "Meeting notes",
        "---
title: \"{{title}}\"
description: \"\"
tags: [meeting]
status: draft
created: {{date}}
updated: {{date}}
attendees: []
---

# {{title}}

**Date:** {{date}} {{time}}

## Agenda

-

## Notes

## Decisions

## Action items

- [ ]
",
    ),
    (
        "Spec",
        "---
title: \"{{title}}\"
description: \"\"
tags: [spec]
status: draft
created: {{date}}
updated: {{date}}
owner: \"\"
---

# {{title}}

## Summary

## Problem

## Proposal

## Alternatives considered

## Open questions
",
    ),
    (
        "Daily note",
        "---
title: \"{{title}}\"
description: \"\"
tags: [daily]
status: draft
created: {{date}}
updated: {{date}}
---

# {{title}}

## Today

- [ ]

## Notes
",
    ),
];

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Byte length of the front matter block (through its closing `---` line), if the text starts with one.
pub fn front_matter_len(text: &str) -> Option<usize> {
    let rest = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n"))?;
    let mut at = text.len() - rest.len();
    for line in rest.split_inclusive('\n') {
        at += line.len();
        if matches!(line.trim_end(), "---" | "...") {
            return Some(at);
        }
    }
    None
}

/// A YAML double-quoted string.
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Fills a template's placeholders. Inside the front matter the title is escaped for its quoted YAML string.
pub fn fill(template: &str, title: &str, now: chrono::DateTime<chrono::Local>) -> String {
    let (date, time) = (now.format("%Y-%m-%d").to_string(), now.format("%H:%M").to_string());
    let split = front_matter_len(template).unwrap_or(0);
    let (head, body) = template.split_at(split);
    let esc = &quoted(title)[1..quoted(title).len() - 1];
    let sub = |s: &str, t: &str| s.replace("{{title}}", t).replace("{{date}}", &date).replace("{{time}}", &time);
    sub(head, esc) + &sub(body, title)
}

pub fn templates_dir(root: &Path) -> PathBuf {
    root.join(".docs/templates")
}

/// Creates the templates folder with the starter templates, unless it already exists.
pub fn ensure_templates(root: &Path) -> Result<PathBuf, String> {
    let dir = templates_dir(root);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for (name, text) in STARTERS {
            fs::write(dir.join(format!("{name}.md")), text).map_err(|e| e.to_string())?;
        }
    }
    Ok(dir)
}

/// Template names, "Blank" first and the rest in natural order.
pub fn list_templates(root: &Path) -> Result<Vec<String>, String> {
    let dir = ensure_templates(root)?;
    let mut v: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".md").map(String::from))
        .filter(|n| !n.starts_with('.'))
        .collect();
    v.sort_by(|a, b| (a != "Blank").cmp(&(b != "Blank")).then_with(|| crate::docs::natural_cmp(a, b)));
    Ok(v)
}

fn template_name_ok(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\']) && name != ".."
}

/// The text a new doc called `title` starts with: from template `name`, or the built-in blank one.
pub fn new_doc_text(root: &Path, title: &str, name: Option<&str>) -> Result<String, String> {
    let template = match name {
        Some(n) if template_name_ok(n) => fs::read_to_string(templates_dir(root).join(format!("{n}.md"))).map_err(|_| format!("Template “{n}” not found"))?,
        Some(n) => return Err(format!("Invalid template name: {n}")),
        None => BLANK.to_string(),
    };
    Ok(fill(&template, title, chrono::Local::now()))
}

/// Saves a doc's text as a new template: its title, the matching heading and its dates become placeholders.
pub fn save_template(root: &Path, name: &str, text: &str) -> Result<(), String> {
    let name = name.trim().trim_end_matches(".md");
    if !template_name_ok(name) {
        return Err("Use a plain name like “Weekly review”".into());
    }
    let p = ensure_templates(root)?.join(format!("{name}.md"));
    if p.exists() {
        return Err(format!("A template called “{name}” already exists"));
    }
    let split = front_matter_len(text).unwrap_or(0);
    let (head, body) = text.split_at(split);
    let mut title = None;
    let head: String = head
        .split_inclusive('\n')
        .map(|l| {
            let key = l.split(':').next().unwrap_or("").trim();
            match key {
                "title" => {
                    title = Some(l.splitn(2, ':').nth(1).unwrap_or("").trim().trim_matches('"').to_string());
                    "title: \"{{title}}\"\n".to_string()
                }
                "created" | "updated" if !l.starts_with(' ') => format!("{key}: {{{{date}}}}\n"),
                _ => l.to_string(),
            }
        })
        .collect();
    let body = match &title {
        Some(t) if !t.is_empty() => body.replacen(&format!("# {t}\n"), "# {{title}}\n", 1),
        _ => body.to_string(),
    };
    fs::write(p, head + &body).map_err(|e| e.to_string())
}

/// Properties for a doc that has none, from its first heading (or file name) and file dates.
fn properties_for(text: &str, stem: &str, created: &str, updated: &str) -> String {
    let title = text.lines().find_map(|l| l.strip_prefix("# ")).map(str::trim).filter(|t| !t.is_empty()).unwrap_or(stem);
    format!(
        "---\ntitle: {}\ndescription: \"\"\ntags: []\nstatus: \"\"\ncreated: {created}\nupdated: {updated}\n---\n\n",
        quoted(title)
    )
}

fn file_date(t: std::io::Result<std::time::SystemTime>) -> Option<String> {
    Some(chrono::DateTime::<chrono::Local>::from(t.ok()?).format("%Y-%m-%d").to_string())
}

/// Once per docs folder: gives every doc without properties a front matter block. Each doc's original text is
/// kept in its version history first. Returns how many docs changed.
pub fn migrate(root: &Path) -> Result<usize, String> {
    let flag = root.join(".docs/properties-added");
    if flag.exists() {
        return Ok(0);
    }
    let mut ids = vec![];
    fn flatten(nodes: Vec<crate::docs::Node>, out: &mut Vec<String>) {
        for n in nodes {
            match n.children {
                Some(c) => flatten(c, out),
                None => out.push(n.id),
            }
        }
    }
    flatten(crate::docs::tree(root), &mut ids);
    let mut changed = 0;
    for id in ids {
        let p = root.join(format!("{id}.md"));
        let Ok(text) = fs::read_to_string(&p) else { continue };
        if front_matter_len(&text).is_some() {
            continue;
        }
        let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
        let updated = file_date(meta.modified()).unwrap_or_else(today);
        let created = file_date(meta.created()).unwrap_or_else(|| updated.clone());
        let saved_ms = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
        crate::history::snapshot(root, &id, &text, saved_ms, true)?;
        let stem = id.rsplit('/').next().unwrap();
        crate::docs::write_atomic(&p, &(properties_for(&text, stem, &created, &updated) + &text))?;
        changed += 1;
    }
    fs::create_dir_all(flag.parent().unwrap()).and_then(|_| fs::write(&flag, "")).map_err(|e| e.to_string())?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_front_matter() {
        assert_eq!(front_matter_len("---\na: 1\n---\n# x"), Some(13));
        assert_eq!(front_matter_len("---\r\na: 1\r\n---\r\nx"), Some(16));
        assert_eq!(front_matter_len("---\nno end"), None);
        assert_eq!(front_matter_len("# x\n---\n"), None);
    }

    #[test]
    fn fills_templates() {
        let now = chrono::Local::now();
        let date = now.format("%Y-%m-%d").to_string();
        let t = fill(BLANK, "Say \"hi\"", now);
        assert!(t.starts_with(&format!("---\ntitle: \"Say \\\"hi\\\"\"\n")), "{t}");
        assert!(t.contains(&format!("created: {date}\n")) && t.ends_with("# Say \"hi\"\n\n"), "{t}");
    }

    #[test]
    fn migrates_once_and_saves_templates() {
        let dir = std::env::temp_dir().join(format!("mdmeta-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("team")).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        fs::write(root.join("team/standup.md"), "# Daily standup\n\nNotes").unwrap();
        fs::write(root.join("plain.md"), "no heading").unwrap();
        fs::write(root.join("has.md"), "---\ntitle: x\n---\nbody").unwrap();
        assert_eq!(migrate(&root).unwrap(), 2);
        let s = fs::read_to_string(root.join("team/standup.md")).unwrap();
        assert!(s.starts_with("---\ntitle: \"Daily standup\"\n") && s.ends_with("---\n\n# Daily standup\n\nNotes"), "{s}");
        assert!(fs::read_to_string(root.join("plain.md")).unwrap().contains("title: \"plain\""));
        assert_eq!(fs::read_to_string(root.join("has.md")).unwrap(), "---\ntitle: x\n---\nbody");
        assert_eq!(crate::history::list(&root, "team/standup").len(), 1, "original kept");
        fs::write(root.join("new.md"), "later").unwrap();
        assert_eq!(migrate(&root).unwrap(), 0, "only once");

        assert_eq!(list_templates(&root).unwrap(), ["Blank", "Daily note", "Meeting notes", "Spec"]);
        let doc = new_doc_text(&root, "Kickoff", Some("Meeting notes")).unwrap();
        assert!(doc.contains("tags: [meeting]") && doc.contains("# Kickoff\n"));
        assert!(new_doc_text(&root, "x", Some("../secret")).is_err());
        save_template(&root, "Weekly", &s).unwrap();
        let t = fs::read_to_string(templates_dir(&root).join("Weekly.md")).unwrap();
        assert!(t.starts_with("---\ntitle: \"{{title}}\"\n") && t.contains("created: {{date}}\n") && t.contains("# {{title}}\n"), "{t}");
        assert!(save_template(&root, "Weekly", "x").is_err(), "no overwrite");
        assert!(save_template(&root, "a/b", "x").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
