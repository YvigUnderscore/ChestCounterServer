[English](SERVER.md) · **Français** · [Español](SERVIDOR.md)

# Serveur de groupe (version Docker, pour les plus techniques)

Un petit serveur à héberger soi-même (NAS, VPS, Raspberry Pi…) qui rassemble les coffres d'un groupe d'amis :

- **chaque ami** lance `ChestCounter.exe`, qui envoie au serveur, après chaque partie, **ses propres coffres** ;
- le serveur **additionne les coffres de chaque équipe, partie par partie**, et renvoie le total d'équipe à l'overlay de chacun ;
- un **site** (juste un lien à partager) montre les stats globales, celles de chaque joueur et le détail de chaque partie, les chances et la collection ;
- chaque joueur a une **page overlay pour OBS** (source Navigateur, fond transparent).

## Comment les parties sont synchronisées

Chaque client ne lit dans son replay **que ce qui concerne son joueur** : ses coffres (ouverts ou détruits) et le moment où il les a ouverts, l'identifiant de la partie (`GameSessionId`, identique dans le replay de tous les joueurs de la même partie), son numéro d'équipe et les identifiants Epic de ses coéquipiers.

Le serveur range ensuite chaque envoi par partie, puis par équipe : deux envois vont ensemble s'ils ont le même numéro d'équipe, ou si l'un cite l'autre parmi ses coéquipiers. Le total d'équipe est la **somme des coffres de chacun**, donc :

- **un coffre n'est jamais compté deux fois** (seul celui qui l'a ouvert l'envoie), même si une partie est renvoyée ou réanalysée ;
- un coéquipier qui n'a pas le compteur n'est **pas deviné** : la partie est marquée `2/4 joueurs` et le total affiché avec un `+` (c'est un minimum) ;
- si les envois d'une même équipe ne racontent pas la même histoire (numéro d'équipe, coéquipiers, classement, mode ou heure différents), la partie est marquée **« à vérifier »**, avec la raison ;
- les bots sont ignorés, et des amis dans des équipes différentes d'une même partie restent séparés.

L'ancienne mécanique de l'outil, qui comptait les coffres des coéquipiers vus à moins de 150 m dans ton replay, est retirée. Le relevé des trésors obtenus par les autres joueurs de la partie l'est aussi. **Rien n'est conservé sur les joueurs hors du groupe** : un coéquipier aléatoire apparaît comme « Coéquipier hors groupe », sans pseudo.

## Installation

Prérequis : Docker avec Docker Compose (Synology : *Container Manager* ; QNAP : *Container Station* ; TrueNAS, Portainer ou n'importe quel Linux).

```bash
git clone <ce dépôt> chestcounter && cd chestcounter
cp .env.example .env        # facultatif : tout a une valeur par défaut
docker compose up -d
docker compose exec chests python -m app.admin show
```

La dernière commande affiche la **clé du groupe**, générée au premier démarrage, et le lien à partager. Le site répond sur `http://<ip-du-serveur>:8080`. Tout ce qui compte est dans `./data` : la base SQLite (`chests.db`) et les clés (`keys.json`). C'est le seul dossier à sauvegarder.

### Avec Portainer (NAS)

- **Stack depuis le dépôt** : *Stacks → Add stack → Repository*, l'adresse de ce dépôt et `docker-compose.yml`. Portainer construit l'image lui-même.
- **Ou avec une image importée** : sur un PC, `docker compose build` puis `docker save chestcounter-server:latest -o chestcounter-server.tar`, et dans Portainer *Images → Import*. La stack n'a alors besoin que de ceci (adapter le port et l'adresse) :

```yaml
services:
  chests:
    image: chestcounter-server:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      PUBLIC_URL: "http://mon-nas.local:8080"
      TZ: "Europe/Paris"
    volumes: ["chestcounter-data:/data"]
volumes:
  chestcounter-data:
```

La clé du groupe générée au premier démarrage apparaît dans les **logs** du conteneur. Les commandes `app.admin` ci-dessous se lancent dans *Containers → chestcounter → Exec Console*, sans le préfixe `docker compose exec chests` (par exemple `python -m app.admin rotate group`).

### Les clés

| Clé | Rôle |
|---|---|
| **groupe** | Pour **envoyer** des parties : chaque ami la met dans ChestCounter. À ne donner qu'aux amis du groupe. |
| **lecture** | Facultative. Pour **lire** le site : on partage alors le lien `https://hote/?k=<clé>`, que le navigateur retient. Sans clé de lecture, quiconque a l'adresse peut lire. |

Les clés se gèrent depuis le conteneur. Un changement s'applique tout de suite, sans redémarrage :

```bash
docker compose exec chests python -m app.admin show            # afficher les clés et le lien à partager
docker compose exec chests python -m app.admin rotate group    # nouvelle clé d'envoi (à redonner aux amis)
docker compose exec chests python -m app.admin rotate view     # nouvelle clé de lecture (nouveau lien)
docker compose exec chests python -m app.admin clear view      # site lisible par qui a l'adresse
docker compose exec chests python -m app.admin set group <clé> # choisir la clé soi-même (12 caractères min.)
```

`GROUP_KEY` et `VIEW_KEY` (dans `.env`) ne servent qu'au **premier** démarrage. Ensuite, c'est `data/keys.json` qui compte.

### Réglages (`.env`)

| Variable | Rôle |
|---|---|
| `GROUP_NAME` | Nom affiché en haut du site. |
| `DEFAULT_LANG` | Langue du site pour un visiteur qui n'en a pas choisi : `fr` (par défaut), `en` ou `es`. |
| `PUBLIC_URL` | Adresse publique du site (ex. `https://coffres.example.org`) : sert aux liens du compteur et de `admin show`. |
| `PORT` | Port publié (8080 par défaut). |
| `TZ` | Fuseau pour « aujourd'hui » et les coffres par jour (`Europe/Paris` par défaut). |
| `CONTENT_URL` | D'où vient la version la plus récente des données de la chasse au trésor (semaines, cotes, heures du trésor), relue toutes les 2 heures. Par défaut, le `content.json` du projet d'origine sur GitHub. Vide : uniquement la copie incluse dans l'image. |

**Accès depuis l'extérieur.** Pour que des amis hors de chez toi l'utilisent, mets le serveur derrière un reverse proxy en **HTTPS**, par exemple le reverse proxy intégré de DSM, Caddy, Traefik, Nginx Proxy Manager ou un tunnel Cloudflare / Tailscale. La clé du groupe passe dans un en-tête HTTP : sans HTTPS, elle circule en clair.

## Le site

Les onglets reprennent ceux du compteur :

- **Serveur** : tout ce que les joueurs du serveur ont envoyé, toutes parties confondues (seul, en groupe ou avec des inconnus) : total, coffres du jour, chances du serveur (au moins un joueur a eu la tenue en or ou l'accès à la boutique pirate), coffres par joueur, coffres par jour, dernières parties.
- **Groupes** : uniquement les parties **en groupe**, c'est-à-dire où au moins deux joueurs du serveur étaient dans la même équipe (qu'ils les aient toutes envoyées ou non). Chaque combinaison de joueurs (« Alice · Bob », « Alice · Bob · Cléo »…) avec ses parties, ses coffres, sa moyenne et son record, puis les coffres de chaque joueur en groupe.
- **Joueur** : ses coffres en tout, en groupe et hors groupe, ses groupes, ses dernières parties, ses types de coffres, ses trésors et l'adresse de son overlay OBS. Le joueur affiché se choisit en haut à droite.
- **Chances** : comme dans le compteur (1.5.1), avec les heures du trésor. Les trésors de la semaine (tenue en or, véhicule, pioche, piste, écran de chargement) ne comptent que les coffres de la semaine en cours, avec une ligne pour toute la chasse ; l'accès à la boutique pirate et les gizmos comptent tous les coffres de la chasse. Les coffres ouverts pendant une heure du trésor comptent avec leurs chances augmentées, et une chance n'est jamais affichée à 100 %.
- **Collection** : les trésors de la saison, semaine par semaine. Ceux vus dans les replays sont cochés tout seuls ; le reste se coche à la main et est enregistré sur le serveur.
- **Parties** : toutes les parties, 20 par page, filtrables (toutes / en groupe, par joueur), équipe par équipe, avec l'état de la synchro (`complet`, `2/4 joueurs`, `à vérifier`). Rien n'est jamais effacé : les parties restent même quand Fortnite supprime ses anciens replays.
- **Aide** : rejoindre le groupe, l'overlay OBS et les commandes des clés.

Le site est en **français**, **anglais** et **espagnol** : chacun choisit sa langue en haut à droite (retenue par le navigateur). Sans choix, c'est `DEFAULT_LANG` (français par défaut). L'overlay OBS suit le paramètre `?lang=` de son adresse, que le bouton *Copier* ajoute.

## Côté joueurs

Au **premier lancement**, `ChestCounter.exe` demande l'adresse du serveur et la clé du groupe. Sans adresse, il fonctionne **uniquement en local** : rien n'est envoyé. On peut ajouter ou changer le serveur à tout moment dans **Réglages → Serveur de groupe**, qui signale tout de suite une adresse injoignable ou une clé refusée. Les parties déjà comptées sont envoyées tout de suite, et les suivantes quelques secondes après la fin de chaque partie.

- **Overlay** : active **Afficher le total d'équipe (serveur de groupe)** (onglet Overlay) pour avoir la ligne *Équipe* (coffres de ton équipe à ta dernière partie).
- **OBS** : sur ta page joueur du site (`/p/<ton id>`), copie l'adresse de l'overlay OBS (`/overlay/<ton id>`) et ajoute-la comme source *Navigateur*, en 380 × 240. L'overlay local du compteur (`overlay.html`) marche toujours aussi.
- **Ligne de commande** : `ChestCounter.exe --server https://… --server-key …` règle le serveur ; avec `--once`, le compteur analyse les replays, envoie les parties, puis quitte.
- **Mises à jour** : **désactivées par défaut** dans ce fork, car elles installeraient la version du projet d'origine, qui n'a pas le serveur de groupe.

## API

| Méthode | Chemin | Accès |
|---|---|---|
| `POST` | `/api/matches` | en-tête `X-Group-Key`. Corps : `{client, matches:[{sessionId, epicId, name, startUtc, playlist, placement, teamIndex, chests, destroyed, chestKinds, chestSeconds, treasures, squad:[{epicId,isBot}], analyzerVersion, …}]}`. Réponse : `{accepted:[sessionId…]}`. Envoi idempotent : une analyse plus récente remplace l'ancienne, jamais l'inverse. |
| `GET` | `/api/ping` | en-tête `X-Group-Key` : vérifie l'adresse et la clé (401 si refusée) |
| `GET` | `/api/overview` | stats du groupe, joueurs, dernières parties, coffres par jour, chances du groupe |
| `GET` | `/api/players/{epicId}` | stats, parties, chances et collection d'un joueur |
| `GET` | `/api/players/{epicId}/summary` | ce que l'overlay du client affiche (dernière partie de l'équipe, aujourd'hui) |
| `GET` | `/api/games/{sessionId}` | les équipes du groupe dans une partie, avec les contrôles de cohérence |
| `GET` | `/api/content` | semaines, trésors, heures du trésor (collection et chances) |
| `POST` | `/api/players/{epicId}/obtained` | `{prizeId, on}` : cocher un trésor de la collection à la main |

Les appels de lecture demandent la clé de lecture (en-tête `X-View-Key`, `?k=` ou cookie) quand elle est définie.

## Développement

```bash
cd server
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # Windows : .venv\Scripts\pip
.venv/bin/python -m pytest -q
GROUP_KEY=dev-group-key DATA_DIR=./data-dev .venv/bin/python -m uvicorn app.main:app --reload --port 8080
```

## Règles d'Epic Games

Ce projet suit la logique de l'outil d'origine : il lit **en lecture seule** les replays que Fortnite enregistre sur le PC, après la partie. Il ne modifie pas le jeu, ne lit pas sa mémoire et n'interagit pas avec une partie en cours. Le serveur ne reçoit que des chiffres d'après-partie, sans aucune information qui donnerait un avantage en jeu (clause 2 (f) de l'EULA Fortnite). Il est gratuit, sans publicité et non commercial, conformément à la *Fan Content Policy* d'Epic.

Projet de fans non officiel, ni affilié ni approuvé par Epic Games. Fortnite est une marque déposée d'Epic Games, Inc. Pour l'utiliser, chacun doit respecter les conditions d'Epic.
