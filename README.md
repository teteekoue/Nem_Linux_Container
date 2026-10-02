# NemLinux Container (NLC)

## Interface de test locale

`npm run dev` lance une interface minimale sans compte, réseau invité ni Google Drive. Elle démarre Alpine automatiquement lorsqu’aucune sauvegarde n’existe, propose de reprendre ou d’effacer une session existante, et sauvegarde le disque dans IndexedDB toutes les cinq secondes après une écriture invitée. Les sauvegardes inchangées sont ignorées pour éviter de recopier le disque complet inutilement. L’image de développement préinstalle Bash, Git, Nano et Python 3/pip, en plus des commandes BusyBox d’Alpine. Tous les logs noyau sont affichés (`loglevel=7 ignore_loglevel`) et capturés par lots, sans limite de durée de démarrage ni de taille de journal. Le statut « Prêt » apparaît après réception de l’invite shell Alpine; une erreur de téléchargement ou l’arrêt de v86 avant cette invite est signalé immédiatement. En mode développement, la sortie série est automatiquement envoyée au serveur Vite local et consultable à `/__nlc/diagnostics` (ou avec `curl http://localhost:5173/__nlc/diagnostics` depuis l’environnement qui exécute Vite). Elle peut aussi être copiée ou téléchargée depuis la barre d’outils.

Pour repartir directement d’une image propre sans reprendre l’ancienne sauvegarde IndexedDB, ouvrir l’interface avec `?reset-session=1` (par exemple `http://localhost:5173/?reset-session=1`). Le disque sauvegardé est alors supprimé et l’image Alpine fraîche démarre automatiquement; le paramètre est retiré de l’URL ensuite.

Le terminal xterm.js visible est directement relié au port série v86 : les frappes sont envoyées à la VM et sa sortie est affichée et conservée pour le diagnostic. Aucun terminal série supplémentaire v86 ni carte réseau invitée n’est créé.

Le moteur MVP comprend également des modules de relais réseau et de synchronisation Google Drive, mais ils ne sont pas exposés par cette interface de test. Le dépôt contient les outils pour construire une image Alpine x86. Les artefacts volumineux (image, noyau, BIOS et WebAssembly) sont produits ou copiés localement dans `public/assets/` et ne sont pas versionnés.

### Prérequis

- Node.js 20+ et npm
- Docker avec prise en charge de l’architecture `linux/386` (pour l’image Alpine)
- `e2fsprogs` (`mkfs.ext2`) sur la machine de construction
- Pour le déploiement du Worker : un compte Cloudflare et Wrangler

### Installation et lancement

```sh
npm install
npm run build:alpine
npm run dev
```

La compilation statique s’effectue avec `npm run build`, et peut être prévisualisée avec `npm run preview`. Le build copie le WebAssembly depuis le paquet npm v86 et les BIOS depuis le dépôt officiel v86 dans `public/assets/`. La création de l’image racine x86, de son noyau et de son initramfs est séparée et nécessite Docker. Le disque ext2 de 128 Mo est distribué compressé en gzip afin de réduire le téléchargement initial, puis décompressé dans le navigateur avant le démarrage. `IMAGE_SIZE_MB` peut être défini au lancement du script (128 Mo par défaut).

Les options de démarrage sont disponibles dans `.env` (partir de `.env.example`) :

```dotenv
VITE_NETWORK_RELAY_URL=wss://nlc-relay.<votre-domaine>.workers.dev
VITE_GOOGLE_CLIENT_ID=<identifiant-client-Google>
```

Pour utiliser Google Drive, activer l’API Drive et configurer l’identifiant OAuth Web côté Google avec l’origine de l’application. L’application demande uniquement le scope `drive.file`; aucun secret OAuth n’est placé dans le client. Les jetons d’accès sont conservés dans IndexedDB et expirent sans renouvellement automatique.

### Construire et publier le Worker

```sh
cd worker
npm install
npm run deploy
```

`wrangler.toml` utilise la compatibilité Workers requise par `cloudflare:sockets`. La route racine parle le protocole WISP attendu par v86; `/browser-socket` conserve l’endpoint fourni par `@gvibehacker/browser-socket-cloudflare-worker`. Les connexions WISP sont limitées aux ports TCP 80 et 443 et à 50 flux par session WebSocket. Ce relais ne doit pas être considéré comme un proxy public généraliste.

### Persistance du disque

La même `ArrayBuffer` ext2 est fournie au disque IDE de v86 et aux sauvegardes IndexedDB. La version v86 verrouillée dans le lockfile écrit les secteurs IDE dans ce buffer. L’événement v86 `ide-write-end` marque les modifications disque : l’export IndexedDB et l’upload Drive ne recopient donc pas une image inchangée à chaque cycle. L’export de disque copie l’image ext2 modifiée, sans enregistrer la RAM ni utiliser `save_state()` / `restore_state()`. Les tests unitaires couvrent IndexedDB, les flushs du cycle de vie et l’upload Drive par chunks de 8 Mio; `npm run test:boot` démarre la VM, vérifie les outils de développement et une écriture réellement faite dans le système invité. Google Drive ne ré-envoie l’image que si son empreinte SHA-256 a changé.

### Tests

```sh
npm test
npm run test:boot
```

Le test de fumée `tests/interface-smoke.test.ts` vérifie que le serveur Vite sert la page et son point d’entrée. `npm run test:boot` suppose que `npm run build:alpine` et `npm run assets:v86` ont déjà été exécutés. Les tests unitaires vérifient IndexedDB (disque et jeton OAuth), le cycle de vie, l’upload resumable et le décodage des trames WISP.

### Arborescence

- `src/v86/` : configuration et démarrage v86.
- `src/terminal/` : console série xterm.js.
- `src/persistence/` : IndexedDB et API Google Drive resumable.
- `src/network/` : validation de l’URL du relais réseau.
- `src/lifecycle/` : démarrage, reprise et flush local/cloud.
- `worker/` : Worker Cloudflare, passerelle WISP v86, endpoint browser-socket et configuration Wrangler.
- `scripts/alpine/` : Dockerfile pour Alpine x86.
- `scripts/build-alpine.sh` : génération de `alpine-v1.ext2`, `bzImage` et `initramfs-lts`. Le terminal série ouvre un shell root local sans invite d’authentification, pour le bac à sable privé de l’utilisateur.

Le terminal fourni est une interface minimale de validation du moteur, pas l’interface produit finale.

---

## Documentation technique et décisions MVP

## Philosophie du projet

**NemLinux Container (NLC)** est un environnement Linux léger émulé directement dans le navigateur. L’idée fondatrice est simple : offrir un accès instantané à un terminal Linux fonctionnel, sans installation, sans configuration, et sans dépendre d’un serveur de calcul distant.

Chaque instance NLC est une **machine virtuelle x86 32 bits** exécutée localement via l’émulateur **v86** (JavaScript/WebAssembly). L’utilisateur interagit avec un terminal standard (`xterm.js`) et dispose d’une distribution **Alpine Linux** avec BusyBox, Bash, Git, Nano, Python 3 et pip. `apk` est présent, mais l’image de test reste hors ligne : seuls les paquets déjà présents ou fournis localement peuvent être installés.

Le projet repose sur trois principes :

1. **Local-first** : le calcul s’exécute sur la machine de l’utilisateur, jamais sur un serveur distant.
2. **Zéro installation** : tout se passe dans l’onglet du navigateur.
3. **Persistance optionnelle** : l’utilisateur peut choisir de sauvegarder son environnement localement (IndexedDB) ou dans son propre cloud (Google Drive).

L’objectif n’est pas de remplacer un VPS ou une machine de développement complète, mais de fournir un **bac à sable Linux immédiat** pour tester des commandes, apprendre, prototyper, ou exécuter des scripts légers.


## Architecture technique

### Vue d’ensemble

L’architecture de NLC se décompose en quatre couches :

| Couche | Composant | Rôle |
|---|---|---|
| **Émulation** | v86 (WebAssembly) | Émule le CPU x86, la mémoire, les périphériques |
| **Image système** | Alpine Linux 32 bits | Distribution invitée, noyau, système de fichiers |
| **Interface** | xterm.js | Terminal dans le navigateur |
| **Persistance** | IndexedDB + Google Drive | Sauvegarde locale et cloud |

Le flux est le suivant :

1. L’utilisateur charge la page NLC.
2. Le navigateur télécharge l’image Alpine, le noyau (`bzImage`), et les fichiers v86 (`v86.wasm`, `seabios.bin`, `vgabios.bin`).
3. v86 démarre la VM avec une allocation mémoire fixe (128 ou 256 Mo).
4. Le terminal s’affiche, l’utilisateur interagit avec Alpine via `xterm.js`.
5. Les modifications sont périodiquement sauvegardées dans IndexedDB (local) et éventuellement synchronisées vers Google Drive.


### v86 — L’émulateur

**v86** est un émulateur x86 écrit en JavaScript et WebAssembly, optimisé pour tourner dans le navigateur. Il émule :

- Un CPU compatible x86 (niveau Pentium 4, avec support SSE3)
- Une FPU (calculs via Berkeley SoftFloat)
- Un contrôleur VGA avec support SVGA et extensions Bochs VBE
- Un contrôleur IDE pour les disques
- Une carte réseau NE2000 (RTL8390) PCI
- Divers périphériques (clavier PS/2, timer, PIC, RTC, etc.) 

**Limitations connues** :
- Les extensions 64 bits ne sont **pas supportées** . C’est la raison pour laquelle NLC utilise Alpine en 32 bits.
- Certaines fonctionnalités sont manquantes : task gates, far calls en mode protégé, débogage pas à pas, certaines exceptions FPU/SSE .

**Performance** : le démarrage dépend fortement du navigateur et du processeur hôte. Le test de boot réel atteint l’invite Alpine en environ **55 secondes** dans l’environnement de développement local. NLC utilise un seul processeur virtuel (`nosmp`) et n’inclut pas de périphérique ou de service réseau dans cette image de test.


### Alpine Linux 32 bits — L’image invitée

**Alpine Linux** est une distribution ultra-légère, conçue pour la sécurité et la simplicité. C’est le choix idéal pour NLC car :

- **Outils de développement** : Bash, Git, Nano et Python 3/pip sont préinstallés dans l’image NLC.
- **Compatibilité v86** : v86 supporte officiellement Alpine. Une image peut être construite à partir d’un Dockerfile via les outils fournis dans `tools/docker/alpine/` .
- **32 bits** : l’architecture x86 32 bits est supportée nativement par v86.

**Construction de l’image** : le Dockerfile construit un système de fichiers racine `ext2` de **128 Mo** par défaut, avec l’espace nécessaire aux outils préinstallés et aux fichiers de travail.


### xterm.js — L’interface

**xterm.js** est le composant standard de l’industrie pour afficher un terminal dans le navigateur. Il est utilisé par VS Code et de nombreux autres projets. Il se connecte directement au flux de sortie de v86 pour afficher le texte, et transmet les entrées clavier à la VM.


### Allocation mémoire

La mémoire de la VM est **fixée au démarrage** (généralement **128 Mo ou 256 Mo**). Cette contrainte vient de WebAssembly : la mémoire linéaire (`WebAssembly.Memory`) doit avoir une taille maximale déclarée à l’initialisation. v86 ne peut pas allouer dynamiquement plus de mémoire en cours d’exécution.

**Conséquence** : l’utilisateur ne peut pas « prendre tout ce qu’il y a » sur sa machine. Il obtient une allocation prédéfinie, ce qui est suffisant pour des tâches légères mais limite les processus gourmands.


### Réseau — Le relais WebSocket

**v86 ne peut pas accéder à Internet directement.** L’émulation réseau passe par un **relais WebSocket** (`network_relay_url`). L’adaptateur réseau virtuel de v86 convertit le trafic TCP de l’invité en flux WISP; le Worker ouvre les connexions sortantes via l’API Cloudflare `connect()`.

Sans ce relais, la VM Alpine est **isolée** : pas de `apk update` ni d’installation de paquets à la demande. Les outils de développement nécessaires sont préinstallés dans l’image.

**Implémentations existantes** :
- `benjamincburns/websockproxy` — l’implémentation originale 
- `krishenriksen/node-relay` — alternative Node.js 
- `@gvibehacker/browser-socket-cloudflare-worker` — **Cloudflare Worker** qui termine les connexions WebSocket et proxifie via l’API `connect()` de Cloudflare 

**Choix pour NLC** : Cloudflare Workers est privilégié car il évite de maintenir une infrastructure de calcul. La route racine du Worker implémente WISP pour assurer la compatibilité avec v86; la route `/browser-socket` expose aussi `@gvibehacker/browser-socket-cloudflare-worker`, dont le protocole distinct n’est pas directement utilisable comme relais v86.

**Limite connue** : le relais autorise au plus **50 flux TCP par session WebSocket**, sur les ports 80 et 443. Cela vise l’usage léger (installation de paquets, `curl` ponctuel), pas les transferts massifs ni les autres protocoles.


## Persistance des données

### Principe

NLC sépare strictement **le calcul** (local, dans le navigateur) et **le stockage** (local ou cloud). L’utilisateur ne loue pas de puissance de calcul. Il utilise la sienne. La persistance sert uniquement à retrouver son environnement après fermeture de l’onglet.

### Niveau 1 — IndexedDB (local)

**IndexedDB** est une base de données NoSQL intégrée au navigateur. Elle offre :

- **Stockage local** : les données survivent aux rechargements de page.
- **Latence zéro** : accès instantané, pas de réseau.
- **Capacité** : dépend du navigateur et de l’espace local disponible.

**Fonctionnement** : toutes les 5 secondes au maximum après une écriture disque, l’image modifiée de la VM est copiée dans IndexedDB. Les intervalles sans écriture invitée ne déclenchent pas de copie. Un **flush final** est aussi déclenché sur `beforeunload` / `visibilitychange`.

### Niveau 2 — Google Drive (cloud, optionnel)

Si l’utilisateur connecte son compte Google, l’image disque est également synchronisée vers **Google Drive**.

**Pourquoi Google Drive** :
- **15 Go gratuits** : largement suffisant pour stocker plusieurs images NLC (128 Mo chacune par défaut).
- **API accessible côté client** : via **Google Identity Services** .
- **Scope minimal** : `drive.file` — l’application ne voit que les fichiers qu’elle a créés.

**Mécanisme** :
1. L’utilisateur clique sur « Connecter Google Drive ».
2. Google Identity Services ouvre une popup pour obtenir un **access token** .
3. Le token est stocké dans IndexedDB avec sa date d’expiration.
4. Les sauvegardes périodiques utilisent ce token pour uploader l’image via l’API Drive (upload resumable) .
5. Si le token expire (`401 Unauthorized`), l’application demande une **reconnexion** .

**Limitation** : Google Identity Services ne supporte pas le **refresh token** automatique côté client . L’utilisateur devra se reconnecter périodiquement (toutes les quelques heures).


### Ce qui n’est PAS sauvegardé

**L’état mémoire de la VM (snapshot complet) n’est pas sauvegardé au MVP.** Deux raisons :

1. **Incompatibilité réseau** : `restore_state()` de v86 échoue si la configuration réseau au chargement ne correspond pas exactement à celle au moment de la sauvegarde . Comme NLC utilise un relais réseau, la restauration serait fragile.
2. **Complexité** : sauvegarder uniquement le **système de fichiers** (image `.ext2`) est plus simple et suffisant. L’utilisateur redémarre la VM mais retrouve ses fichiers.

**Décision actée** : pas de `save_state()` / `restore_state()` au MVP. Sauvegarde du système de fichiers uniquement.


## Cycle de vie de la VM

### Premier lancement

1. **Écran d’accueil** : « NemLinux Container — votre Linux dans le navigateur ».
2. **Choix** : « Démarrer sans compte » (local only) ou « Connecter Google Drive » (persistance cloud).
3. **Chargement** : téléchargement de l’image Alpine, du noyau, des fichiers v86.
4. **Démarrage** : la VM boote, le terminal s’affiche.

Objectif du MVP : atteindre l’invite Alpine en **moins d’une minute** sur un appareil compatible; le test local mesuré est à environ 55 secondes.

### Session en cours

- Utilisation normale du terminal.
- Sauvegarde automatique dans IndexedDB toutes les 5 secondes.
- Si Google Drive est connecté, synchronisation asynchrone vers Drive.

### Fermeture

- Flush final vers IndexedDB.
- Si Drive connecté, dernière tentative de synchronisation (peut échouer si l’onglet se ferme trop vite).

### Redémarrage

- Détection d’une sauvegarde existante (IndexedDB ou Drive).
- Proposition : **« Reprendre la session »** ou **« Nouvelle session »**.
- Si « Reprendre » : restauration de l’image disque, la VM redémarre avec les fichiers préservés.


## Distribution de l’image

L’image Alpine (128 Mo par défaut) doit être servie depuis un **hébergement statique** :

- **Cloudflare R2** : stockage objet, rapide, gratuit jusqu’à 10 Go.
- **GitHub Pages** : gratuit, mais bande passante limitée.
- **Netlify** : alternative.

**Cache navigateur** : l’image est servie avec des en-têtes de cache agressifs (`Cache-Control: max-age=31536000`). Elle ne change que lorsque l’image est mise à jour. **Versionner** l’image (`alpine-v1.ext2`) pour invalider le cache si nécessaire.


## Réseau — Cloudflare Worker

### Fonctionnement

La route racine du Worker parle le protocole WISP pris en charge par v86. Elle :

1. Accepte la connexion WebSocket du navigateur.
2. Ouvre les flux TCP demandés par v86 via l’API `connect()` de Cloudflare.
3. Limite les destinations aux ports HTTP/HTTPS 80 et 443, avec un maximum de 50 flux par session.

La route `/browser-socket` utilise séparément `@gvibehacker/browser-socket-cloudflare-worker` pour ses clients compatibles. Ce protocole transporte aussi des flux TCP mais n’est pas le protocole WISP attendu par v86.

### Configuration v86

Côté navigateur, l’application prend une URL `wss://` dans `VITE_NETWORK_RELAY_URL` et la convertit au format WISP de v86 (`wisps://`). Pour une configuration directe v86 :
```javascript
network_relay_url: "wisps://nlc-relay.votre-domaine.workers.dev"
```

### Limites

- **50 flux TCP maximum par session WebSocket**, sur les ports 80 et 443.
- **Usage léger** : installation de paquets, `curl` ponctuel.
- **Pas de transfert massif** : pas de streaming vidéo, pas de téléchargements volumineux.


## Décisions actées pour le MVP

| Point | Décision |
|---|---|
| **Distribution** | Alpine Linux 32 bits |
| **Moteur** | v86 + xterm.js |
| **RAM** | 128-256 Mo, fixe |
| **CPU** | Dynamique, pris sur la machine hôte |
| **Persistance locale** | IndexedDB, debounce 5 s |
| **Persistance cloud** | Google Drive (optionnel) |
| **Format sauvegarde** | Image disque complète (`.ext2`) |
| **Snapshot mémoire** | Non — fichiers uniquement |
| **OAuth** | Google Identity Services, client-side |
| **Scope Google** | `drive.file` |
| **Distribution image** | CDN statique + cache |
| **Réseau VM** | Cloudflare Worker + WebSocket |
| **Nom** | NemLinux Container (NLC) |


## Limites connues et risques

1. **32 bits uniquement** : les outils modernes (Node.js récent, Python récent, Docker) peuvent ne pas fonctionner. C’est une contrainte de v86 .
2. **Réseau fragile** : dépend d’un relais WebSocket externe. Si Cloudflare Workers est indisponible, la VM perd Internet.
3. **Pas de snapshot mémoire** : l’utilisateur redémarre la VM après chaque session. Seuls les fichiers sont préservés.
4. **OAuth sans refresh token** : l’utilisateur doit se reconnecter périodiquement à Google Drive.
5. **RAM fixe** : pas d’extension dynamique. Une VM lancée avec 128 Mo ne pourra jamais avoir plus.
6. **Compatibilité navigateur** : v86 nécessite un navigateur moderne avec support WebAssembly et WebSocket.


## Écosystème futur (non-MVP)

- **P2P de calcul** : les utilisateurs pourraient louer leur puissance de calcul à d’autres (idée mise de côté).
- **Snapshot mémoire** : si v86 améliore la restauration d’état, le snapshot complet pourrait être ajouté.
- **Migration 64 bits** : via CheerpX ou compilation Linux→Wasm, mais complexe et non planifié pour le MVP.
- **Backend VPS** : si Cloudflare Workers devient limitant, migration vers un relais Node.js sur VPS.


## Résumé

**NemLinux Container** est un environnement Linux léger, émulé localement dans le navigateur, avec persistance optionnelle locale (IndexedDB) et cloud (Google Drive). Il utilise **v86** pour l’émulation, **Alpine Linux 32 bits** comme système invité, **xterm.js** pour l’interface, et un **Cloudflare Worker** comme relais réseau. Le projet est conçu pour être **sans infrastructure lourde**, **local-first**, et **extensible** vers des fonctionnalités futures (P2P, 64 bits, snapshot).