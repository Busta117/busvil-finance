#!/usr/bin/env python3
"""Genera/actualiza user_rules.json a partir de categorizaciones manuales.

Lee todos los JSONs de data/, agrupa por merchant, y para cada merchant que
se ha categorizado consistentemente con el mismo (cat, sub) genera una regla
exacta. Merchants con categorizaciones contradictorias entre JSONs se omiten
y se reportan.

Uso:
    python3 learn_rules.py          # merge de todos los JSONs de data/
    python3 learn_rules.py file.json [file2.json ...]  # solo estos
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = SCRIPT_DIR / "data"
OUT_PATH = REPO_ROOT / "catalogs" / "user_rules.json"


def collect_sources():
    if len(sys.argv) > 1:
        return [Path(p) for p in sys.argv[1:]]
    if not DATA_DIR.exists():
        print(f"No existe {DATA_DIR}", file=sys.stderr)
        sys.exit(1)
    return sorted(DATA_DIR.glob("*.json"))


def main():
    sources = collect_sources()
    if not sources:
        print("No hay JSONs para procesar", file=sys.stderr)
        sys.exit(1)

    # merchant_upper -> Counter((cat, sub) -> n)
    by_merchant = defaultdict(Counter)
    total_tx = 0

    for path in sources:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for t in data.get("transactions", []):
            total_tx += 1
            m = (t.get("m") or "").strip().upper()
            if not m:
                continue
            cat = t.get("cat", "Other")
            sub = t.get("sub", "Other")
            # Omitimos Other/Other: no aporta información (es el fallback).
            if cat == "Other" and sub == "Other":
                continue
            by_merchant[m][(cat, sub)] += 1

    merchants = {}
    conflicts = []
    omitted_few_samples = 0

    for m, counter in by_merchant.items():
        top = counter.most_common()
        (best_cat, best_sub), best_n = top[0]
        total = sum(counter.values())
        # Si hay ambigüedad real (<80% coincide con el top), marcar conflicto.
        if best_n / total < 0.8:
            conflicts.append((m, dict(counter)))
            continue
        # Pedimos al menos 1 ejemplo (ya estaba filtrado).
        merchants[m] = [best_cat, best_sub]

    # Ordenar alfabéticamente para que el diff git sea legible.
    merchants = dict(sorted(merchants.items()))

    payload = {
        "_meta": {
            "generated_from": [str(p.relative_to(SCRIPT_DIR)) for p in sources],
            "total_transactions_scanned": total_tx,
            "rules_emitted": len(merchants),
        },
        "merchants": merchants,
        "patterns": [],
    }

    # Preservar patterns existentes si los hay.
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, encoding="utf-8") as f:
                existing = json.load(f)
            if existing.get("patterns"):
                payload["patterns"] = existing["patterns"]
        except Exception:
            pass

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Escrito {OUT_PATH.relative_to(SCRIPT_DIR)}", file=sys.stderr)
    print(f"  Fuentes: {len(sources)}", file=sys.stderr)
    print(f"  Transacciones escaneadas: {total_tx}", file=sys.stderr)
    print(f"  Reglas por merchant emitidas: {len(merchants)}", file=sys.stderr)
    if conflicts:
        print(f"  Merchants con clasificación ambigua (omitidos): {len(conflicts)}", file=sys.stderr)
        for m, c in conflicts[:10]:
            print(f"    {m}: {c}", file=sys.stderr)


if __name__ == "__main__":
    main()
