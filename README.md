# Pool Manager — client desktop

Application desktop (macOS / Linux) Tauri v2 + SvelteKit (Svelte 5) : tableaux Kanban partagés et vue
chronologie. Se connecte au serveur [pool_manager_server](https://github.com/OkilSaber/pool_manager_server).

- Connexion / inscription, adresse du serveur réglable (**Paramètres du serveur**).
- Kanban : colonnes éditables et réordonnables, cartes en glisser-déposer, ajout rapide.
- Cartes : priorité P0 → P4, chiffrage en jours/homme, date de début, assignés avec répartition en % (total 100 %).
- Chronologie : barres en jours ouvrés, regroupement par état ou par assigné, zoom jour/semaine/mois,
  glisser une barre pour replanifier.

## Prérequis

Rust stable, Node.js ≥ 20, `cargo install tauri-cli --version "^2"`. Linux : dépendances WebKitGTK de Tauri
(`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`),
voir <https://v2.tauri.app/start/prerequisites/>.

## Développement

```bash
npm install
npm run tauri dev
```

Interface seule dans un navigateur : `npm run dev` puis <http://localhost:1420> (le serveur autorise cette
origine par défaut). Dans Tauri, les requêtes passent par `tauri-plugin-http` (pas de CORS).

## Paquets

```bash
npm run tauri build
```

macOS → `src-tauri/target/release/bundle/{macos,dmg}`, Linux → `bundle/{deb,appimage}`.
Chaque paquet se construit sur son OS cible.

## Types partagés

`src/lib/types/` est généré côté serveur (`cargo test -p shared`, sortie dans `bindings/`) : ne pas éditer à la main,
recopier depuis le dépôt serveur quand l'API change.

## Vérifications

```bash
npm run check
```
