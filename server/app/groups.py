"""Putting the reports of one team in one match together.

A match is identified by its GameSessionId, which is the same in the replay of every player of that match. Inside a
match, two reports belong to the same team when:
  - both give the same team index (read by each client from its own replay), or
  - one of them lists the other among its teammates (Epic ids read from the replay).

Each report only holds the chests its own player opened, so the team total is a plain sum: no chest can be counted
twice, and a missing teammate lowers the total instead of being guessed. The checks below flag a team whose reports
do not tell the same story (different team index, roster or placement), which would mean a bad merge.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Iterable



class _UnionFind:
    def __init__(self, items: Iterable[str]):
        self.parent = {i: i for i in items}

    def find(self, x: str) -> str:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def _get(row, key):
    return row[key] if not isinstance(row, dict) else row.get(key)


def build_teams(reports, names: dict[str, str]) -> list[dict]:
    by_session: dict[str, list] = {}
    for r in reports:
        by_session.setdefault(_get(r, "session_id"), []).append(r)

    teams = []
    for session_id, rows in by_session.items():
        by_player = {_get(r, "epic_id"): r for r in rows}
        squads = {pid: json.loads(_get(r, "squad") or "[]") for pid, r in by_player.items()}
        uf = _UnionFind(by_player)
        ids = list(by_player)
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                ta, tb = _get(by_player[a], "team_index"), _get(by_player[b], "team_index")
                same_index = ta is not None and ta == tb
                listed = any(m["epicId"] == b for m in squads[a]) or any(m["epicId"] == a for m in squads[b])
                if same_index or listed:
                    uf.union(a, b)

        components: dict[str, list[str]] = {}
        for pid in ids:
            components.setdefault(uf.find(pid), []).append(pid)
        for members in components.values():
            teams.append(_team(session_id, [by_player[p] for p in members], squads, names))
    return teams


def _team(session_id: str, rows: list, squads: dict[str, list], names: dict[str, str]) -> dict:
    reporters = [_get(r, "epic_id") for r in rows]
    humans = set(reporters)
    bots = set()
    for pid in reporters:
        for m in squads[pid]:
            (bots if m.get("isBot") else humans).add(m["epicId"])

    issues = []
    indexes = {_get(r, "team_index") for r in rows if _get(r, "team_index") is not None}
    if len(indexes) > 1:
        issues.append({"code": "teamIndex"})
    for pid in reporters:
        listed = {m["epicId"] for m in squads[pid]}
        missing = [o for o in reporters if o != pid and o not in listed]
        # An empty roster says nothing (match analyzed by an older version, or replay without the team): not an issue.
        if missing and listed:
            issues.append({"code": "roster", "player": names.get(pid) or pid, "missing": [names.get(o) or o for o in missing]})
    placements = {_get(r, "placement") for r in rows if _get(r, "placement") is not None}
    if len(placements) > 1:
        issues.append({"code": "placement"})
    playlists = {_get(r, "playlist") for r in rows if _get(r, "playlist")}
    if len(playlists) > 1:
        issues.append({"code": "playlist"})
    starts = [datetime.fromisoformat(s) for s in (_get(r, "start_utc") for r in rows) if s]
    if starts and (max(starts) - min(starts)).total_seconds() > 600:
        issues.append({"code": "start"})

    members = sorted(
        ({"epicId": _get(r, "epic_id"), "name": names.get(_get(r, "epic_id")) or "?", "chests": _get(r, "chests"),
          "destroyed": _get(r, "destroyed"), "eliminations": _get(r, "eliminations"),
          "treasures": len(json.loads(_get(r, "treasures") or "[]"))} for r in rows),
        key=lambda m: -m["chests"],
    )
    # Teammates who sent nothing for this match: named only when they belong to the group (they have a client).
    for pid in sorted(humans - set(reporters)):
        known = names.get(pid)
        members.append({"epicId": pid if known else None, "name": known, "outside": not known, "chests": None,
                        "destroyed": None, "eliminations": None, "treasures": None})

    # A "group" match: at least two players of this server played it in the same team (whether or not they all
    # sent it). The lineup is who of the server was there.
    lineup = sorted({pid for pid in humans if pid in names} | set(reporters))
    first = min(rows, key=lambda r: _get(r, "start_utc") or "")
    return {
        "sessionId": session_id,
        "startUtc": min((s.isoformat() for s in starts), default=None),
        "playlist": _get(first, "playlist"),
        "placement": next(iter(placements)) if len(placements) == 1 else None,
        "totalPlayers": _get(first, "total_players"),
        "durationSeconds": max((_get(r, "duration_s") or 0) for r in rows) or None,
        "teamChests": sum(_get(r, "chests") for r in rows),
        "reporters": reporters,
        "reported": len(reporters),
        "humans": len(humans),
        "bots": len(bots),
        "complete": humans <= set(reporters),
        "consistent": not issues,
        "issues": issues,
        "members": members,
        "lineup": lineup,
        "isGroup": len(lineup) >= 2,
    }


def group_stats(teams: list[dict], names: dict[str, str]) -> dict:
    """What the "Groupes" tab shows: only the matches shared by at least two players of the server."""
    shared = [t for t in teams if t["isGroup"]]
    lineups: dict[tuple, dict] = {}
    players: dict[str, dict] = {}
    for t in shared:
        key = tuple(t["lineup"])
        g = lineups.setdefault(key, {"lineup": list(key), "names": [names.get(p) or "?" for p in key],
                                     "games": 0, "chests": 0, "best": 0, "complete": 0, "wins": 0, "lastUtc": None})
        g["games"] += 1
        g["chests"] += t["teamChests"]
        g["best"] = max(g["best"], t["teamChests"])
        g["complete"] += 1 if t["complete"] else 0
        g["wins"] += 1 if t["placement"] == 1 else 0
        g["lastUtc"] = max(filter(None, [g["lastUtc"], t["startUtc"]]), default=None)
        for m in t["members"]:
            if m["epicId"] in t["lineup"]:
                p = players.setdefault(m["epicId"], {"epicId": m["epicId"], "name": m["name"], "games": 0, "chests": 0, "sent": 0})
                p["games"] += 1
                if m["chests"] is not None:
                    p["chests"] += m["chests"]
                    p["sent"] += 1
    for g in lineups.values():
        g["average"] = round(g["chests"] / g["games"], 1)
    for p in players.values():
        p["average"] = round(p["chests"] / p["sent"], 1) if p["sent"] else 0
    best = max(shared, key=lambda t: t["teamChests"], default=None)
    return {
        "totals": {
            "games": len(shared),
            "chests": sum(t["teamChests"] for t in shared),
            "average": round(sum(t["teamChests"] for t in shared) / len(shared), 1) if shared else 0,
            "complete": sum(1 for t in shared if t["complete"]),
            "wins": sum(1 for t in shared if t["placement"] == 1),
            "best": best["teamChests"] if best else 0,
            "bestSessionId": best["sessionId"] if best else None,
        },
        "lineups": sorted(lineups.values(), key=lambda g: (-g["games"], -g["chests"])),
        "players": sorted(players.values(), key=lambda p: (-p["chests"], -p["games"])),
    }
