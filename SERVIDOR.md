[English](SERVER.md) · [Français](SERVEUR.md) · **Español**

# Servidor de grupo (edición Docker, para los más técnicos)

Un pequeño servidor que alojas tú mismo (NAS, VPS, Raspberry Pi…) y que reúne los cofres de un grupo de amigos:

- **cada amigo** abre `ChestCounter.exe`, que envía al servidor, después de cada partida, **sus propios cofres**;
- el servidor **suma los cofres de cada equipo, partida por partida**, y devuelve el total del equipo al overlay de cada uno;
- un **sitio web** (solo un enlace para compartir) muestra las estadísticas globales, las de cada jugador y el detalle de cada partida, las probabilidades y la colección;
- cada jugador tiene una **página overlay para OBS** (fuente Navegador, fondo transparente).

## Cómo se sincronizan las partidas

Cada cliente solo lee de su repetición **lo que concierne a su jugador**: sus cofres (abiertos o destruidos) y cuándo los abrió, el id de la partida (`GameSessionId`, el mismo en la repetición de todos los jugadores de la partida), su número de equipo y los ids de Epic de sus compañeros.

El servidor ordena después cada envío por partida y luego por equipo: dos envíos van juntos si tienen el mismo número de equipo, o si uno cita al otro entre sus compañeros. El total del equipo es la **suma de los cofres de cada uno**, así que:

- **un cofre nunca se cuenta dos veces** (solo lo envía quien lo abrió), aunque una partida se envíe de nuevo o se vuelva a analizar;
- un compañero que no tiene el contador **no se adivina**: la partida se marca `2/4 jugadores` y el total se muestra con un `+` (es un mínimo);
- si los envíos de un mismo equipo no cuentan la misma historia (número de equipo, compañeros, puesto, modo u hora distintos), la partida se marca **«a revisar»**, con el motivo;
- los bots se ignoran, y los amigos en equipos distintos de una misma partida quedan separados.

Se ha quitado el mecanismo de la herramienta original que contaba los cofres de los compañeros vistos a menos de 150 m en tu repetición. También el registro de los tesoros que consiguieron otros jugadores de la partida. **No se guarda nada sobre los jugadores fuera del grupo**: un compañero aleatorio aparece como «Compañero fuera del grupo», sin nombre.

## Instalación

Requisitos: Docker con Docker Compose (Synology: *Container Manager*; QNAP: *Container Station*; TrueNAS, Portainer o cualquier Linux).

```bash
git clone <este repositorio> chestcounter && cd chestcounter
cp .env.example .env        # opcional: todo tiene un valor por defecto
docker compose up -d
docker compose exec chests python -m app.admin show
```

El último comando muestra la **clave del grupo**, generada en el primer arranque, y el enlace para compartir. El sitio responde en `http://<ip-del-servidor>:8080`. Todo lo que importa está en `./data`: la base SQLite (`chests.db`) y las claves (`keys.json`). Es la única carpeta que hay que respaldar.

### Con Portainer (NAS)

- **Stack desde el repositorio**: *Stacks → Add stack → Repository*, la dirección de este repositorio y `docker-compose.yml`. Portainer construye la imagen él mismo.
- **O con una imagen importada**: en un PC, `docker compose build` y luego `docker save chestcounter-server:latest -o chestcounter-server.tar`, y en Portainer *Images → Import*. El stack solo necesita entonces esto (ajusta el puerto y la dirección):

```yaml
services:
  chests:
    image: chestcounter-server:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      PUBLIC_URL: "http://mi-nas.local:8080"
      TZ: "Europe/Madrid"
    volumes: ["chestcounter-data:/data"]
volumes:
  chestcounter-data:
```

La clave del grupo generada en el primer arranque aparece en los **logs** del contenedor. Los comandos `app.admin` de abajo se ejecutan en *Containers → chestcounter → Exec Console*, sin el prefijo `docker compose exec chests` (por ejemplo `python -m app.admin rotate group`).

### Las claves

| Clave | Función |
|---|---|
| **grupo** | Para **enviar** partidas: cada amigo la pone en ChestCounter. Dásela solo a los amigos del grupo. |
| **lectura** | Opcional. Para **leer** el sitio: entonces se comparte el enlace `https://host/?k=<clave>`, que el navegador recuerda. Sin clave de lectura, cualquiera que tenga la dirección puede leer. |

Las claves se gestionan desde el contenedor. Un cambio se aplica enseguida, sin reiniciar:

```bash
docker compose exec chests python -m app.admin show            # mostrar las claves y el enlace para compartir
docker compose exec chests python -m app.admin rotate group    # nueva clave de envío (hay que darla de nuevo a los amigos)
docker compose exec chests python -m app.admin rotate view     # nueva clave de lectura (nuevo enlace)
docker compose exec chests python -m app.admin clear view      # sitio legible por quien tenga la dirección
docker compose exec chests python -m app.admin set group <clave> # elegir la clave tú mismo (12 caracteres mín.)
```

`GROUP_KEY` y `VIEW_KEY` (en `.env`) solo se usan en el **primer** arranque. Después, lo que cuenta es `data/keys.json`.

### Ajustes (`.env`)

| Variable | Función |
|---|---|
| `GROUP_NAME` | Nombre mostrado arriba del sitio. |
| `PUBLIC_URL` | Dirección pública del sitio (p. ej. `https://cofres.example.org`): sirve para los enlaces del contador y de `admin show`. |
| `PORT` | Puerto publicado (8080 por defecto). |
| `TZ` | Zona horaria para «hoy» y los cofres por día (`Europe/Paris` por defecto). |
| `CONTENT_URL` | De dónde viene la versión más reciente de los datos de la búsqueda del tesoro (semanas, probabilidades, horas del tesoro), que se vuelve a leer cada 2 horas. Por defecto, el `content.json` del proyecto original en GitHub. Vacío: solo la copia incluida en la imagen. |

**Acceso desde fuera.** Para que amigos fuera de tu casa lo usen, pon el servidor detrás de un proxy inverso con **HTTPS**, por ejemplo el proxy inverso integrado de DSM, Caddy, Traefik, Nginx Proxy Manager o un túnel de Cloudflare / Tailscale. La clave del grupo viaja en una cabecera HTTP: sin HTTPS, va en claro.

## El sitio web

Las pestañas siguen las del contador:

- **Serveur** (servidor): todo lo que han enviado los jugadores del servidor, todas las partidas (solo, en grupo o con desconocidos): total, cofres del día, probabilidades del servidor (al menos un jugador consiguió el traje de oro o el acceso a la tienda pirata), cofres por jugador, cofres por día, últimas partidas.
- **Groupes** (grupos): solo las partidas **en grupo**, es decir, en las que al menos dos jugadores del servidor estaban en el mismo equipo (las hayan enviado todos o no). Cada combinación de jugadores («Alicia · Bob», «Alicia · Bob · Cleo»…) con sus partidas, cofres, media y récord, y luego los cofres de cada jugador en grupo.
- **Joueur** (jugador): sus cofres en total, en grupo y fuera de grupo, sus grupos, últimas partidas, tipos de cofres, tesoros y la dirección de su overlay de OBS. El jugador mostrado se elige arriba a la derecha.
- **Chances** (probabilidades): como en el contador, con las horas del tesoro. Los cofres abiertos durante una hora del tesoro cuentan con su probabilidad aumentada.
- **Collection** (colección): los tesoros de la temporada, semana por semana. Los vistos en las repeticiones se marcan solos; el resto se marca a mano y se guarda en el servidor.
- **Parties** (partidas): todas las partidas, 20 por página, filtrables (todas / en grupo, por jugador), equipo por equipo, con el estado de la sincronización (`complet`, `2/4 joueurs`, `à vérifier`). Nunca se borra nada: las partidas se quedan aunque Fortnite borre sus repeticiones antiguas.
- **Aide** (ayuda): unirse al grupo, el overlay de OBS y los comandos de las claves.

De momento el sitio está en francés.

## Para los jugadores

En el **primer inicio**, `ChestCounter.exe` pide la dirección del servidor y la clave del grupo. Sin dirección, funciona **solo en local**: no se envía nada. El servidor se puede añadir o cambiar en cualquier momento en **Ajustes → Servidor de grupo**, que avisa enseguida si la dirección no responde o la clave se rechaza. Las partidas ya contadas se envían enseguida, y las siguientes unos segundos después del final de cada partida.

- **Overlay**: activa **Mostrar el total del equipo (servidor de grupo)** (pestaña Overlay) para tener la línea *Equipo* (cofres de tu equipo en tu última partida).
- **OBS**: en tu página de jugador del sitio (`/p/<tu id>`), copia la dirección del overlay de OBS (`/overlay/<tu id>`) y añádela como fuente *Navegador*, de 380 × 240. El overlay local del contador (`overlay.html`) también sigue funcionando.
- **Línea de comandos**: `ChestCounter.exe --server https://… --server-key …` ajusta el servidor; con `--once`, el contador analiza las repeticiones, envía las partidas y se cierra.
- **Actualizaciones**: **desactivadas por defecto** en este fork, porque instalarían la versión del proyecto original, que no tiene servidor de grupo.

## API

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/api/matches` | cabecera `X-Group-Key`. Cuerpo: `{client, matches:[{sessionId, epicId, name, startUtc, playlist, placement, teamIndex, chests, destroyed, chestKinds, chestSeconds, treasures, squad:[{epicId,isBot}], analyzerVersion, …}]}`. Respuesta: `{accepted:[sessionId…]}`. Idempotente: un análisis más reciente sustituye al anterior, nunca al revés. |
| `GET` | `/api/ping` | cabecera `X-Group-Key`: comprueba la dirección y la clave (401 si se rechaza) |
| `GET` | `/api/overview` | estadísticas del grupo, jugadores, últimas partidas, cofres por día, probabilidades del grupo |
| `GET` | `/api/players/{epicId}` | estadísticas, partidas, probabilidades y colección de un jugador |
| `GET` | `/api/players/{epicId}/summary` | lo que muestra el overlay del cliente (equipo de la última partida, hoy) |
| `GET` | `/api/games/{sessionId}` | los equipos del grupo en una partida, con los controles de coherencia |
| `GET` | `/api/content` | semanas, tesoros, horas del tesoro (colección y probabilidades) |
| `POST` | `/api/players/{epicId}/obtained` | `{prizeId, on}`: marcar a mano un tesoro de la colección |

Las llamadas de lectura piden la clave de lectura (cabecera `X-View-Key`, `?k=` o cookie) cuando hay una.

## Desarrollo

```bash
cd server
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # Windows: .venv\Scripts\pip
.venv/bin/python -m pytest -q
GROUP_KEY=dev-group-key DATA_DIR=./data-dev .venv/bin/python -m uvicorn app.main:app --reload --port 8080
```

## Reglas de Epic Games

Este proyecto sigue la lógica de la herramienta original: lee, **en solo lectura**, las repeticiones que Fortnite guarda en el PC, después de la partida. No modifica el juego, no lee su memoria y no interactúa con una partida en curso. El servidor solo recibe cifras de después de la partida, sin ninguna información que dé una ventaja en el juego (cláusula 2 (f) del EULA de Fortnite). Es gratuito, sin publicidad y no comercial, conforme a la *Fan Content Policy* de Epic.

Proyecto de fans no oficial, no afiliado ni respaldado por Epic Games. Fortnite es una marca registrada de Epic Games, Inc. Quien lo use debe respetar las condiciones de Epic.
