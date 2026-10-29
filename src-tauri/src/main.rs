#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod comments;
mod docs;
mod relink;

use rusqlite::Connection;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

struct Root {
    dir: PathBuf,
    db: Connection,
    /// The chosen docs folder when it couldn't be opened at launch and the default was used instead.
    unavailable: Option<PathBuf>,
}

// ponytail: one global lock around root + db; fine for a single-window local app
type AppState = Mutex<Root>;

fn with_root<T>(s: &State<AppState>, f: impl FnOnce(&Root) -> Result<T, String>) -> Result<T, String> {
    f(&s.lock().unwrap())
}

/// By default docs live in the app's own data folder (~/Library/Application Support/<id>/Docs), created on first launch.
/// ponytail: not ~/Documents, which macOS guards behind a permission prompt for unsigned apps.
fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("Docs"))
}

/// The docs folder the user picked in Settings, if any. Kept apart from settings.json, which the frontend rewrites whole.
fn location_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("location.json"))
}

fn chosen_dir(app: &AppHandle) -> Option<PathBuf> {
    let s = std::fs::read_to_string(location_path(app).ok()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    v["docsFolder"].as_str().map(PathBuf::from)
}

fn open_dir(app: &AppHandle, dir: &std::path::Path) -> Result<Root, String> {
    let dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let db = comments::open(&dir).map_err(|e| e.to_string())?;
    // Images are served through the asset protocol, which only reads from allowed folders.
    app.asset_protocol_scope().allow_directory(&dir, true).map_err(|e| e.to_string())?;
    Ok(Root { dir, db, unavailable: None })
}

/// Opens the chosen docs folder, falling back to the default one when it's missing (e.g. an unmounted drive).
fn open_root(app: &AppHandle) -> Result<Root, String> {
    if let Some(dir) = chosen_dir(app) {
        match open_dir(app, &dir) {
            Ok(root) => return Ok(root),
            Err(_) => {
                let mut root = open_default(app)?;
                root.unavailable = Some(dir);
                return Ok(root);
            }
        }
    }
    open_default(app)
}

fn open_default(app: &AppHandle) -> Result<Root, String> {
    let dir = default_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_dir(app, &dir)
}

#[tauri::command]
fn root_dir(s: State<AppState>) -> String {
    s.lock().unwrap().dir.to_string_lossy().into_owned()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    dir: String,
    is_default: bool,
    /// Set when the chosen folder couldn't be opened at launch.
    unavailable: Option<String>,
}

fn location(app: &AppHandle, root: &Root) -> Location {
    let default = default_dir(app).ok().and_then(|d| std::fs::canonicalize(d).ok());
    Location {
        dir: root.dir.to_string_lossy().into_owned(),
        is_default: default.as_deref() == Some(root.dir.as_path()),
        unavailable: root.unavailable.as_ref().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
fn docs_location(app: AppHandle, s: State<AppState>) -> Location {
    location(&app, &s.lock().unwrap())
}

/// Every file under `from` as a path relative to it; temp files from in-progress saves are skipped.
fn files_under(from: &std::path::Path) -> std::io::Result<Vec<PathBuf>> {
    let mut out = vec![];
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for e in std::fs::read_dir(from.join(&rel))? {
            let e = e?;
            let (ft, rel) = (e.file_type()?, rel.join(e.file_name()));
            if ft.is_dir() {
                stack.push(rel);
            } else if ft.is_file() && !e.file_name().to_string_lossy().ends_with(".tmp") {
                out.push(rel);
            }
        }
    }
    Ok(out)
}

/// Copies docs and comments into `to` without overwriting anything; nothing is copied if any file already exists there.
fn copy_docs(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    let files = files_under(from).map_err(|e| e.to_string())?;
    if let Some(clash) = files.iter().find(|f| to.join(f).exists()) {
        return Err(format!("“{}” already exists in the new folder, so nothing was copied", clash.display()));
    }
    for f in files {
        let dst = to.join(&f);
        std::fs::create_dir_all(dst.parent().unwrap()).and_then(|_| std::fs::copy(from.join(&f), &dst)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Switches to another docs folder (`None` = the default one), optionally copying the current docs into it first.
/// The old folder is left as it was.
#[tauri::command]
fn set_docs_folder(app: AppHandle, s: State<AppState>, path: Option<String>, copy: bool) -> Result<Location, String> {
    let target = match &path {
        Some(p) => PathBuf::from(p),
        None => {
            let d = default_dir(&app)?;
            std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            d
        }
    };
    let target = std::fs::canonicalize(&target).map_err(|_| format!("Folder not found: {}", target.display()))?;
    if !target.is_dir() {
        return Err(format!("Not a folder: {}", target.display()));
    }
    let mut state = s.lock().unwrap();
    if target == state.dir {
        return Ok(location(&app, &state));
    }
    if copy {
        if target.starts_with(&state.dir) || state.dir.starts_with(&target) {
            return Err("Pick a folder that isn't inside the current docs folder (or the other way round)".into());
        }
        copy_docs(&state.dir, &target)?;
    }
    let root = open_dir(&app, &target)?;
    *app.state::<Mutex<notify::RecommendedWatcher>>().lock().unwrap() = watch(&app, &root.dir).map_err(|e| e.to_string())?;
    let p = location_path(&app)?;
    match path {
        Some(_) => std::fs::write(&p, serde_json::json!({ "docsFolder": root.dir }).to_string()).map_err(|e| e.to_string())?,
        None => drop(std::fs::remove_file(&p)),
    }
    *state = root;
    let loc = location(&app, &state);
    drop(state);
    let _ = app.emit("fs-changed", ());
    Ok(loc)
}

#[tauri::command]
fn create_doc(s: State<AppState>, id: String) -> Result<String, String> {
    with_root(&s, |r| docs::create(&r.dir, &id))
}

/// Moves comments after a relocation to `id`. They follow even when only the link rewrite failed
/// ("Moved, but…"): the files have moved by then. `res` is passed through.
fn follow_comments(r: &Root, from: &str, folder: bool, id: &str, res: Result<String, String>) -> Result<String, String> {
    let id = match &res {
        Ok(new) => new.as_str(),
        Err(e) if e.starts_with("Moved,") => id,
        Err(_) => return res,
    };
    if id == from {
        return res;
    }
    if folder { comments::move_folder(&r.db, from, id)? } else { comments::move_doc(&r.db, from, Some(id))? }
    res
}

/// Renames (or moves) a doc to the id `to`, fixing links; its comments follow.
#[tauri::command]
fn rename_doc(s: State<AppState>, from: String, to: String) -> Result<String, String> {
    let id = to.trim().trim_matches('/').trim_end_matches(".md").to_string();
    with_root(&s, |r| follow_comments(r, &from, false, &id, docs::relocate(&r.dir, &from, false, &to)))
}

/// Renames (or moves) a folder to the id `to`, fixing links; comments on its docs follow.
#[tauri::command]
fn rename_folder(s: State<AppState>, from: String, to: String) -> Result<String, String> {
    let id = to.trim().trim_matches('/').to_string();
    with_root(&s, |r| follow_comments(r, &from, true, &id, docs::relocate(&r.dir, &from, true, &to)))
}

/// Moves a folder to the Trash; comments on its docs are deleted.
#[tauri::command]
fn delete_folder(s: State<AppState>, id: String) -> Result<(), String> {
    with_root(&s, |r| {
        docs::delete_folder(&r.dir, &id)?;
        comments::delete_folder(&r.db, &id)
    })
}

/// Moves a doc or folder into folder `to` ("" = top level); comments follow. Returns the new id.
#[tauri::command]
fn move_item(s: State<AppState>, from: String, folder: bool, to: String) -> Result<String, String> {
    let name = from.rsplit('/').next().unwrap_or_default();
    let id = if to.is_empty() { name.to_string() } else { format!("{to}/{name}") };
    with_root(&s, |r| follow_comments(r, &from, folder, &id, docs::move_item(&r.dir, &from, folder, &to)))
}

#[tauri::command]
fn delete_doc(s: State<AppState>, id: String) -> Result<(), String> {
    with_root(&s, |r| {
        docs::delete(&r.dir, &id)?;
        comments::move_doc(&r.db, &id, None)
    })
}

/// Opens a path or URL with the system's default handler.
fn open_external(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd).arg(target).spawn().map(drop).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_root(s: State<AppState>) -> Result<(), String> {
    let dir = s.lock().unwrap().dir.clone();
    open_external(dir)
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

/// Raw-body command so image bytes skip JSON. The doc id and file name come URI-encoded in headers.
#[tauri::command]
fn save_image(s: State<AppState>, request: tauri::ipc::Request) -> Result<String, String> {
    // The postMessage fallback (used if the IPC custom protocol fails) delivers the bytes as a JSON array.
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => std::borrow::Cow::Borrowed(b.as_slice()),
        tauri::ipc::InvokeBody::Json(v) => std::borrow::Cow::Owned(Vec::<u8>::deserialize(v).map_err(|_| "Expected image data")?),
    };
    let header = |k: &str| -> Result<String, String> {
        let v = request.headers().get(k).and_then(|v| v.to_str().ok()).ok_or(format!("Missing {k}"))?;
        Ok(percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
    };
    let (doc, name) = (header("doc")?, header("name")?);
    with_root(&s, |r| docs::save_image(&r.dir, &doc, &name, &bytes))
}

/// Copies dropped files in beside the doc (native drag-drop hands over paths). One result per path, in order.
#[tauri::command]
fn import_images(s: State<AppState>, doc: String, paths: Vec<String>) -> Vec<Result<String, String>> {
    let r = s.lock().unwrap();
    paths
        .iter()
        .map(|p| {
            let p = std::path::Path::new(p);
            let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
            docs::save_image(&r.dir, &doc, &p.file_name().unwrap_or_default().to_string_lossy(), &bytes)
        })
        .collect()
}

/// Saves the image on the system clipboard as `name` (a .png). Ok(None) when there isn't one.
/// For WebKitGTK, whose paste event comes back empty when the clipboard holds an image.
#[tauri::command]
fn paste_image(s: State<AppState>, doc: String, name: String) -> Result<Option<String>, String> {
    let Some(png) = clipboard_png()? else { return Ok(None) };
    with_root(&s, |r| docs::save_image(&r.dir, &doc, &name, &png).map(Some))
}

/// Sync commands run on the main thread, which GTK requires.
#[cfg(target_os = "linux")]
fn clipboard_png() -> Result<Option<Vec<u8>>, String> {
    let Some(img) = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).wait_for_image() else { return Ok(None) };
    img.save_to_bufferv("png", &[]).map(Some).map_err(|e| e.to_string())
}

/// WKWebView puts clipboard images in the paste event itself.
#[cfg(not(target_os = "linux"))]
fn clipboard_png() -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}

#[tauri::command]
fn search(s: State<AppState>, query: String) -> Result<Vec<docs::Hit>, String> {
    with_root(&s, |r| Ok(docs::search(&r.dir, &query)))
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

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("settings.json"))
}

/// App preferences as free-form JSON; the frontend owns the shape and defaults.
#[tauri::command]
fn get_settings(app: AppHandle) -> serde_json::Value {
    settings_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let p = settings_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &p)).map_err(|e| e.to_string())
}

/// Installed font families, from CoreText. Dot-prefixed families are macOS-internal and not usable by name.
#[cfg(target_os = "macos")]
fn font_families() -> Vec<String> {
    use objc2_core_foundation::CFString;
    let all = unsafe { objc2_core_text::CTFontManagerCopyAvailableFontFamilyNames() };
    let all = unsafe { all.cast_unchecked::<CFString>() };
    all.iter().map(|s| s.to_string()).collect()
}

/// Installed font families, from fontconfig. A font can list several comma-separated family names.
#[cfg(not(target_os = "macos"))]
fn font_families() -> Vec<String> {
    let out = std::process::Command::new("fc-list").args([":", "family"]).output().map(|o| o.stdout).unwrap_or_default();
    String::from_utf8_lossy(&out).lines().flat_map(|l| l.split(',')).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    let mut v: Vec<String> = font_families().into_iter().filter(|s| !s.starts_with('.')).collect();
    v.sort_by(|a, b| docs::natural_cmp(a, b));
    v.dedup();
    v
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Unsupported link".into());
    }
    open_external(url)
}

#[tauri::command]
fn print(w: WebviewWindow) -> Result<(), String> {
    w.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0)
}

/// GTK's predefined Cut/Copy/Paste/Select All fake keystrokes with xdo, which does nothing on Wayland, so on Linux
/// they're plain items that run WebKit's editing commands instead. No accelerators: WebKit already handles the keys.
#[cfg(target_os = "linux")]
fn run_edit_command(app: &AppHandle, id: &str) -> bool {
    let cmd = match id {
        "cut" => "Cut",
        "copy" => "Copy",
        "paste" => "Paste",
        "select-all" => "SelectAll",
        _ => return false,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(move |pw| {
            use webkit2gtk::WebViewExt;
            pw.inner().execute_editing_command(cmd)
        });
    }
    true
}

const WEBSITE: &str = "https://thakurcoderz.github.io/markdown-docs/";

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, text: &str, accel: &str| MenuItem::with_id(app, id, text, true, Some(accel));
    let sep = || PredefinedMenuItem::separator(app);
    #[cfg(target_os = "linux")]
    let (cut, copy, paste, select_all) = {
        let plain = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
        (plain("cut", "Cut")?, plain("copy", "Copy")?, plain("paste", "Paste")?, plain("select-all", "Select All")?)
    };
    #[cfg(not(target_os = "linux"))]
    let (cut, copy, paste, select_all) =
        (PredefinedMenuItem::cut(app, None)?, PredefinedMenuItem::copy(app, None)?, PredefinedMenuItem::paste(app, None)?, PredefinedMenuItem::select_all(app, None)?);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Markdown Docs",
                true,
                &[
                    // Without metadata, the About item does nothing on Linux (muda only shows a dialog when given some).
                    &PredefinedMenuItem::about(
                        app,
                        None,
                        Some(
                            AboutMetadataBuilder::new()
                                .name(Some(app.package_info().name.clone()))
                                .version(Some(app.package_info().version.to_string()))
                                .comments(Some("Read and edit Markdown docs, with comments anchored to the text."))
                                .website(Some(WEBSITE))
                                .website_label(Some("Website"))
                                .build(),
                        ),
                    )?,
                    &MenuItem::with_id(app, "website", "Visit Website", true, None::<&str>)?,
                    &MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?,
                    &sep()?,
                    &item("settings", "Settings…", "CmdOrCtrl+,")?,
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
                    &item("search", "Search Docs…", "CmdOrCtrl+K")?,
                    &item("reveal", if cfg!(target_os = "macos") { "Show Docs in Finder" } else { "Show Docs in Files" }, "CmdOrCtrl+Shift+R")?,
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
                    &cut,
                    &copy,
                    &paste,
                    &select_all,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &item("toggle-mode", "Toggle Preview / Markdown", "CmdOrCtrl+E")?,
                    &sep()?,
                    &item("toggle-sidebar", "Toggle Sidebar", "CmdOrCtrl+Backslash")?,
                    &item("toggle-panel", "Toggle Panel", "CmdOrCtrl+Shift+Backslash")?,
                    &item("focus-mode", "Focus Mode", "CmdOrCtrl+Shift+F")?,
                    &sep()?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let root = open_root(app.handle())?;
            app.manage(Mutex::new(watch(app.handle(), &root.dir)?));
            app.manage::<AppState>(Mutex::new(root));
            app.set_menu(menu(app.handle())?)?;
            app.on_menu_event(|app, e| {
                #[cfg(target_os = "linux")]
                if run_edit_command(app, e.id().0.as_str()) {
                    return;
                }
                if e.id().0 == "website" {
                    let _ = open_external(WEBSITE);
                    return;
                }
                let _ = app.emit("menu", e.id().0.as_str());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            root_dir, create_doc, rename_doc, delete_doc, reveal_root, tree, read_doc, save_doc, search, render, list_comments, add_comment, edit_comment,
            delete_comment, resolve_comment, get_settings, set_settings, list_fonts, open_url, print, quit, docs_location,
            set_docs_folder, save_image, import_images, paste_image, move_item, rename_folder, delete_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}

#[cfg(test)]
mod tests {
    #[test]
    fn copies_docs_without_overwriting() {
        let base = std::env::temp_dir().join(format!("mdcopy-{}", std::process::id()));
        let (from, to) = (base.join("from"), base.join("to"));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(from.join("team")).unwrap();
        std::fs::create_dir_all(from.join(".docs")).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("a.md"), "a").unwrap();
        std::fs::write(from.join("team/b.md"), "b").unwrap();
        std::fs::write(from.join(".docs/comments.db"), "db").unwrap();
        std::fs::write(from.join(".a.md.1.tmp"), "half-saved").unwrap();
        super::copy_docs(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(to.join("team/b.md")).unwrap(), "b");
        assert!(to.join(".docs/comments.db").exists() && !to.join(".a.md.1.tmp").exists());
        std::fs::write(to.join("a.md"), "changed").unwrap();
        std::fs::remove_file(to.join("team/b.md")).unwrap();
        assert!(super::copy_docs(&from, &to).is_err(), "clash");
        assert_eq!(std::fs::read_to_string(to.join("a.md")).unwrap(), "changed");
        assert!(!to.join("team/b.md").exists(), "nothing copied on a clash");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn lists_installed_fonts() {
        let fonts = super::list_fonts();
        assert!(fonts.iter().any(|f| f == "Helvetica"), "{} fonts", fonts.len());
        assert!(fonts.iter().all(|f| !f.starts_with('.')));
    }
}
