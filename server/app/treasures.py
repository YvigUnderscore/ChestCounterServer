"""Treasure hunt data (content/content.json, the same file as the counter's) and the odds computed from it.

The file is built into the image; a newer copy (higher "revision") is fetched from CONTENT_URL at startup and every
2 hours, like the counter does, so a new week shows without rebuilding the image. CONTENT_URL empty = no download.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("chestcounter.content")

KIND_NAMES = {
    "outfit": "Tenue en or",
    "pirate-shop": "Accès à la boutique pirate",
    "car": "Véhicule et autocollant",
    "pickaxe": "Pioche ou sac à dos",
    "jam": "Piste musicale",
    "loading": "Écran de chargement",
    "gizmo": "Gizmo (n'importe lequel)",
}
BIG_KINDS = ("outfit", "pirate-shop")

_lock = threading.Lock()
_content: dict = {}


def _default_file() -> Path:
    here = Path(__file__).resolve()
    for p in (Path("/srv/content/content.json"), here.parents[2] / "content" / "content.json"):
        if p.exists():
            return p
    return here.parents[2] / "content" / "content.json"


def treasures_dir() -> Path:
    here = Path(__file__).resolve()
    env = os.environ.get("TREASURES_DIR")
    if env:
        return Path(env)
    for p in (Path("/srv/assets/treasures"), here.parents[2] / "assets" / "treasures"):
        if p.exists():
            return p
    return here.parents[2] / "assets" / "treasures"


def _valid(c: dict) -> bool:
    try:
        return c.get("schema") == 1 and isinstance(c.get("revision"), int) and isinstance(c["weeks"], list) and isinstance(c["odds"], list)
    except (KeyError, TypeError):
        return False


def load() -> None:
    global _content
    path = Path(os.environ.get("CONTENT_FILE") or _default_file())
    c = json.loads(path.read_text(encoding="utf-8"))
    cached = Path(os.environ.get("DATA_DIR", "/data")) / "content.json"
    if cached.exists():
        try:
            newer = json.loads(cached.read_text(encoding="utf-8"))
            if _valid(newer) and newer["revision"] > c.get("revision", 0):
                c = newer
        except (OSError, ValueError):
            pass
    with _lock:
        _content = c


def refresh() -> bool:
    """Downloads a newer content.json from CONTENT_URL. Returns True when it replaced the current one."""
    global _content
    url = os.environ.get("CONTENT_URL", "").strip()
    if not url:
        return False
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ChestCounter-server"}), timeout=15) as r:
            c = json.loads(r.read(2_000_000))
    except Exception as e:  # network down, GitHub unreachable: keep the current data
        log.info("content.json not refreshed: %s", e)
        return False
    if not _valid(c) or c["revision"] <= current().get("revision", 0):
        return False
    with _lock:
        _content = c
    try:
        (Path(os.environ.get("DATA_DIR", "/data")) / "content.json").write_text(json.dumps(c), encoding="utf-8")
    except OSError:
        pass
    return True


def start_refresher() -> None:
    def loop():
        while True:
            refresh()
            time.sleep(2 * 3600)
    threading.Thread(target=loop, daemon=True, name="content-refresh").start()


def current() -> dict:
    with _lock:
        return _content


# --- dates ------------------------------------------------------------------------------------------------------

def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _hours(c: dict) -> list[tuple[datetime, datetime, dict]]:
    return [(_dt(h["start"]), _dt(h["end"]), h.get("boosts", {})) for h in c.get("treasureHours", [])]


def boost(kind: str, at: datetime, hours) -> float:
    for start, end, boosts in hours:
        if start <= at < end:
            b = boosts.get(kind, 1)
            return b if b and b > 0 else 1
    return 1


# --- odds -------------------------------------------------------------------------------------------------------

def _boost_of(chest, kind: str, hours) -> float:
    """A chest is (time, exact). Only a chest whose own time is known gets the Treasure Hour boost."""
    t, exact = chest
    return boost(kind, t, hours) if exact else 1


def at_least_once(one_in: int, chests: list, plain: int, kind: str, hours) -> float:
    """1 − Π(1 − p × boost): each chest with the boost of the moment it was opened, plus `plain` chests at normal odds."""
    p = 1.0 / one_in
    total = max(0, plain) * math.log1p(-p)
    for c in chests:
        total += math.log1p(-min(0.999, p * _boost_of(c, kind, hours)))
    return -math.expm1(total)


def chests_for(one_in: int, chance: float) -> int:
    return math.ceil(math.log(1 - chance) / math.log1p(-1.0 / one_in))


def chest_times_of(reports) -> tuple[list[tuple[datetime, bool]], int]:
    """
    The chests of these reports as (when, exact): exact when the client sent the time of each chest; otherwise
    (clients older than the chest times) the start of the match, which gives the right week but no Treasure Hour
    boost. `plain` counts the chests of a report without even a start time.
    """
    chests, plain = [], 0
    for r in reports:
        seconds = json.loads(r["chest_seconds"] or "[]")
        start = _dt(r["start_utc"])
        if start is None:
            plain += r["chests"]
        elif len(seconds) == r["chests"]:
            chests += [(start + timedelta(seconds=s), True) for s in seconds]
        else:
            chests += [(start, False)] * r["chests"]
    return chests, plain


def _average(one_in: int, times: list[datetime], plain: int, kind: str, hours) -> float:
    """Expected number of treasures (with the Treasure Hour boosts, like "at least one")."""
    p = 1.0 / one_in
    return max(0, plain) * p + sum(min(0.999, p * _boost_of(c, kind, hours)) for c in times)


def chances(reports, now: datetime | None = None) -> dict | None:
    """
    Chance of having obtained each kind of treasure at least once with the chests of these reports, as the counter
    computes it since 1.5.1: chests opened before the hunt are left out; a weekly treasure (gold outfit, vehicle,
    pickaxe, jam track, loading screen) only comes from the chests of its week, so its chance is the current week's
    (the whole hunt is given as "season"); the Pirate Shop Access and gizmos count every chest of the hunt. Chests
    sent without their own time (older clients) count from the start of their match, without Treasure Hour boost.
    """
    c = current()
    if not c or not c.get("weeks"):
        return None
    now = now or datetime.now(timezone.utc)
    weeks = [(_dt(w["start"]), _dt(w["end"]), w) for w in c["weeks"]]
    hunt_start = min(s for s, _, _ in weeks)
    week = next(((s, e, w) for s, e, w in weeks if s <= now < e), None)
    times, plain = chest_times_of(reports)
    times = [c for c in times if c[0] >= hunt_start]
    week_times = [c for c in times if week and week[0] <= c[0] < week[1]]
    chests = len(times) + plain
    hours = _hours(c)
    out = []
    for o in c["odds"]:
        weekly = bool(o.get("weekly", False))
        use_times, use_plain = (week_times, 0) if weekly else (times, plain)
        n = len(use_times) + use_plain
        p = at_least_once(o["oneIn"], use_times, use_plain, o["kind"], hours)
        half = chests_for(o["oneIn"], 0.5)
        out.append({
            "kind": o["kind"], "name": KIND_NAMES.get(o["kind"], o["kind"]), "oneIn": o["oneIn"], "weekly": weekly,
            "chance": p, "never": 1 - p, "chests": n, "average": _average(o["oneIn"], use_times, use_plain, o["kind"], hours),
            "half": half, "left": max(0, half - n), "big": o["kind"] in BIG_KINDS,
            # For a weekly treasure: any week's item, over the whole hunt.
            "season": at_least_once(o["oneIn"], times, 0, o["kind"], hours) if weekly else None,
        })
    boosted = sum(1 for c in times if _boost_of(c, "outfit", hours) > 1)
    return {
        "chests": chests, "weekChests": len(week_times), "boostedChests": boosted,
        "week": {"number": week[2]["number"], "title": week[2].get("title", ""), "end": week[2]["end"]} if week else None,
        "odds": out,
    }


def local_name(url: str) -> str:
    """Name of the copy in assets/treasures, as the counter names it: "w2-loading.webp?v=3" -> "w2-loading-v3.webp"."""
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    name = parsed.path.rsplit("/", 1)[-1]
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    query = "".join(ch for ch in parsed.query if ch.isascii() and ch.isalnum())
    return f"{stem}-{query}{dot}{ext}" if query else name


def catalog() -> dict:
    """What the collection page shows: weeks and prizes (images served by this server when the repo has them)."""
    c = current()
    local = treasures_dir()

    def prize(p: dict) -> dict:
        file = local_name(p.get("image") or "")
        image = f"/treasures/{file}" if file and (local / file).exists() else p.get("image")
        return {"id": p["id"], "kind": p["kind"], "kindName": KIND_NAMES.get(p["kind"], p["kind"]), "name": p["name"], "image": image, "prizeIds": p.get("prizeIds", [])}

    now = datetime.now(timezone.utc)
    weeks = [{
        "number": w["number"], "title": w.get("title", ""), "start": w["start"], "end": w["end"],
        "current": _dt(w["start"]) <= now < _dt(w["end"]), "prizes": [prize(p) for p in w.get("prizes", [])],
    } for w in c.get("weeks", [])]
    hours = [{"start": h["start"], "end": h["end"], "boosts": h.get("boosts", {}), "confirmed": h.get("confirmed", True)} for h in c.get("treasureHours", [])]
    return {
        "revision": c.get("revision"), "pirateShop": prize(c["pirateShop"]) if c.get("pirateShop") else None,
        "weeks": weeks, "treasureHours": hours, "kindNames": KIND_NAMES,
    }


def prize_for(prize_id: str | None) -> dict | None:
    if not prize_id:
        return None
    c = current()
    every = [c.get("pirateShop")] + [p for w in c.get("weeks", []) for p in w.get("prizes", [])]
    for p in every:
        if p and any(i.lower() == prize_id.lower() for i in p.get("prizeIds", [])):
            return p
    return None
