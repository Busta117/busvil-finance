#!/usr/bin/env python3
"""Añade/actualiza el campo `alias` en las transacciones de data/*.json.

Regla de preservación: si una transacción tiene `alias_manual: true`, su alias
NO se toca. El resto se regenera desde merchant_aliases.json + fallback.

Uso:
    python3 enrich_aliases.py              # todos los datasets
    python3 enrich_aliases.py file.json    # solo uno
"""

import json
import shutil
import sys
from pathlib import Path
from collections import Counter

from alias_resolver import compute_alias, load_aliases

SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = SCRIPT_DIR / "data"


def enrich_file(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    rules = load_aliases()
    before = sum(1 for t in data["transactions"] if t.get("alias"))
    manual = sum(1 for t in data["transactions"] if t.get("alias_manual"))
    changed = 0
    for t in data["transactions"]:
        # Normaliza flag manual para todos
        if "alias_manual" not in t:
            t["alias_manual"] = False
        if t.get("alias_manual"):
            continue
        new_alias = compute_alias(t, rules)
        if t.get("alias") != new_alias:
            t["alias"] = new_alias
            changed += 1

    shutil.copy2(path, str(path) + ".bak")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Estadística rápida de los alias más comunes
    counts = Counter(t.get("alias", "") for t in data["transactions"])
    top = counts.most_common(10)
    print(f"\n{path.name}", file=sys.stderr)
    print(f"  tx totales: {len(data['transactions'])}", file=sys.stderr)
    print(f"  con alias antes: {before}", file=sys.stderr)
    print(f"  alias manuales protegidos: {manual}", file=sys.stderr)
    print(f"  alias modificados ahora: {changed}", file=sys.stderr)
    print(f"  top 10 alias resultantes:", file=sys.stderr)
    for alias, n in top:
        print(f"    [{n:>3}] {alias}", file=sys.stderr)


def main():
    if len(sys.argv) > 1:
        paths = [Path(p) for p in sys.argv[1:]]
    else:
        paths = sorted(p for p in DATA_DIR.glob("*.json") if not p.name.endswith(".bak"))
    if not paths:
        print("No hay JSONs que enriquecer", file=sys.stderr)
        sys.exit(1)
    for p in paths:
        enrich_file(p)


if __name__ == "__main__":
    main()
