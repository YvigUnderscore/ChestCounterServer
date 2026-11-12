"""The group's keys, kept in DATA_DIR/keys.json so they can be changed without touching docker-compose.yml.

- group: what the ChestCounter clients use to send their matches (header X-Group-Key).
- view:  optional, to read the site (link ?k=...). Empty = whoever has the address can read.

On the first start, the file is created from the GROUP_KEY / VIEW_KEY environment variables, or with a random group
key when GROUP_KEY is empty. After that, the file is what counts: change the keys with
    docker compose exec chests python -m app.admin rotate group
"""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

_cache: tuple[str, float, dict] | None = None


def _path() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "keys.json"


def new_key() -> str:
    return secrets.token_urlsafe(24)


def ensure() -> tuple[dict, bool]:
    """Creates the file on the first start. Returns the keys and whether a group key was generated."""
    path = _path()
    if path.exists():
        return load(), False
    group = os.environ.get("GROUP_KEY", "").strip()
    generated = not group
    keys = {"group": group or new_key(), "view": os.environ.get("VIEW_KEY", "").strip()}
    save(keys)
    return keys, generated


def save(keys: dict) -> None:
    global _cache
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(keys, indent=2), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
    _cache = None


def load() -> dict:
    """The current keys (re-read when the file changed: a rotation applies at once, without a restart)."""
    global _cache
    path = _path()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {"group": "", "view": ""}
    if _cache is None or _cache[0] != str(path) or _cache[1] != mtime:
        data = json.loads(path.read_text(encoding="utf-8"))
        _cache = (str(path), mtime, {"group": str(data.get("group", "")), "view": str(data.get("view", ""))})
    return _cache[2]
