"""SQLite storage: one row per player per match (what that player's client sent)."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

_path: Path | None = None
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    epic_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    session_id       TEXT NOT NULL,
    epic_id          TEXT NOT NULL REFERENCES players(epic_id),
    start_utc        TEXT,
    duration_s       INTEGER,
    playlist         TEXT,
    map              TEXT,
    placement        INTEGER,
    total_players    INTEGER,
    eliminations     INTEGER,
    team_index       INTEGER,
    chests           INTEGER NOT NULL,
    destroyed        INTEGER NOT NULL DEFAULT 0,
    chest_kinds      TEXT NOT NULL DEFAULT '{}',
    treasures        TEXT NOT NULL DEFAULT '[]',
    squad            TEXT NOT NULL DEFAULT '[]',
    analyzer_version INTEGER NOT NULL DEFAULT 0,
    received_at      TEXT NOT NULL,
    PRIMARY KEY (session_id, epic_id)
);
CREATE TABLE IF NOT EXISTS obtained (
    epic_id   TEXT NOT NULL,
    prize_id  TEXT NOT NULL,
    PRIMARY KEY (epic_id, prize_id)
);
CREATE INDEX IF NOT EXISTS reports_by_player ON reports(epic_id, start_utc);
CREATE INDEX IF NOT EXISTS reports_by_start ON reports(start_utc);
"""


def init(path: Path) -> None:
    global _path
    _path = path
    with tx() as c:
        c.executescript(SCHEMA)
        # Columns added after the first version: added to an existing database.
        columns = {r["name"] for r in c.execute("PRAGMA table_info(reports)")}
        if "chest_seconds" not in columns:
            c.execute("ALTER TABLE reports ADD COLUMN chest_seconds TEXT NOT NULL DEFAULT '[]'")


@contextmanager
def tx():
    """One connection per request, writes serialized (SQLite allows one writer)."""
    assert _path is not None, "db.init() not called"
    with _lock:
        c = sqlite3.connect(_path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _iso(value) -> str | None:
    if value is None:
        return None
    d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat(timespec="seconds")


def upsert_report(c: sqlite3.Connection, m: dict) -> bool:
    """Stores a match report. A report already stored from a newer analysis is kept. Returns True when written."""
    now = _now()
    c.execute(
        "INSERT INTO players(epic_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(epic_id) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE players.name END, last_seen = excluded.last_seen",
        (m["epicId"], m.get("name") or "", now, now),
    )
    existing = c.execute(
        "SELECT analyzer_version FROM reports WHERE session_id = ? AND epic_id = ?", (m["sessionId"], m["epicId"])
    ).fetchone()
    if existing is not None and existing["analyzer_version"] > m.get("analyzerVersion", 0):
        return False
    squad = [s for s in m.get("squad", []) if s["epicId"] != m["epicId"]]
    c.execute(
        "INSERT OR REPLACE INTO reports(session_id, epic_id, start_utc, duration_s, playlist, map, placement, total_players, eliminations,"
        " team_index, chests, destroyed, chest_kinds, treasures, squad, analyzer_version, received_at, chest_seconds)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            m["sessionId"], m["epicId"], _iso(m.get("startUtc")), m.get("durationSeconds"), m.get("playlist"), m.get("map"),
            m.get("placement"), m.get("totalPlayers"), m.get("eliminations"), m.get("teamIndex"),
            m["chests"], m.get("destroyed", 0), json.dumps(m.get("chestKinds", {})), json.dumps(m.get("treasures", [])),
            json.dumps(squad), m.get("analyzerVersion", 0), now, json.dumps(m.get("chestSeconds") or []),
        ),
    )
    return True


def player_exists(c, epic_id: str) -> bool:
    return c.execute("SELECT 1 FROM players WHERE epic_id = ?", (epic_id,)).fetchone() is not None


def player_names(c) -> dict[str, str]:
    return {r["epic_id"]: r["name"] for r in c.execute("SELECT epic_id, name FROM players")}


def reports_of_sessions(c, session_ids: list[str]) -> list[sqlite3.Row]:
    if not session_ids:
        return []
    rows = []
    for i in range(0, len(session_ids), 500):
        chunk = session_ids[i:i + 500]
        rows += c.execute(f"SELECT * FROM reports WHERE session_id IN ({','.join('?' * len(chunk))})", chunk).fetchall()
    return rows


def reports_of_player(c, epic_id: str) -> list[sqlite3.Row]:
    return c.execute("SELECT * FROM reports WHERE epic_id = ? ORDER BY start_utc DESC", (epic_id,)).fetchall()


def last_session_of(c, epic_id: str) -> str | None:
    r = c.execute("SELECT session_id FROM reports WHERE epic_id = ? ORDER BY start_utc DESC LIMIT 1", (epic_id,)).fetchone()
    return r["session_id"] if r else None


def sessions_of(c, epic_id: str, limit: int) -> list[str]:
    return [r["session_id"] for r in c.execute(
        "SELECT session_id FROM reports WHERE epic_id = ? ORDER BY start_utc DESC LIMIT ?", (epic_id, limit))]


def sessions_of_since(c, epic_id: str, since: datetime) -> list[str]:
    return [r["session_id"] for r in c.execute(
        "SELECT session_id FROM reports WHERE epic_id = ? AND start_utc >= ?", (epic_id, _iso(since)))]


def recent_sessions(c, limit: int) -> list[str]:
    return [r["session_id"] for r in c.execute(
        "SELECT session_id, MAX(start_utc) AS s FROM reports GROUP BY session_id ORDER BY s DESC LIMIT ?", (limit,))]


def session_count(c) -> int:
    return c.execute("SELECT COUNT(DISTINCT session_id) FROM reports").fetchone()[0]


def group_total(c) -> int:
    return c.execute("SELECT COALESCE(SUM(chests), 0) FROM reports").fetchone()[0]


def player_stats(c) -> list[dict]:
    rows = c.execute(
        """SELECT p.epic_id, p.name, p.last_seen,
                  COUNT(r.session_id) AS matches, COALESCE(SUM(r.chests), 0) AS chests,
                  COALESCE(MAX(r.chests), 0) AS best, COALESCE(SUM(r.destroyed), 0) AS destroyed,
                  COALESCE(SUM(r.eliminations), 0) AS eliminations,
                  SUM(CASE WHEN r.placement = 1 THEN 1 ELSE 0 END) AS wins,
                  COALESCE(SUM(json_array_length(r.treasures)), 0) AS treasures,
                  MAX(r.start_utc) AS last_match
           FROM players p LEFT JOIN reports r ON r.epic_id = p.epic_id
           GROUP BY p.epic_id ORDER BY chests DESC"""
    ).fetchall()
    return [
        {
            "epicId": r["epic_id"], "name": r["name"] or "?", "matches": r["matches"], "chests": r["chests"],
            "average": round(r["chests"] / r["matches"], 1) if r["matches"] else 0, "best": r["best"],
            "destroyed": r["destroyed"], "eliminations": r["eliminations"], "wins": r["wins"] or 0,
            "treasures": r["treasures"], "lastMatch": r["last_match"],
        }
        for r in rows
    ]


def chests_per_day(c, since: datetime, tz: ZoneInfo) -> list[dict]:
    """Chests per local day and per player since a date."""
    out: dict[tuple[str, str], int] = {}
    for r in c.execute("SELECT epic_id, start_utc, chests FROM reports WHERE start_utc >= ?", (_iso(since),)):
        day = datetime.fromisoformat(r["start_utc"]).astimezone(tz).date().isoformat()
        out[(day, r["epic_id"])] = out.get((day, r["epic_id"]), 0) + r["chests"]
    return [{"day": d, "epicId": e, "chests": n} for (d, e), n in sorted(out.items())]


def all_reports(c) -> list[sqlite3.Row]:
    return c.execute("SELECT * FROM reports").fetchall()


def obtained_of(c, epic_id: str) -> list[str]:
    return [r["prize_id"] for r in c.execute("SELECT prize_id FROM obtained WHERE epic_id = ?", (epic_id,))]


def set_obtained(c, epic_id: str, prize_id: str, on: bool) -> None:
    if on:
        c.execute("INSERT OR IGNORE INTO obtained(epic_id, prize_id) VALUES (?, ?)", (epic_id, prize_id))
    else:
        c.execute("DELETE FROM obtained WHERE epic_id = ? AND prize_id = ?", (epic_id, prize_id))


def chests_since(c, since: datetime) -> int:
    return c.execute("SELECT COALESCE(SUM(chests), 0) FROM reports WHERE start_utc >= ?", (_iso(since),)).fetchone()[0]
