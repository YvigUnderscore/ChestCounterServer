"""Scenarios of the group sync: several friends send the same match, each with only their own chests."""

import importlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

KEY = "group-secret"
NOW = datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GROUP_KEY", KEY)
    monkeypatch.setenv("VIEW_KEY", "")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PUBLIC_URL", "https://chests.example")
    import app.main as main
    importlib.reload(main)
    with TestClient(main.app) as c:
        yield c


def match(session, epic, name, chests, team=3, squad=(), version=17, start=NOW, placement=4, **extra):
    return {
        "sessionId": session, "epicId": epic, "name": name, "startUtc": start.isoformat(), "playlist": "Playlist_DefaultSquad",
        "placement": placement, "totalPlayers": 100, "teamIndex": team, "chests": chests, "destroyed": 0,
        "chestKinds": {"Coffre": chests}, "treasures": [], "squad": [{"epicId": e, "isBot": b} for e, b in squad],
        "analyzerVersion": version, **extra,
    }


def send(client, *matches, key=KEY):
    return client.post("/api/matches", json={"client": "test", "matches": list(matches)}, headers={"X-Group-Key": key})


def teams(client, session):
    return client.get(f"/api/games/{session}").json()["teams"]


def test_squad_adds_each_players_own_chests(client):
    # Squad: A, B, C (group) + R (random teammate without the app).
    a = match("S1", "A", "Alice", 7, squad=[("B", False), ("C", False), ("R", False)])
    b = match("S1", "B", "Bob", 4, squad=[("A", False), ("C", False), ("R", False)])
    assert send(client, a).status_code == 200

    [t] = teams(client, "S1")
    assert (t["teamChests"], t["reported"], t["humans"], t["complete"]) == (7, 1, 4, False)

    send(client, b)
    send(client, match("S1", "C", "Cleo", 2, squad=[("A", False), ("B", False), ("R", False)]))
    [t] = teams(client, "S1")
    assert t["teamChests"] == 13
    assert (t["reported"], t["humans"], t["complete"], t["consistent"]) == (3, 4, False, True)
    names = [m["name"] for m in t["members"]]
    assert names[:3] == ["Alice", "Bob", "Cleo"]
    # The random teammate is never named (no data about strangers), and their chests are unknown, not guessed.
    assert t["members"][3] == {"epicId": None, "name": "Coéquipier hors groupe", "chests": None, "destroyed": None, "eliminations": None, "treasures": None}


def test_complete_duo(client):
    send(client, match("S2", "A", "Alice", 5, squad=[("B", False)]), match("S2", "B", "Bob", 6, squad=[("A", False)]))
    [t] = teams(client, "S2")
    assert (t["teamChests"], t["complete"], t["consistent"]) == (11, True, True)


def test_sending_again_never_counts_twice(client):
    m = match("S3", "A", "Alice", 9)
    for _ in range(3):
        assert send(client, m).json()["accepted"] == ["S3"]
    totals = client.get("/api/overview").json()["totals"]
    assert (totals["chests"], totals["matches"], totals["players"], totals["today"]) == (9, 1, 1, 9)


def test_newer_analysis_replaces_older_one_but_not_the_reverse(client):
    send(client, match("S4", "A", "Alice", 5, version=16))
    send(client, match("S4", "A", "Alice", 6, version=17))
    send(client, match("S4", "A", "Alice", 1, version=15))
    [t] = teams(client, "S4")
    assert t["teamChests"] == 6


def test_friends_in_other_teams_of_the_same_match_stay_apart(client):
    send(client, match("S5", "A", "Alice", 5, team=3, squad=[("X", False)]), match("S5", "B", "Bob", 8, team=9, squad=[("Y", False)]))
    ts = sorted(teams(client, "S5"), key=lambda t: t["teamChests"])
    assert [t["teamChests"] for t in ts] == [5, 8]
    assert all(t["reported"] == 1 for t in ts)


def test_reports_that_disagree_are_flagged(client):
    # Same team index but different placement: one of the reports is wrong, the team is flagged.
    send(client, match("S6", "A", "Alice", 5, squad=[("B", False)], placement=2), match("S6", "B", "Bob", 3, squad=[("A", False)], placement=7))
    [t] = teams(client, "S6")
    assert not t["consistent"]
    assert "classements différents" in t["issues"]


def test_roster_missing_a_reporter_is_flagged(client):
    send(client, match("S7", "A", "Alice", 5, squad=[("B", False)]), match("S7", "B", "Bob", 3, squad=[("Z", False)]))
    [t] = teams(client, "S7")
    assert not t["consistent"]
    assert any("Bob ne liste pas Alice" in i for i in t["issues"])


def test_bots_are_not_waited_for(client):
    send(client, match("S8", "A", "Alice", 4, squad=[("BOT1", True)]))
    [t] = teams(client, "S8")
    assert (t["humans"], t["bots"], t["complete"]) == (1, 1, True)


def test_old_reports_without_roster_or_team_are_solo(client):
    send(client, match("S9", "A", "Alice", 4, team=None), match("S9", "B", "Bob", 2, team=None))
    ts = teams(client, "S9")
    assert len(ts) == 2 and all(t["consistent"] for t in ts)


def test_summary_for_the_client_overlay(client):
    yesterday = NOW - timedelta(days=2)
    send(client,
         match("OLD", "A", "Alice", 30, start=yesterday, squad=[("B", False)]),
         match("NEW", "A", "Alice", 5, start=NOW, squad=[("B", False)]))
    send(client, match("NEW", "B", "Bob", 6, start=NOW, squad=[("A", False)]))
    s = client.get("/api/players/A/summary").json()
    assert s["lastGame"]["sessionId"] == "NEW"
    assert s["lastGame"]["teamChests"] == 11 and s["lastGame"]["complete"]
    assert {m["name"]: m["me"] for m in s["lastGame"]["members"]} == {"Alice": True, "Bob": False}
    assert s["todayTeamChests"] == 11 and s["todayGames"] == 1
    assert s["groupTotal"] == 41
    assert s["dashboardUrl"] == "https://chests.example/p/A"
    assert client.get("/api/players/NOBODY/summary").status_code == 404


def test_player_page_data(client):
    send(client, match("S10", "A", "Alice", 5, treasures=[{"prizeId": "DelilahPrize:dpid_item4", "name": "Tenue en or", "atSeconds": 300.5}]))
    d = client.get("/api/players/A").json()
    assert d["player"]["chests"] == 5 and d["player"]["treasures"] == 1
    # The name comes from content.json when the prize id is known there.
    assert (d["treasures"][0]["name"], d["treasures"][0]["catalogId"]) == ("Plunder in Paradise", "w1-loading")
    assert d["chestKinds"] == {"Coffre": 5}


def test_ping_checks_the_key(client):
    assert client.get("/api/ping", headers={"X-Group-Key": KEY}).json()["ok"] is True
    assert client.get("/api/ping", headers={"X-Group-Key": "nope"}).status_code == 401


def test_wrong_key_is_refused(client):
    assert send(client, match("S11", "A", "Alice", 5), key="nope").status_code == 401
    assert send(client, match("S11", "A", "Alice", 5), key="").status_code == 401


def test_invalid_payload_is_refused(client):
    assert send(client, match("S12", "A", "Alice", -3)).status_code == 422
    assert send(client, match("S12", "A", "Alice", 10_000)).status_code == 422


def test_chances_use_the_time_of_each_chest(client):
    # 10 chests during a Treasure Hour of content.json (outfit x7.5), 10 others at normal odds, 5 without times.
    hour = datetime(2026, 11, 7, 19, 30, tzinfo=timezone.utc)
    send(client,
         match("TH", "A", "Alice", 10, start=hour, chestSeconds=list(range(10))),
         match("NORMAL", "A", "Alice", 10, start=hour + timedelta(days=3), chestSeconds=list(range(10))),
         match("OLD", "A", "Alice", 5, start=hour + timedelta(days=4)))
    ch = client.get("/api/players/A").json()["chances"]
    assert ch["chests"] == 25 and ch["boostedChests"] == 10
    outfit = next(o for o in ch["odds"] if o["kind"] == "outfit")
    p = 1 / outfit["oneIn"]
    expected = 1 - (1 - p * 7.5) ** 10 * (1 - p) ** 15
    assert abs(outfit["chance"] - expected) < 1e-12
    assert outfit["big"] and outfit["half"] > 1_000_000
    group = client.get("/api/overview").json()["chances"]
    assert group["chests"] == 25


def test_collection_auto_and_manual(client):
    send(client, match("C1", "A", "Alice", 3, treasures=[{"prizeId": "DelilahPrize:dpid_item3", "name": "?"}]))
    d = client.get("/api/players/A").json()
    assert d["collection"]["auto"] == ["w1-jam"]
    assert d["treasures"][0]["name"] == "No Trespassing"
    ok = client.post("/api/players/A/obtained", json={"prizeId": "w2-car", "on": True})
    assert ok.status_code == 200
    assert client.get("/api/players/A").json()["collection"]["ticked"] == ["w2-car"]
    client.post("/api/players/A/obtained", json={"prizeId": "w2-car", "on": False})
    assert client.get("/api/players/A").json()["collection"]["ticked"] == []
    assert client.post("/api/players/A/obtained", json={"prizeId": "nope", "on": True}).status_code == 400
    assert client.post("/api/players/NOBODY/obtained", json={"prizeId": "w2-car", "on": True}).status_code == 404


def test_content_and_images(client):
    c = client.get("/api/content").json()
    assert c["weeks"][0]["prizes"][0]["image"].startswith("/treasures/")
    assert client.get(c["weeks"][0]["prizes"][0]["image"]).status_code == 200
    assert client.get("/treasures/..%2Fcontent.json").status_code == 404
    # A versioned picture ("?v=3") is served from its local copy too, never from another site.
    assert all(p["image"].startswith("/treasures/") for w in c["weeks"] for p in w["prizes"])
    for page in ("/", "/parties", "/aide", "/chances", "/p/A", "/p/A/collection", "/g/X"):
        r = client.get(page)
        assert r.status_code == 200 and "app.js" in r.text, page


def test_group_key_is_generated_and_can_be_rotated(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GROUP_KEY", "")
    monkeypatch.setenv("VIEW_KEY", "")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.main as main
    from app import admin, keys
    importlib.reload(main)
    with TestClient(main.app) as c:
        first = keys.load()["group"]
        assert len(first) >= 24
        assert send(c, match("K", "A", "Alice", 1), key=first).status_code == 200
        assert admin.main(["rotate", "group"]) == 0
        second = keys.load()["group"]
        assert second != first
        # Applies at once, without a restart.
        assert send(c, match("K", "A", "Alice", 1), key=first).status_code == 401
        assert send(c, match("K", "A", "Alice", 1), key=second).status_code == 200
        assert admin.main(["rotate", "view"]) == 0
        view = keys.load()["view"]
        assert c.get("/api/overview").status_code == 401
        assert c.get(f"/api/overview?k={view}").status_code == 200
        assert admin.main(["clear", "group"]) == 2
        assert admin.main(["set", "group", "short"]) == 2
    assert second in capsys.readouterr().out


def test_view_key(tmp_path, monkeypatch):
    monkeypatch.setenv("GROUP_KEY", KEY)
    monkeypatch.setenv("VIEW_KEY", "look")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.main as main
    importlib.reload(main)
    with TestClient(main.app) as c:
        assert c.get("/api/overview").status_code == 401
        assert c.get("/api/overview?k=look").status_code == 200
        # The key of the link is kept in a cookie: the next pages work without it.
        assert c.get("/api/overview").status_code == 200
        assert c.get("/").headers["x-robots-tag"] == "noindex, nofollow"


def test_groups_are_matches_shared_by_server_players(client):
    # A and B both use the server. R is a random teammate, X another random.
    send(client,
         match("SOLO", "A", "Alice", 5, team=1),
         match("RANDOMS", "A", "Alice", 7, team=2, squad=[("R", False), ("X", False)]),
         match("DUO", "A", "Alice", 4, team=3, squad=[("B", False), ("R", False)]),
         match("DUO", "B", "Bob", 6, team=3, squad=[("A", False), ("R", False)]),
         match("BONLY", "B", "Bob", 3, team=4))
    # Played together, but only A sent it: still a group match (B is a player of the server).
    send(client, match("HALF", "A", "Alice", 2, team=5, squad=[("B", False)]))
    g = client.get("/api/groups").json()
    assert g["totals"]["games"] == 2 and g["totals"]["chests"] == 12
    assert [x["lineup"] for x in g["lineups"]] == [["A", "B"]]
    assert g["lineups"][0]["games"] == 2 and g["lineups"][0]["chests"] == 12
    players = {p["epicId"]: p for p in g["players"]}
    assert (players["A"]["games"], players["A"]["chests"]) == (2, 6)
    assert (players["B"]["games"], players["B"]["chests"], players["B"]["sent"]) == (2, 6, 1)
    assert {t["sessionId"] for t in g["games"]} == {"DUO", "HALF"}

    o = client.get("/api/overview").json()["totals"]
    assert (o["chests"], o["groupGames"], o["groupChests"]) == (27, 2, 12)

    a = client.get("/api/players/A").json()
    assert a["split"] == {"groupGames": 2, "groupChests": 6, "groupTeamChests": 12, "otherGames": 2, "otherChests": 12}
    assert a["lineups"][0]["lineup"] == ["A", "B"]


def test_every_match_is_kept_and_paginated(client):
    base = NOW - timedelta(days=200)
    send(client, *[match(f"M{i:03}", "A", "Alice", 1, start=base + timedelta(hours=i)) for i in range(100)])
    send(client, *[match(f"M{i:03}", "A", "Alice", 1, start=base + timedelta(hours=i)) for i in range(100, 130)])
    page = client.get("/api/games?offset=120&limit=20").json()
    assert page["total"] == 130 and len(page["games"]) == 10
    assert page["games"][-1]["sessionId"] == "M000"  # the oldest one is still there
    assert client.get("/api/games?scope=group").json()["total"] == 0
    assert client.get("/api/games?player=NOBODY").json()["total"] == 0
    assert client.get("/api/players/A").json()["player"]["matches"] == 130
    assert client.get("/groupes").status_code == 200
