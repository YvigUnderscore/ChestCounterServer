"""Administration of the group server, run inside the container:

    docker compose exec chests python -m app.admin show            # print the keys
    docker compose exec chests python -m app.admin rotate group    # new key to send matches (give it to the friends)
    docker compose exec chests python -m app.admin rotate view     # new key to read the site (new link to share)
    docker compose exec chests python -m app.admin clear view      # site readable by whoever has the address
    docker compose exec chests python -m app.admin set group <key> # choose the key yourself

A change applies at once, without a restart.
"""

from __future__ import annotations

import os
import sys

from . import keys


def _show(k: dict) -> None:
    public = os.environ.get("PUBLIC_URL", "").rstrip("/") or "http://<adresse-du-serveur>:8080"
    print(f"Clé du groupe (à mettre dans ChestCounter) : {k['group']}")
    if k["view"]:
        print(f"Clé de lecture du site                    : {k['view']}")
        print(f"Lien à partager                           : {public}/?k={k['view']}")
    else:
        print(f"Clé de lecture du site                    : (aucune : le site est lisible par qui a l'adresse)")
        print(f"Lien à partager                           : {public}/")


def main(argv: list[str]) -> int:
    k, _ = keys.ensure()
    if not argv or argv[0] == "show":
        _show(k)
        return 0
    if len(argv) >= 2 and argv[0] in ("rotate", "set", "clear") and argv[1] in ("group", "view"):
        action, which = argv[0], argv[1]
        if action == "clear" and which == "group":
            print("La clé du groupe ne peut pas être vide.", file=sys.stderr)
            return 2
        if action == "set":
            if len(argv) < 3 or len(argv[2].strip()) < 12:
                print("Donne une clé d'au moins 12 caractères.", file=sys.stderr)
                return 2
            value = argv[2].strip()
        else:
            value = keys.new_key() if action == "rotate" else ""
        k = {**k, which: value}
        keys.save(k)
        print("Clé changée.\n")
        _show(k)
        if which == "group":
            print("\nChaque ami doit mettre la nouvelle clé dans ChestCounter (Réglages → Serveur de groupe).")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
