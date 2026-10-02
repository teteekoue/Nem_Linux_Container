# NemLinux Container (NLC) — 文档 technique complète

## Philosophie du projet

**NemLinux Container (NLC)** est un environnement Linux léger émulé directement dans le navigateur. L’idée fondatrice est simple : offrir un accès instantané à un terminal Linux fonctionnel, sans installation, sans configuration, et sans dépendre d’un serveur de calcul distant.

Chaque instance NLC est une **machine virtuelle x86 32 bits** exécutée localement via l’émulateur **v86** (JavaScript/WebAssembly). L’utilisateur interagit avec un terminal standard (`xterm.js`) et dispose d’une distribution **Alpine Linux** minimale, capable d’exécuter des commandes, d’installer des paquets via `apk`, et de manipuler des fichiers.

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

**Performance** : les temps de démarrage typiques se situent entre **10 et 30 secondes** selon l’appareil et la connexion . Une Alpine minimale peut descendre en dessous de 5 secondes avec un cache navigateur chaud.


### Alpine Linux 32 bits — L’image invitée

**Alpine Linux** est une distribution ultra-légère, conçue pour la sécurité et la simplicité. C’est le choix idéal pour NLC car :

- **Taille minimale** : une image Alpine avec `apk` fonctionnel pèse entre **5 et 15 Mo**.
- **Compatibilité v86** : v86 supporte officiellement Alpine. Une image peut être construite à partir d’un Dockerfile via les outils fournis dans `tools/docker/alpine/` .
- **32 bits** : l’architecture x86 32 bits est supportée nativement par v86.

**Construction de l’image** : l’approche recommandée est d’utiliser un **Dockerfile** définissant un environnement Alpine minimal, puis de générer l’image via des scripts éprouvés (comme `env86` ou les outils v86). L’image résultante contient généralement un système de fichiers racine `ext2` d’environ **50-60 Mo**.


### xterm.js — L’interface

**xterm.js** est le composant standard de l’industrie pour afficher un terminal dans le navigateur. Il est utilisé par VS Code et de nombreux autres projets. Il se connecte directement au flux de sortie de v86 pour afficher le texte, et transmet les entrées clavier à la VM.


### Allocation mémoire

La mémoire de la VM est **fixée au démarrage** (généralement **128 Mo ou 256 Mo**). Cette contrainte vient de WebAssembly : la mémoire linéaire (`WebAssembly.Memory`) doit avoir une taille maximale déclarée à l’initialisation. v86 ne peut pas allouer dynamiquement plus de mémoire en cours d’exécution.

**Conséquence** : l’utilisateur ne peut pas « prendre tout ce qu’il y a » sur sa machine. Il obtient une allocation prédéfinie, ce qui est suffisant pour des tâches légères mais limite les processus gourmands.


### Réseau — Le relais WebSocket

**v86 ne peut pas accéder à Internet directement.** L’émulation réseau passe par un **relais WebSocket** (`network_relay_url`). Le relais traduit les paquets Ethernet de la VM en requêtes compréhensibles par le navigateur, puis fait l’inverse pour les réponses .

Sans ce relais, la VM Alpine est **isolée** : pas de `apk update`, pas d’installation de paquets, pas de `curl`.

**Implémentations existantes** :
- `benjamincburns/websockproxy` — l’implémentation originale 
- `krishenriksen/node-relay` — alternative Node.js 
- `@gvibehacker/browser-socket-cloudflare-worker` — **Cloudflare Worker** qui termine les connexions WebSocket et proxifie via l’API `connect()` de Cloudflare 

**Choix pour NLC** : Cloudflare Workers est privilégié car **gratuit** et sans infrastructure à maintenir. Le Worker utilise `@gvibehacker/browser-socket-cloudflare-worker` pour router le trafic TCP depuis la VM vers Internet .

**Limite connue** : le plan gratuit Cloudflare Workers impose **50 sous-requêtes externes par invocation**. Une invocation = une session WebSocket. Pour un usage léger (installation de paquets, `curl` ponctuel), c’est suffisant. Pour du transfert massif, une migration vers un VPS sera nécessaire.


## Persistance des données

### Principe

NLC sépare strictement **le calcul** (local, dans le navigateur) et **le stockage** (local ou cloud). L’utilisateur ne loue pas de puissance de calcul. Il utilise la sienne. La persistance sert uniquement à retrouver son environnement après fermeture de l’onglet.

### Niveau 1 — IndexedDB (local)

**IndexedDB** est une base de données NoSQL intégrée au navigateur. Elle offre :

- **Stockage local** : les données survivent aux rechargements de page.
- **Latence zéro** : accès instantané, pas de réseau.
- **Capacité** : dépend du navigateur, mais généralement suffisante pour des dizaines de mégaoctets.

**Fonctionnement** : toutes les 5 secondes (après la dernière modification), l’image disque de la VM est sérialisée et écrite dans IndexedDB. Un **flush final** est déclenché sur `beforeunload` / `visibilitychange` pour capturer les dernières modifications avant fermeture.

### Niveau 2 — Google Drive (cloud, optionnel)

Si l’utilisateur connecte son compte Google, l’image disque est également synchronisée vers **Google Drive**.

**Pourquoi Google Drive** :
- **15 Go gratuits** : largement suffisant pour stocker plusieurs images Alpine (50-60 Mo chacune).
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

Objectif : **< 5 secondes** pour le démarrage après le premier chargement (cache navigateur).

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

L’image Alpine (50-60 Mo) doit être servie depuis un **hébergement statique** :

- **Cloudflare R2** : stockage objet, rapide, gratuit jusqu’à 10 Go.
- **GitHub Pages** : gratuit, mais bande passante limitée.
- **Netlify** : alternative.

**Cache navigateur** : l’image est servie avec des en-têtes de cache agressifs (`Cache-Control: max-age=31536000`). Elle ne change que lorsque l’image est mise à jour. **Versionner** l’image (`alpine-v1.ext2`) pour invalider le cache si nécessaire.


## Réseau — Cloudflare Worker

### Fonctionnement

Le Worker Cloudflare utilise `@gvibehacker/browser-socket-cloudflare-worker` pour :

1. Accepter les connexions WebSocket entrantes depuis le navigateur (v86).
2. Multiplexer chaque flux TCP.
3. Proxifier via l’API `connect()` de Cloudflare .

**Code simplifié** :
```javascript
import { Connection } from "@gvibehacker/browser-socket-cloudflare-worker";

export default {
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("NLC relay", { status: 200 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const connection = new Connection(server);
    connection.addEventListener("connect", async (event) => {
      const [socket, { host, port }] = event.detail;
      const tcp = connect({ hostname: host, port: port });
      socket.readable.pipeTo(tcp.writable);
      tcp.readable.pipeTo(socket.writable);
    });
    return new Response(null, { status: 101, webSocket: client });
  },
};
```

### Configuration v86

Côté navigateur, v86 est configuré avec :
```javascript
network_relay_url: "wss://nlc-relay.votre-domaine.workers.dev"
```

### Limites

- **50 sous-requêtes par invocation** (plan gratuit).
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