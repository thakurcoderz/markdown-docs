//! Version history: snapshots of each doc in `.docs/history/<doc file>/<unix ms>.md`, beside comments.db, so they
//! sync and move with the docs. Before a save overwrites a doc, its previous text is kept (at most every few minutes),
//! and older snapshots are thinned out over time.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Saves closer together than this collapse into one snapshot.
const EVERY_MS: u64 = 5 * 60_000;

#[derive(Serialize)]
pub struct Version {
    /// When this text was saved, in Unix milliseconds; also the snapshot's file name.
    pub id: String,
    size: u64,
}

/// History folder for a root-relative file or folder path ("team/standup.md", "team"). Keyed by file path, so a doc
/// "a" (a.md) and a folder "a" never share one, and a folder's history moves with it in one rename.
fn dir(root: &Path, rel: &str) -> PathBuf {
    root.join(".docs/history").join(rel)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Snapshot times in a history folder, newest first.
fn stamps(dir: &Path) -> Vec<u64> {
    let mut v: Vec<u64> = fs::read_dir(dir)
        .map(|it| it.flatten().filter_map(|e| e.file_name().to_str()?.strip_suffix(".md")?.parse().ok()).collect())
        .unwrap_or_default();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v
}

/// Keeps `text` (doc `id`'s contents as saved at `saved_ms`) unless it's already the newest snapshot, or, without
/// `force`, the newest snapshot is under five minutes old.
pub fn snapshot(root: &Path, id: &str, text: &str, saved_ms: u64, force: bool) -> Result<(), String> {
    let d = dir(root, &format!("{id}.md"));
    let have = stamps(&d);
    if let Some(&last) = have.first() {
        if !force && now_ms().saturating_sub(last) < EVERY_MS {
            return Ok(());
        }
        if fs::read_to_string(d.join(format!("{last}.md"))).is_ok_and(|t| t == text) {
            return Ok(());
        }
    }
    let p = d.join(format!("{saved_ms}.md"));
    if p.exists() {
        return Ok(());
    }
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    fs::write(&p, text).map_err(|e| e.to_string())?;
    for t in prunable(&stamps(&d), now_ms()) {
        let _ = fs::remove_file(d.join(format!("{t}.md")));
    }
    Ok(())
}

/// Snapshots to drop: everything from the last day stays, then one per hour for a week, one per day for 90 days,
/// and one per week after that (the newest in each slot).
fn prunable(newest_first: &[u64], now: u64) -> Vec<u64> {
    const H: u64 = 3_600_000;
    let mut seen = std::collections::HashSet::new();
    newest_first
        .iter()
        .copied()
        .filter(|&t| {
            let age = now.saturating_sub(t);
            let slot = match age {
                a if a < 24 * H => return false,
                a if a < 7 * 24 * H => H,
                a if a < 90 * 24 * H => 24 * H,
                _ => 7 * 24 * H,
            };
            !seen.insert((slot, t / slot))
        })
        .collect()
}

/// Doc `id`'s snapshots, newest first.
pub fn list(root: &Path, id: &str) -> Vec<Version> {
    let d = dir(root, &format!("{id}.md"));
    stamps(&d)
        .into_iter()
        .map(|t| Version { id: t.to_string(), size: fs::metadata(d.join(format!("{t}.md"))).map(|m| m.len()).unwrap_or(0) })
        .collect()
}

fn version_file(root: &Path, id: &str, version: &str) -> Result<PathBuf, String> {
    if version.is_empty() || !version.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("Invalid version: {version}"));
    }
    Ok(dir(root, &format!("{id}.md")).join(format!("{version}.md")))
}

pub fn read(root: &Path, id: &str, version: &str) -> Result<String, String> {
    fs::read_to_string(version_file(root, id, version)?).map_err(|_| "That version no longer exists".into())
}

/// Moves history along with a renamed doc or folder (root-relative file paths, as in `docs::relocate`).
/// Leftover history at the destination, from a doc deleted outside the app, is replaced.
pub fn relocate(root: &Path, from: &str, to: &str) -> std::io::Result<()> {
    let (src, dst) = (dir(root, from), dir(root, to));
    if !src.exists() {
        return Ok(());
    }
    if dst.exists() {
        fs::remove_dir_all(&dst)?;
    }
    fs::create_dir_all(dst.parent().unwrap())?;
    fs::rename(src, dst)
}

/// Drops the history of a deleted doc or folder (root-relative file path).
pub fn delete(root: &Path, rel: &str) {
    let _ = fs::remove_dir_all(dir(root, rel));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thins_out_old_snapshots() {
        const H: u64 = 3_600_000;
        let now = 1000 * 24 * H;
        let at = |hours_ago: u64| now - hours_ago * H;
        // Two within the last day stay; two in the same hour two days back keep the newer; the rest are a day apart.
        let v = [at(1), at(2), at(48) + 10, at(48) + 5, at(200), at(230), at(24 * 100), at(24 * 110)];
        assert_eq!(prunable(&v, now), [at(48) + 5]);
        let weeks = [at(24 * 7 * 20) + 3, at(24 * 7 * 20) + 2];
        assert_eq!(prunable(&weeks, now), [weeks[1]]);
    }

    #[test]
    fn snapshots_list_move_and_delete() {
        let dir = std::env::temp_dir().join(format!("mdhist-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        let t = now_ms();
        snapshot(&root, "team/a", "one", t - 10 * 60_000, false).unwrap();
        snapshot(&root, "team/a", "two", t - 60_000, false).unwrap();
        snapshot(&root, "team/a", "three", t, false).unwrap(); // under five minutes after the last: skipped
        snapshot(&root, "team/a", "two", t, true).unwrap(); // same text as the newest: skipped even when forced
        let v = list(&root, "team/a");
        assert_eq!(v.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), [(t - 60_000).to_string(), (t - 10 * 60_000).to_string()]);
        assert_eq!(read(&root, "team/a", &v[1].id).unwrap(), "one");
        assert!(read(&root, "team/a", "../../x").is_err());
        relocate(&root, "team", "crew").unwrap();
        assert_eq!(list(&root, "crew/a").len(), 2);
        relocate(&root, "crew/a.md", "b.md").unwrap();
        assert_eq!(list(&root, "b").len(), 2);
        delete(&root, "b.md");
        assert!(list(&root, "b").is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
