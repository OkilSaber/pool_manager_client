#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Les appels au serveur passent par Rust : pas de CORS ni de blocage « mixed content » vers un serveur http du LAN.
        .plugin(tauri_plugin_http::init())
        // Temps réel : WebSocket ouverte côté Rust, pour la même raison (un `ws://` du LAN depuis `tauri://`).
        .plugin(tauri_plugin_websocket::init())
        // Ouverture des liens externes (page de la dernière version) dans le navigateur par défaut.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
