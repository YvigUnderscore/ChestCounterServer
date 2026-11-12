**English** · [Français](SERVEUR.md) · [Español](SERVIDOR.md)

# Group server (Docker edition, for the more technical)

A small self-hosted server (NAS, VPS, Raspberry Pi…) that brings together the chests of a group of friends:

- **each friend** runs `ChestCounter.exe`, which sends the server **their own chests** after each match;
- the server **adds up the chests of each team, match by match**, and sends the team total back to everyone's overlay;
- a **website** (just a link to share) shows the overall stats, those of each player and the details of each match, the odds and the collection;
- each player has an **overlay page for OBS** (Browser source, transparent background).

## How matches are synced

Each client only reads from its replay **what concerns its own player**: their chests (opened or destroyed) and when they opened them, the match id (`GameSessionId`, the same in the replay of every player of the match), their team number and the Epic ids of their teammates.

The server then sorts what it receives by match, then by team: two reports go together when they have the same team number, or when one lists the other among its teammates. The team total is the **sum of everyone's chests**, so:

- **a chest is never counted twice** (only whoever opened it sends it), even when a match is sent again or re-analyzed;
- a teammate who does not have the counter is **not guessed**: the match is marked `2/4 players` and the total shown with a `+` (it is a minimum);
- when the reports of one team do not tell the same story (different team number, teammates, placement, mode or start time), the match is flagged **"to check"**, with the reason;
- bots are ignored, and friends in different teams of the same match stay apart.

The original tool's mechanism, which counted the chests of teammates seen within 150 m in your replay, is removed. So is the record of the treasures other players got in the match. **Nothing is kept about players outside the group**: a random teammate shows up as "Teammate outside the group", without a name.

## Install

Requirements: Docker with Docker Compose (Synology: *Container Manager*; QNAP: *Container Station*; TrueNAS, Portainer or any Linux).

```bash
git clone <this repository> chestcounter && cd chestcounter
cp .env.example .env        # optional: everything has a default
docker compose up -d
docker compose exec chests python -m app.admin show
```

The last command shows the **group key**, generated on the first start, and the link to share. The website answers on `http://<server-ip>:8080`. Everything that matters is in `./data`: the SQLite database (`chests.db`) and the keys (`keys.json`). It is the only folder to back up.

### With Portainer (NAS)

- **Stack from the repository**: *Stacks → Add stack → Repository*, the address of this repository and `docker-compose.yml`. Portainer builds the image itself.
- **Or with an imported image**: on a PC, `docker compose build` then `docker save chestcounter-server:latest -o chestcounter-server.tar`, and in Portainer *Images → Import*. The stack then only needs this (adjust the port and the address):

```yaml
services:
  chests:
    image: chestcounter-server:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      PUBLIC_URL: "http://my-nas.local:8080"
      TZ: "Europe/Paris"
    volumes: ["chestcounter-data:/data"]
volumes:
  chestcounter-data:
```

The group key generated on the first start shows in the container's **logs**. The `app.admin` commands below run in *Containers → chestcounter → Exec Console*, without the `docker compose exec chests` prefix (for example `python -m app.admin rotate group`).

### The keys

| Key | Role |
|---|---|
| **group** | To **send** matches: each friend puts it in ChestCounter. Only give it to the friends of the group. |
| **view** | Optional. To **read** the website: you then share the link `https://host/?k=<key>`, which the browser remembers. Without a view key, whoever has the address can read. |

The keys are managed from the container. A change applies at once, without a restart:

```bash
docker compose exec chests python -m app.admin show            # show the keys and the link to share
docker compose exec chests python -m app.admin rotate group    # new key to send matches (give it to the friends again)
docker compose exec chests python -m app.admin rotate view     # new key to read the site (new link)
docker compose exec chests python -m app.admin clear view      # site readable by whoever has the address
docker compose exec chests python -m app.admin set group <key> # choose the key yourself (12 characters min.)
```

`GROUP_KEY` and `VIEW_KEY` (in `.env`) are only used on the **first** start. After that, `data/keys.json` is what counts.

### Settings (`.env`)

| Variable | Role |
|---|---|
| `GROUP_NAME` | Name shown at the top of the website. |
| `PUBLIC_URL` | Public address of the website (e.g. `https://chests.example.org`): used for the links of the counter and of `admin show`. |
| `PORT` | Published port (8080 by default). |
| `TZ` | Time zone for "today" and the chests per day (`Europe/Paris` by default). |
| `CONTENT_URL` | Where the latest treasure hunt data comes from (weeks, odds, Treasure Hours), read again every 2 hours. By default, the original project's `content.json` on GitHub. Empty: only the copy built into the image. |

**Access from outside.** For friends outside your home to use it, put the server behind a reverse proxy with **HTTPS**, for example DSM's built-in reverse proxy, Caddy, Traefik, Nginx Proxy Manager or a Cloudflare / Tailscale tunnel. The group key travels in an HTTP header: without HTTPS, it goes in clear text.

## The website

The tabs follow those of the counter:

- **Serveur** (server): everything the players of the server sent, every match (alone, in a group or with strangers): total, today's chests, the server's odds (at least one player got the gold outfit or the Pirate Shop Access), chests per player, chests per day, latest matches.
- **Groupes** (groups): only the matches **in a group**, i.e. where at least two players of the server were in the same team (whether or not they all sent it). Each combination of players ("Alice · Bob", "Alice · Bob · Cleo"…) with its matches, chests, average and best match, then each player's chests in groups.
- **Joueur** (player): their chests in total, in groups and outside groups, their groups, latest matches, chest types, treasures and the address of their OBS overlay. The player shown is picked at the top right.
- **Chances** (odds): as in the counter, with the Treasure Hours. Chests opened during a Treasure Hour count with their boosted odds.
- **Collection**: the season's treasures, week by week. Those seen in the replays are ticked by themselves; the rest is ticked by hand and saved on the server.
- **Parties** (matches): every match, 20 per page, filtered (all / in a group, by player), team by team, with the sync status (`complet`, `2/4 joueurs`, `à vérifier`). Nothing is ever deleted: matches stay even when Fortnite deletes its old replays.
- **Aide** (help): joining the group, the OBS overlay and the key commands.

The website is in French for now.

## For the players

On the **first launch**, `ChestCounter.exe` asks for the server's address and the group key. Without an address, it works **locally only**: nothing is sent. The server can be added or changed at any time in **Settings → Group server**, which shows at once an address that cannot be reached or a key that is refused. The matches already counted are sent right away, and the next ones a few seconds after each match ends.

- **Overlay**: turn on **Show the squad total (group server)** (Overlay tab) to get the *Squad* line (chests of your team in your last match).
- **OBS**: on your player page of the website (`/p/<your id>`), copy the address of the OBS overlay (`/overlay/<your id>`) and add it as a *Browser* source, 380 × 240. The counter's local overlay (`overlay.html`) still works too.
- **Command line**: `ChestCounter.exe --server https://… --server-key …` sets the server; with `--once`, the counter analyzes the replays, sends the matches, then quits.
- **Updates**: **off by default** in this fork, as they would install the original project's version, which has no group server.

## API

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/matches` | header `X-Group-Key`. Body: `{client, matches:[{sessionId, epicId, name, startUtc, playlist, placement, teamIndex, chests, destroyed, chestKinds, chestSeconds, treasures, squad:[{epicId,isBot}], analyzerVersion, …}]}`. Answer: `{accepted:[sessionId…]}`. Idempotent: a newer analysis replaces an older one, never the reverse. |
| `GET` | `/api/ping` | header `X-Group-Key`: checks the address and the key (401 when refused) |
| `GET` | `/api/overview` | group stats, players, latest matches, chests per day, the group's odds |
| `GET` | `/api/players/{epicId}` | a player's stats, matches, odds and collection |
| `GET` | `/api/players/{epicId}/summary` | what the client's overlay shows (team of the last match, today) |
| `GET` | `/api/games/{sessionId}` | the group's teams in a match, with the consistency checks |
| `GET` | `/api/content` | weeks, treasures, Treasure Hours (collection and odds) |
| `POST` | `/api/players/{epicId}/obtained` | `{prizeId, on}`: tick a treasure of the collection by hand |

The read calls need the view key (header `X-View-Key`, `?k=` or cookie) when one is set.

## Development

```bash
cd server
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # Windows: .venv\Scripts\pip
.venv/bin/python -m pytest -q
GROUP_KEY=dev-group-key DATA_DIR=./data-dev .venv/bin/python -m uvicorn app.main:app --reload --port 8080
```

## Epic Games rules

This project follows the logic of the original tool: it reads, **read-only**, the replays Fortnite saves on the PC, after the match. It does not modify the game, does not read its memory and does not interact with a match in progress. The server only receives after-match figures, with no information that would give an advantage in game (clause 2 (f) of the Fortnite EULA). It is free, ad-free and non-commercial, in line with Epic's *Fan Content Policy*.

Unofficial fan project, not affiliated with or endorsed by Epic Games. Fortnite is a registered trademark of Epic Games, Inc. Everyone using it must follow Epic's terms.
