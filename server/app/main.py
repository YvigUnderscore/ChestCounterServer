"""ChestCounter group server.

Each friend's ChestCounter client sends, after every match, ONLY what their own replay says about themselves:
their chests (and when they were opened), the match id (GameSessionId: identical in every replay of the same match),
their team index and the Epic ids of their teammates. The server puts the reports of one team in one match together
and adds them up, so every chest is counted once (by the player who opened it) and a teammate who does not use the
counter is shown as "no data" instead of being guessed.

Nothing is read from Fortnite or Epic: the server only stores what the clients of the group send.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, keys, treasures
from .groups import build_teams, group_stats

log = logging.getLogger("uvicorn.error")

GROUP_NAME = os.environ.get("GROUP_NAME", "Coffres du serveur")
# Language of the website for a visitor who has not picked one (fr, en or es).
_LANG = os.environ.get("DEFAULT_LANG", "fr").strip().lower()[:2]
DEFAULT_LANG = _LANG if _LANG in ("fr", "en", "es") else "fr"
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
TZ = ZoneInfo(os.environ.get("TZ") or "Europe/Paris")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    k, generated = keys.ensure()
    if generated:
        log.warning("Clé du groupe générée (à mettre dans ChestCounter) : %s", k["group"])
        log.warning("Pour la revoir ou la changer : docker compose exec chests python -m app.admin show | rotate group")
    db.init(DATA_DIR / "chests.db")
    treasures.load()
    if os.environ.get("CONTENT_URL"):
        treasures.start_refresher()
    yield


app = FastAPI(title="ChestCounter group server", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


# --- access ----------------------------------------------------------------------------------------------------

def _same(a: str, b: str) -> bool:
    return bool(a) and bool(b) and secrets.compare_digest(a.encode(), b.encode())


def can_write(request: Request) -> bool:
    return _same(request.headers.get("x-group-key", ""), keys.load()["group"])


def can_read(request: Request) -> bool:
    view = keys.load()["view"]
    if not view:
        return True
    given = request.headers.get("x-view-key") or request.query_params.get("k") or request.cookies.get("cc_view") or ""
    return _same(given, view) or can_write(request)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path != "/api/matches" and not can_read(request):
        return JSONResponse({"detail": "view key required"}, status_code=401)
    response = await call_next(request)
    # A private group page: never indexed by search engines.
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    # The view key given in a link is kept in a cookie, so the other pages work without it in the address.
    k = request.query_params.get("k")
    view = keys.load()["view"]
    if view and k and _same(k, view):
        response.set_cookie("cc_view", k, max_age=365 * 24 * 3600, httponly=True, samesite="lax")
    return response


# --- upload ----------------------------------------------------------------------------------------------------

class Mate(BaseModel):
    epicId: str = Field(min_length=1, max_length=64)
    isBot: bool = False


class Treasure(BaseModel):
    prizeId: str | None = Field(default=None, max_length=120)
    name: str = Field(default="", max_length=120)
    atSeconds: float | None = None


class MatchIn(BaseModel):
    sessionId: str = Field(min_length=1, max_length=120)
    epicId: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=64)
    startUtc: datetime | None = None
    durationSeconds: int | None = Field(default=None, ge=0, le=6 * 3600)
    playlist: str | None = Field(default=None, max_length=120)
    map: str | None = Field(default=None, max_length=200)
    placement: int | None = Field(default=None, ge=0, le=1000)
    totalPlayers: int | None = Field(default=None, ge=0, le=1000)
    eliminations: int | None = Field(default=None, ge=0, le=1000)
    teamIndex: int | None = None
    chests: int = Field(ge=0, le=500)
    destroyed: int = Field(default=0, ge=0, le=500)
    chestKinds: dict[str, int] = Field(default_factory=dict, max_length=40)
    chestSeconds: list[int] = Field(default_factory=list, max_length=500)
    treasures: list[Treasure] = Field(default_factory=list, max_length=50)
    squad: list[Mate] = Field(default_factory=list, max_length=16)
    analyzerVersion: int = 0


class Upload(BaseModel):
    client: str = Field(default="", max_length=60)
    matches: list[MatchIn] = Field(max_length=100)


@app.post("/api/matches")
def upload(body: Upload, request: Request):
    if not can_write(request):
        raise HTTPException(401, "group key refused")
    with db.tx() as c:
        for m in body.matches:
            # An older analysis than the one already stored is not kept, but there is nothing to send again either.
            db.upsert_report(c, m.model_dump(mode="json"))
    return {"accepted": [m.sessionId for m in body.matches]}


@app.get("/api/ping")
def ping(request: Request):
    """Lets a client check its address and group key before it has any match to send."""
    if not can_write(request):
        raise HTTPException(401, "group key refused")
    return {"ok": True, "groupName": GROUP_NAME}


# --- reading ---------------------------------------------------------------------------------------------------

def _today_start_utc() -> datetime:
    now = datetime.now(TZ)
    return now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def _teams_of(c, session_ids: list[str]):
    """All teams (one per team per match) of the given matches."""
    return build_teams(db.reports_of_sessions(c, session_ids), db.player_names(c))


def _all_teams(c) -> list[dict]:
    """Every team of every match ever received, newest first (nothing is ever deleted)."""
    teams = build_teams(db.all_reports(c), db.player_names(c))
    teams.sort(key=lambda t: t["startUtc"] or "", reverse=True)
    return teams


@app.get("/api/players/{epic_id}/summary")
def player_summary(epic_id: str):
    """What a client shows on its overlay: the player's team in their last match, today's team chests."""
    with db.tx() as c:
        if not db.player_exists(c, epic_id):
            raise HTTPException(404, "unknown player")
        last = db.last_session_of(c, epic_id)
        today_sessions = db.sessions_of_since(c, epic_id, _today_start_utc())
        teams = _teams_of(c, list({*today_sessions, *([last] if last else [])}))
        mine = [t for t in teams if epic_id in t["reporters"]]
        last_team = next((t for t in mine if t["sessionId"] == last), None)
        today = [t for t in mine if t["sessionId"] in today_sessions]
        group_total = db.group_total(c)
    return {
        "groupName": GROUP_NAME,
        "dashboardUrl": f"{PUBLIC_URL}/p/{epic_id}" if PUBLIC_URL else None,
        "lastGame": None if not last_team else {
            "sessionId": last_team["sessionId"],
            "startUtc": last_team["startUtc"],
            "teamChests": last_team["teamChests"],
            "reported": last_team["reported"],
            "humans": last_team["humans"],
            "complete": last_team["complete"],
            "consistent": last_team["consistent"],
            "members": [{"name": m["name"], "chests": m["chests"], "me": m["epicId"] == epic_id} for m in last_team["members"]],
        },
        "todayTeamChests": sum(t["teamChests"] for t in today),
        "todayGames": len(today),
        "groupTotal": group_total,
    }


@app.get("/api/overview")
def overview(days: int = 30):
    with db.tx() as c:
        players = db.player_stats(c)
        recent = db.recent_sessions(c, limit=40)
        teams = _teams_of(c, recent)
        per_day = db.chests_per_day(c, datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365))), TZ)
        matches = db.session_count(c)
        every = db.all_reports(c)
        today = db.chests_since(c, _today_start_utc())
        groups = group_stats(_all_teams(c), db.player_names(c))["totals"]
    teams.sort(key=lambda t: t["startUtc"] or "", reverse=True)
    return {
        "groupName": GROUP_NAME,
        "defaultLang": DEFAULT_LANG,
        "totals": {"chests": sum(p["chests"] for p in players), "matches": matches, "players": len(players),
                   "treasures": sum(p["treasures"] for p in players), "today": today,
                   "groupGames": groups["games"], "groupChests": groups["chests"]},
        "players": players,
        "games": teams,
        "perDay": per_day,
        # Chance that at least one member of the group got each treasure, with all the group's chests.
        "chances": treasures.chances(every),
    }


@app.get("/api/players/{epic_id}")
def player(epic_id: str):
    with db.tx() as c:
        stats = next((p for p in db.player_stats(c) if p["epicId"] == epic_id), None)
        if stats is None:
            raise HTTPException(404, "unknown player")
        sessions = db.sessions_of(c, epic_id, limit=1_000_000)
        teams = [t for t in _teams_of(c, sessions) if epic_id in t["reporters"]]
        names = db.player_names(c)
        reports = db.reports_of_player(c, epic_id)
        obtained = db.obtained_of(c, epic_id)
    teams.sort(key=lambda t: t["startUtc"] or "", reverse=True)
    kinds: dict[str, int] = {}
    for r in reports:
        for k, n in json.loads(r["chest_kinds"] or "{}").items():
            kinds[k] = kinds.get(k, 0) + n
    found = []
    for r in reports:
        for t in json.loads(r["treasures"] or "[]"):
            prize = treasures.prize_for(t.get("prizeId"))
            found.append({**t, "name": prize["name"] if prize else (t.get("name") or None), "catalogId": prize["id"] if prize else None,
                          "sessionId": r["session_id"], "startUtc": r["start_utc"]})
    found.sort(key=lambda t: t["startUtc"] or "", reverse=True)
    def own(t):
        return next((m["chests"] for m in t["members"] if m["epicId"] == epic_id), 0) or 0
    in_group = [t for t in teams if t["isGroup"]]
    alone = [t for t in teams if not t["isGroup"]]
    split = {
        "groupGames": len(in_group), "groupChests": sum(own(t) for t in in_group),
        "groupTeamChests": sum(t["teamChests"] for t in in_group),
        "otherGames": len(alone), "otherChests": sum(own(t) for t in alone),
    }
    return {
        "player": stats, "games": teams, "chestKinds": kinds, "treasures": found, "split": split,
        "lineups": group_stats(in_group, names)["lineups"],
        "chances": treasures.chances(reports),
        "collection": {"auto": sorted({t["catalogId"] for t in found if t["catalogId"]}), "ticked": obtained},
    }


class Obtained(BaseModel):
    prizeId: str = Field(min_length=1, max_length=60)
    on: bool


@app.post("/api/players/{epic_id}/obtained")
def set_obtained(epic_id: str, body: Obtained):
    """Ticks a treasure of the collection by hand (what the replays could not tell)."""
    known = {p["id"] for w in treasures.catalog()["weeks"] for p in w["prizes"]}
    if (pirate := treasures.catalog()["pirateShop"]) is not None:
        known.add(pirate["id"])
    if body.prizeId not in known:
        raise HTTPException(400, "unknown treasure")
    with db.tx() as c:
        if not db.player_exists(c, epic_id):
            raise HTTPException(404, "unknown player")
        db.set_obtained(c, epic_id, body.prizeId, body.on)
    return {"ok": True}


@app.get("/api/games/{session_id}")
def game(session_id: str):
    with db.tx() as c:
        teams = _teams_of(c, [session_id])
    if not teams:
        raise HTTPException(404, "unknown match")
    return {"sessionId": session_id, "teams": teams}


@app.get("/api/groups")
def groups():
    """The "Groupes" tab: only the matches shared by at least two players of the server."""
    with db.tx() as c:
        teams = _all_teams(c)
        stats = group_stats(teams, db.player_names(c))
    return {**stats, "games": [t for t in teams if t["isGroup"]][:10]}


@app.get("/api/games")
def games(scope: str = "all", player: str = "", offset: int = 0, limit: int = 20):
    """Every match, newest first, 20 at a time: all of them, or only the group ones, or those of one player."""
    with db.tx() as c:
        teams = _all_teams(c)
    if scope == "group":
        teams = [t for t in teams if t["isGroup"]]
    if player:
        teams = [t for t in teams if player in t["reporters"]]
    offset, limit = max(0, offset), max(1, min(limit, 100))
    return {"total": len(teams), "offset": offset, "games": teams[offset:offset + limit]}


@app.get("/api/content")
def content():
    """Weeks, prizes, Treasure Hours: what the collection and the odds pages show."""
    return {**treasures.catalog(), "groupName": GROUP_NAME, "publicUrl": PUBLIC_URL or None, "defaultLang": DEFAULT_LANG}


# --- pages -----------------------------------------------------------------------------------------------------

@app.get("/robots.txt", response_class=PlainTextResponse)
def robots():
    return "User-agent: *\nDisallow: /\n"


@app.get("/healthz", response_class=PlainTextResponse)
def health():
    return "ok"


def _page(name: str):
    return FileResponse(STATIC / name, headers={"Cache-Control": "no-cache"})


# One page for the whole site (tabs drawn by app.js from the address).
@app.get("/")
@app.get("/chances")
@app.get("/collection")
@app.get("/parties")
@app.get("/groupes")
@app.get("/aide")
def site():
    return _page("index.html")


@app.get("/p/{epic_id}")
@app.get("/p/{epic_id}/{tab}")
def site_player(epic_id: str, tab: str = ""):
    return _page("index.html")


@app.get("/g/{session_id}")
def site_game(session_id: str):
    return _page("index.html")


@app.get("/overlay/{epic_id}")
def overlay_page(epic_id: str):
    """Transparent page for OBS (Browser source): the player's figures and their team's, refreshed by itself."""
    return _page("overlay.html")


@app.get("/treasures/{name}")
def treasure_image(name: str):
    """Treasure pictures from the repository (assets/treasures), so the site does not load them from another site."""
    folder = treasures.treasures_dir().resolve()
    path = (folder / name).resolve()
    if path.parent != folder or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
