#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod comments;
mod docs;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

struct Root {
    dir: PathBuf,
    db: Connection,
}

// ponytail: one global lock around root + db; fine for a single-window local app
type AppState = Mutex<Root>;

fn with_root<T>(s: &State<AppState>, f: impl FnOnce(&Root) -> Result<T, String>) -> Result<T, String> {
    f(&s.lock().unwrap())
}

/// Docs live in the app's own data folder (~/Library/Application Support/<id>/Docs), created on first launch.
/// ponytail: not ~/Documents, which macOS guards behind a permission prompt for unsigned apps.
fn open_root(app: &AppHandle) -> Result<Root, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let db = comments::open(&dir).map_err(|e| e.to_string())?;
    Ok(Root { dir, db })
}

#[tauri::command]
fn root_dir(s: State<AppState>) -> String {
    s.lock().unwrap().dir.to_string_lossy().into_owned()
}

#[tauri::command]
fn create_doc(s: State<AppState>, id: String) -> Result<String, String> {
    with_root(&s, |r| docs::create(&r.dir, &id))
}

#[tauri::command]
fn rename_doc(s: State<AppState>, from: String, to: String) -> Result<String, String> {
    with_root(&s, |r| {
        let id = docs::rename(&r.dir, &from, &to)?;
        comments::move_doc(&r.db, &from, Some(&id))?;
        Ok(id)
    })
}

#[tauri::command]
fn delete_doc(s: State<AppState>, id: String) -> Result<(), String> {
    with_root(&s, |r| {
        docs::delete(&r.dir, &id)?;
        comments::move_doc(&r.db, &id, None)
    })
}

#[tauri::command]
fn reveal_root(s: State<AppState>) -> Result<(), String> {
    let dir = s.lock().unwrap().dir.clone();
    std::process::Command::new("open").arg(dir).spawn().map(drop).map_err(|e| e.to_string())
}

#[tauri::command]
fn tree(s: State<AppState>) -> Result<Vec<docs::Node>, String> {
    with_root(&s, |r| Ok(docs::tree(&r.dir)))
}

#[tauri::command]
fn read_doc(s: State<AppState>, id: String) -> Result<docs::Doc, String> {
    with_root(&s, |r| docs::read(&r.dir, &id))
}

#[tauri::command]
fn save_doc(s: State<AppState>, id: String, content: String, mtime: String, force: bool) -> Result<String, String> {
    with_root(&s, |r| docs::save(&r.dir, &id, &content, &mtime, force))
}

#[tauri::command]
fn render(md: String) -> String {
    docs::render(&md)
}

#[tauri::command]
fn list_comments(s: State<AppState>, doc: String) -> Result<Vec<comments::Comment>, String> {
    with_root(&s, |r| comments::list(&r.db, &doc).map_err(|e| e.to_string()))
}

#[tauri::command]
fn add_comment(s: State<AppState>, doc: String, parent_id: Option<i64>, quote: Option<String>, quote_start: Option<i64>, body: String) -> Result<(), String> {
    with_root(&s, |r| comments::add(&r.db, &doc, parent_id, quote.as_deref(), quote_start, &body))
}

#[tauri::command]
fn edit_comment(s: State<AppState>, id: i64, body: String) -> Result<(), String> {
    with_root(&s, |r| comments::edit(&r.db, id, &body))
}

#[tauri::command]
fn delete_comment(s: State<AppState>, id: i64) -> Result<(), String> {
    with_root(&s, |r| comments::delete(&r.db, id))
}

#[tauri::command]
fn resolve_comment(s: State<AppState>, id: i64, resolved: bool) -> Result<(), String> {
    with_root(&s, |r| comments::set_resolved(&r.db, id, resolved))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Unsupported link".into());
    }
    std::process::Command::new("open").arg(url).spawn().map(drop).map_err(|e| e.to_string())
}

#[tauri::command]
fn print(w: WebviewWindow) -> Result<(), String> {
    w.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0)
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, text: &str, accel: &str| MenuItem::with_id(app, id, text, true, Some(accel));
    let sep = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Markdown Docs",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &sep()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &sep()?,
                    // Custom quit so the UI can ask about unsaved changes first.
                    &item("quit", "Quit Markdown Docs", "CmdOrCtrl+Q")?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &item("new-doc", "New Doc…", "CmdOrCtrl+N")?,
                    &item("reveal", "Show Docs in Finder", "CmdOrCtrl+Shift+R")?,
                    &item("save", "Save", "CmdOrCtrl+S")?,
                    &sep()?,
                    &item("export-pdf", "Export PDF…", "CmdOrCtrl+P")?,
                    &sep()?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&item("toggle-mode", "Toggle Preview / Markdown", "CmdOrCtrl+E")?, &PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?])?,
        ],
    )
}

/// FSEvents watcher: tells the UI when docs change outside the app. Dot-paths (.docs db, save temp files) are ignored.
fn watch(app: &AppHandle, dir: &std::path::Path) -> notify::Result<notify::RecommendedWatcher> {
    use notify::Watcher;
    let (app, root) = (app.clone(), dir.to_path_buf());
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(e) = res else { return };
        let hidden = |p: &PathBuf| {
            p.strip_prefix(&root).unwrap_or(p).components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
        };
        if e.paths.iter().any(|p| !hidden(p)) {
            let _ = app.emit("fs-changed", ());
        }
    })?;
    w.watch(dir, notify::RecursiveMode::Recursive)?;
    Ok(w)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = open_root(app.handle())?;
            app.manage(Mutex::new(watch(app.handle(), &root.dir)?));
            app.manage::<AppState>(Mutex::new(root));
            app.set_menu(menu(app.handle())?)?;
            app.on_menu_event(|app, e| {
                let _ = app.emit("menu", e.id().0.as_str());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            root_dir, create_doc, rename_doc, delete_doc, reveal_root, tree, read_doc, save_doc, render, list_comments, add_comment, edit_comment,
            delete_comment, resolve_comment, open_url, print, quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}
