use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Comment {
    id: i64,
    parent_id: Option<i64>,
    quote: Option<String>,
    quote_start: Option<i64>,
    body: String,
    body_html: String,
    resolved: bool,
    created_at: String,
}

pub fn open(root: &Path) -> rusqlite::Result<Connection> {
    let dir = root.join(".docs");
    std::fs::create_dir_all(&dir).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
    let db = Connection::open(dir.join("comments.db"))?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON;
         create table if not exists comments (
           id          integer primary key,
           doc         text not null,
           parent_id   integer references comments(id) on delete cascade,
           quote       text,
           quote_start integer,
           body        text not null,
           resolved    integer not null default 0,
           created_at  text not null default current_timestamp
         );
         create index if not exists comments_doc_idx on comments(doc);",
    )?;
    Ok(db)
}

fn clean(body: &str) -> Result<&str, String> {
    let b = body.trim();
    if b.is_empty() { Err("Comment can't be empty".into()) } else { Ok(b) }
}

pub fn list(db: &Connection, doc: &str) -> rusqlite::Result<Vec<Comment>> {
    let mut st = db.prepare(
        "select id, parent_id, quote, quote_start, body, resolved, created_at from comments where doc = ? order by id",
    )?;
    let rows = st.query_map([doc], |r| {
        let body: String = r.get(4)?;
        Ok(Comment {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            quote: r.get(2)?,
            quote_start: r.get(3)?,
            body_html: crate::docs::render(&body),
            body,
            resolved: r.get::<_, i64>(5)? != 0,
            created_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn add(db: &Connection, doc: &str, parent_id: Option<i64>, quote: Option<&str>, quote_start: Option<i64>, body: &str) -> Result<(), String> {
    // Replies never carry a quote; only roots anchor to text.
    let (quote, quote_start) = if parent_id.is_some() { (None, None) } else { (quote, quote_start) };
    db.execute(
        "insert into comments (doc, parent_id, quote, quote_start, body) values (?, ?, ?, ?, ?)",
        params![doc, parent_id, quote, quote_start, clean(body)?],
    )
    .map(drop)
    .map_err(|e| e.to_string())
}

/// Threads follow their doc on rename; `to = None` drops them when the doc is deleted.
pub fn move_doc(db: &Connection, from: &str, to: Option<&str>) -> Result<(), String> {
    match to {
        Some(to) => db.execute("update comments set doc = ? where doc = ?", [to, from]),
        None => db.execute("delete from comments where doc = ?", [from]),
    }
    .map(drop)
    .map_err(|e| e.to_string())
}

/// Re-points comments on every doc under folder `from` to the same doc under `to`.
pub fn move_folder(db: &Connection, from: &str, to: &str) -> Result<(), String> {
    let prefix = format!("{from}/");
    let n = prefix.chars().count() as i64; // SQLite's substr counts characters
    db.execute("update comments set doc = ?1 || substr(doc, ?2) where substr(doc, 1, ?3) = ?4", params![to, n, n, prefix])
        .map(drop)
        .map_err(|e| e.to_string())
}

pub fn edit(db: &Connection, id: i64, body: &str) -> Result<(), String> {
    db.execute("update comments set body = ? where id = ?", params![clean(body)?, id]).map(drop).map_err(|e| e.to_string())
}

pub fn delete(db: &Connection, id: i64) -> Result<(), String> {
    db.execute("delete from comments where id = ?", [id]).map(drop).map_err(|e| e.to_string())
}

pub fn set_resolved(db: &Connection, id: i64, resolved: bool) -> Result<(), String> {
    db.execute("update comments set resolved = ? where id = ? and parent_id is null", params![resolved, id])
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_cascade_and_validate() {
        let dir = std::env::temp_dir().join(format!("mdc-{}", std::process::id()));
        let db = open(&dir).unwrap();
        add(&db, "a", None, Some("q"), Some(3), " root ").unwrap();
        let root = list(&db, "a").unwrap()[0].id;
        assert_eq!(list(&db, "a").unwrap()[0].body, "root");
        add(&db, "a", Some(root), Some("ignored"), None, "reply").unwrap();
        assert!(add(&db, "a", None, None, None, "   ").is_err());
        assert!(list(&db, "a").unwrap()[1].quote.is_none());
        move_doc(&db, "a", Some("b")).unwrap();
        assert!(list(&db, "a").unwrap().is_empty());
        move_doc(&db, "b", Some("a")).unwrap();
        add(&db, "team/x", None, None, None, "t").unwrap();
        add(&db, "teammate", None, None, None, "not under team/").unwrap();
        move_folder(&db, "team", "archive/team").unwrap();
        assert!(list(&db, "team/x").unwrap().is_empty() && list(&db, "archive/team/x").unwrap().len() == 1);
        assert_eq!(list(&db, "teammate").unwrap().len(), 1);
        set_resolved(&db, root, true).unwrap();
        assert!(list(&db, "a").unwrap()[0].resolved);
        delete(&db, root).unwrap();
        assert!(list(&db, "a").unwrap().is_empty());
        drop(db); // Windows can't delete the db file while it's open.
        std::fs::remove_dir_all(dir).unwrap();
    }
}
