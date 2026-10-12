<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="104" alt="" />

# Pool Manager

**Tableaux Kanban et chronologie pour planifier le travail d'une petite équipe.**
Application desktop macOS & Linux — Tauri v2 · SvelteKit · Svelte 5.

[Fonctionnalités](#fonctionnalités) · [Installation](#installation) · [Développement](#développement) · [Serveur](https://github.com/OkilSaber/pool_manager_server)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/kanban-dark.png" />
  <img alt="Vue Kanban d'un tableau" src="docs/screenshots/kanban-light.png" />
</picture>

## Fonctionnalités

### Kanban

Colonnes (états) propres à chaque tableau : ajout, renommage, couleur, réordonnancement. Les cartes se
déplacent en glisser-déposer, s'ajoutent en un geste depuis le bas de la colonne, et affichent d'un coup
d'œil priorité, chiffrage, dates prévues et assignés. Chaque colonne totalise sa charge en jours/homme.

### Cartes

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/card-dark.png" />
  <img alt="Détails d'une carte" src="docs/screenshots/card-light.png" />
</picture>

- **Priorité** P0 (critique) → P4 (minime), avec un code couleur constant dans toute l'app.
- **Chiffrage** en jours/homme et **date de début**.
- **Plusieurs assignés** avec une **répartition de la charge en %** (total = 100 %, bouton « Répartir équitablement »).
- **Fin prévue calculée** en jours ouvrés : chacun avance en parallèle, la durée est celle de la plus grosse part.
  10 j/h répartis 50/50 → 5 jours ; 70/30 → 7 jours. Les week-ends sont sautés.
- Enregistrement automatique de chaque champ, sans bouton « Valider ».

### Chronologie

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/timeline-dark.png" />
  <img alt="Chronologie regroupée par état" src="docs/screenshots/timeline-light.png" />
</picture>

Une vue façon Google Sheets › Insertion › Chronologie :

- zoom **Jour / Semaine / Mois**, week-ends grisés, repère « Aujourd'hui » ;
- regroupement **par état**, **par assigné** (avec la charge de chacun) ou sans regroupement ;
- **glisser une barre** pour replanifier (aimantée au jour, aperçu des nouvelles dates, Échap pour annuler),
  ou ←/→ au clavier ;
- les cartes sans date ou sans chiffrage sont listées à part, planifiables en un clic.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/timeline-assignees-dark.png" />
  <img alt="Chronologie regroupée par assigné, zoom jour" src="docs/screenshots/timeline-assignees-light.png" />
</picture>

### Équipe

Comptes par email, tableaux partagés : le propriétaire invite des membres par email et peut les retirer ;
un membre peut quitter un tableau (ses parts sont redistribuées pour rester à 100 %).

<table>
  <tr>
    <td><img alt="Connexion" src="docs/screenshots/login-light.png" /></td>
    <td><img alt="Liste des tableaux" src="docs/screenshots/boards-dark.png" /></td>
  </tr>
</table>

### Finitions

- Thème clair et sombre automatiques (suivent le système).
- Animations courtes et nettes : courbes ease-out, aucune animation sur les actions clavier, respect de
  « Réduire les animations ».
- Navigable au clavier, libellés accessibles, interface entièrement en français.

## Installation

Téléchargez le paquet de votre système dans les [Releases](https://github.com/OkilSaber/pool_manager_client/releases) :
`.dmg` macOS (Apple Silicon `aarch64` ou Intel `x64`), `.deb` ou `.AppImage` Linux.
L'app macOS est signée ad hoc mais pas notariée par Apple : au premier lancement, ouvrez
**Réglages Système → Confidentialité et sécurité → Ouvrir quand même**, ou dans un terminal :
`xattr -dr com.apple.quarantine "/Applications/Pool Manager.app"`.

Le client a besoin d'un [serveur Pool Manager](https://github.com/OkilSaber/pool_manager_server) joignable
(sur votre machine ou le réseau local). Au premier lancement, renseignez son adresse dans
**Paramètres du serveur** (par défaut `http://localhost:8080`), puis créez un compte.

### Prérequis de compilation

- Rust stable, Node.js ≥ 20, `cargo install tauri-cli --version "^2"`
- Linux : dépendances WebKitGTK de Tauri, voir <https://v2.tauri.app/start/prerequisites/>
  (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`)

### Construire les paquets

```bash
npm install
npm run tauri build
```

| OS    | Sortie (`src-tauri/target/release/bundle/`) |
| ----- | ------------------------------------------- |
| macOS | `macos/Pool Manager.app`, `dmg/*.dmg`       |
| Linux | `deb/*.deb`, `appimage/*.AppImage`          |

Chaque paquet se construit sur son OS cible.

## Développement

```bash
npm install
npm run tauri dev     # fenêtre native
npm run dev           # interface seule sur http://localhost:1420
npm run check         # Svelte + TypeScript
```

En navigateur, le serveur doit autoriser l'origine `http://localhost:1420` (c'est le cas par défaut).
Dans Tauri, les requêtes passent par `tauri-plugin-http` : pas de CORS ni de blocage « mixed content »
vers un serveur HTTP du réseau local.

### Structure

```
src/
├── app.css                 design tokens (couleurs, courbes, durées) et classes de base
├── lib/
│   ├── api.ts              client HTTP typé
│   ├── dates.ts            calculs en jours ouvrés (miroir du serveur)
│   ├── stores/             session, tableau ouvert (mises à jour optimistes), toasts
│   ├── types/              types générés depuis le serveur — ne pas éditer
│   └── components/
│       ├── shell/          en-tête, menus, écrans d'authentification
│       ├── board/          Kanban, carte, assignés, membres
│       └── timeline/       chronologie (calculs de mise en page dans timeline.ts)
└── routes/                 login, signup, settings, boards, boards/[id]
src-tauri/                  coquille Rust Tauri v2
```

### Types partagés

`src/lib/types/` est généré par le serveur (`cargo test -p shared`, sortie dans `bindings/`).
Quand l'API change, recopiez-les depuis le dépôt serveur.

## Licence

Voir [LICENSE](LICENSE).
