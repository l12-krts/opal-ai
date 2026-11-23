//! Opal desktop: a native window around the Opal web app.
//!
//! - The window only ever shows Opal's own origin. Any other link opens in the system browser.
//! - Google blocks sign-in inside embedded webviews, so sign-in happens in the system browser:
//!   the login page links to /desktop/login, which we open externally. After signing in there,
//!   the browser opens `opal://auth?token=...`; we load /desktop/callback?token=... here, which
//!   trades the single-use token for a session cookie in this window.
//! - No JavaScript bridge is exposed to the remote page.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

const USER_AGENT_SUFFIX: &str = "OpalDesktop/0.1";

fn app_url() -> Url {
    // Set OPAL_URL at build time for production builds, e.g. OPAL_URL=https://app.opal.ai
    let raw = option_env!("OPAL_URL").unwrap_or(if cfg!(debug_assertions) {
        "http://localhost:3000"
    } else {
        "https://app.opal.example"
    });
    Url::parse(raw).expect("OPAL_URL must be a valid URL")
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

fn handle_deep_link(app: &AppHandle, raw: &str) {
    let Ok(url) = Url::parse(raw) else { return };
    if url.scheme() != "opal" || url.host_str() != Some("auth") {
        return;
    }
    let Some(token) = url.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()) else {
        return;
    };
    if token.is_empty() || token.len() > 512 || !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let mut target = app_url();
        target.set_path("/desktop/callback");
        target.query_pairs_mut().clear().append_pair("token", &token);
        let _ = window.navigate(target);
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (e.g. from an opal:// link on Windows) focuses this one
        // and forwards the link to the deep-link handler.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let base = app_url();
            let nav_base = base.clone();
            let handle = app.handle().clone();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(base.clone()))
                .title("Opal")
                .inner_size(1240.0, 820.0)
                .min_inner_size(420.0, 560.0)
                .user_agent(&format!(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 {USER_AGENT_SUFFIX}"
                ))
                .on_navigation(move |url| {
                    if url.scheme() == "opal" {
                        return false;
                    }
                    if same_origin(url, &nav_base) {
                        if url.path().starts_with("/desktop/login") {
                            let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                            return false;
                        }
                        return true;
                    }
                    if url.scheme() == "http" || url.scheme() == "https" {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;

            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register_all()?;

            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_deep_link(&dl_handle, url.as_str());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Opal");
}
