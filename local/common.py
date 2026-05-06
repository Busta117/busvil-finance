#!/usr/bin/env python3
"""Funciones compartidas entre parsers de distintos bancos/productos.

Todo lo que sea independiente del formato del extracto va aquí:
- Taxonomía global.
- Reglas de categorización + carga de user_rules.json.
- Generación de IDs deterministas.
- Escritura de JSON con merge idempotente.
- Utilidades (slug, normalize_merchant).
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = SCRIPT_DIR / "data"
CATALOGS_DIR = REPO_ROOT / "catalogs"
USER_RULES_PATH = CATALOGS_DIR / "user_rules.json"


TAXONOMY = {
    "Transfers": ["Internal Transfer", "Other Transfer", "Card Payment"],
    "Income": ["Salary", "Other Income", "Bonus"],
    "Shopping": ["Fashion & Clothing", "Sports", "Pets", "Electronics & Tech", "Home & Garden", "Beauty & Personal Care", "Gifts"],
    "Food & Drink": ["Cafes & Restaurants", "Supermarket", "Delivery", "Bakery"],
    "Health & Wellness": ["Pharmacy", "Medical", "Gym & Fitness", "Vet"],
    "Leisure": ["Entertainment", "Travel & Hotels", "Activities", "Tickets & Events"],
    "Transport": ["Public Transport", "Taxi & Rideshare", "Tolls & Parking", "Fuel", "Car Rental", "Trains & Flights"],
    "Housing": ["Rent", "Utilities", "Maintenance", "Community Fees"],
    "Subscriptions": ["Streaming", "Software"],
    "Investments": ["Brokerage"],
    "Personal": ["Family", "Friends"],
    "Other": ["Other"],
}


RULES = [
    (["EVINOVA SPAIN"], "Income", "Salary"),
    (["BUSVIL"], "Income", "Other Income"),
    (["T.G.S.S.", "ABONO CAMPAÑA"], "Income", "Other Income"),
    (["IBKR", "Interactive Brokers"], "Investments", "Brokerage"),
    (["AJUSTE TARJETA", "MYCARD", "AVANCE DE PAGO"], "Transfers", "Card Payment"),
    (["06700051CTF"], "Transfers", "Internal Transfer"),
    (["VETSTIL", "ANICURA", "BORRELLVET"], "Health & Wellness", "Vet"),
    (["FARMACIA"], "Health & Wellness", "Pharmacy"),
    (["WELLHUB", "GYMPASS"], "Health & Wellness", "Gym & Fitness"),
    (["MERCADONA", "ALCAMPO", "ALDI", "CAPRABO", "VERITAS", "AMETLLER", "DIA 31018", "SORLI", "RAFI SUPERMARKET"],
     "Food & Drink", "Supermarket"),
    (["GLOVO"], "Food & Drink", "Delivery"),
    (["FORN", "PASTISSERIA", "PRIFER CAKE", "THE LOAF"], "Food & Drink", "Bakery"),
    (["SANDWICHEZ", "STARBUCKS", "BREW COFFEE", "SAGA COFFEE", "MISTER BRAZ", "HIDDEN CAFE",
      "HONEST GREENS", "KASUALK", "TAVERNA", "TASMANGO", "PEMSA LEISURE", "ORIGO BAKERY",
      "GOOD TEA", "KINA CHOCOLATES", "SUCRE CREMAT", "COFFEE BAR", "COLIBRI", "BUGANVILLA",
      "SLOPPY TUNAS"],
     "Food & Drink", "Cafes & Restaurants"),
    (["DECATHLON", "COREALMIRI", "OLYMPIA ESPORTS", "PICSIL SPORT", "ASICS"], "Shopping", "Sports"),
    (["MISCOTA"], "Shopping", "Pets"),
    (["AMAZON", "PCCOM", "CCO COMX"], "Shopping", "Electronics & Tech"),
    (["LEROY MERLIN"], "Shopping", "Home & Garden"),
    (["CURAPROX", "PERFUMS BEAUTY", "THE MAN CAVE", "THE PROFESSIONAL"], "Shopping", "Beauty & Personal Care"),
    (["UNIQLO", "HM ES", "SANDALS", "SPHERE BCN", "FINCUT", "DS COMPLEMENTOS", "VENDING ZARAGOZA"],
     "Shopping", "Fashion & Clothing"),
    (["TMB"], "Transport", "Public Transport"),
    (["UBER", "FREENOW", "LIME"], "Transport", "Taxi & Rideshare"),
    (["TELPARK", "AUTOPISTAS", "TUNELSPAN", "APARCAMENT"], "Transport", "Tolls & Parking"),
    (["PLENERGY", "E.S. AVDA"], "Transport", "Fuel"),
    (["EUROPCAR"], "Transport", "Car Rental"),
    (["RENFE", "OUIGO", "VUELING AIRLINES", "FALCANS"], "Transport", "Trains & Flights"),
    (["AMOVENS"], "Transport", "Taxi & Rideshare"),
    (["Hotel at Booking", "AIRBNB", "PROAP APARTAMENTS", "APARTAMENTS ELS A", "ALTEA COMUNIDAD"],
     "Leisure", "Travel & Hotels"),
    (["GRANDVALIRA", "A.P.S. CENTRO GIO", "ONE MORE", "CARNIVAL", "THE HALL"], "Leisure", "Activities"),
    (["TICKETMASTER", "TM *Ticketmaster"], "Leisure", "Tickets & Events"),
]


def load_user_rules():
    if not USER_RULES_PATH.exists():
        return {"merchants": {}, "patterns": []}
    try:
        with open(USER_RULES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {
            "merchants": {k.upper(): tuple(v) for k, v in data.get("merchants", {}).items()},
            "patterns": data.get("patterns", []),
        }
    except Exception as e:
        print(f"Aviso: no se pudo leer user_rules.json: {e}", file=sys.stderr)
        return {"merchants": {}, "patterns": []}


def categorize(merchant, is_income=False, user_rules=None):
    m_upper = (merchant or "").upper()

    if user_rules and m_upper in user_rules["merchants"]:
        cat, sub = user_rules["merchants"][m_upper]
        if cat != "Income" or is_income:
            return cat, sub

    def try_patterns(rules):
        for patterns, cat, sub in rules:
            if cat == "Income" and not is_income:
                continue
            for p in patterns:
                if p.upper() in m_upper:
                    return cat, sub
        return None

    if user_rules:
        hit = try_patterns(user_rules["patterns"])
        if hit:
            return hit

    hit = try_patterns(RULES)
    if hit:
        return hit
    return "Other", "Other"


def slug(s):
    s = (s or "").strip()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s)
    return s.strip("-") or "unknown"


def normalize_text(s):
    if not s:
        return ""
    s = re.sub(r"\s+", " ", s).strip()
    if s.endswith(" NOTPROVIDE"):
        s = s[:-len(" NOTPROVIDE")].strip()
    return s


def assign_ids(transactions):
    seen = defaultdict(int)
    for t in transactions:
        base = f"{t['d']}_{t['a']:.2f}_{slug(t['m'])}"
        idx = seen[base]
        seen[base] += 1
        t["id"] = f"{base}_{idx}"
    return transactions


def merge_and_write(out_path, new_tx, account, existing_preserved_fields=("iban", "bank", "alias")):
    """Escribe el dataset fusionando con lo existente si lo hay.

    Preserva las transacciones existentes (con sus categorías y alias manuales).
    Añade solo las nuevas por `id`. Preserva los campos del `account` ya
    editados por el usuario.

    Devuelve (payload, stats_dict).
    """
    existing_tx = []
    added = 0
    skipped = 0

    if out_path.exists():
        try:
            with open(out_path, encoding="utf-8") as f:
                prev = json.load(f)
            prev_acct = prev.get("account") or {}
            for k in existing_preserved_fields:
                if prev_acct.get(k):
                    account[k] = prev_acct[k]
            existing_tx = prev.get("transactions", [])
        except Exception as e:
            print(f"Aviso: no se pudo leer {out_path.name} ({e}); se regenera.", file=sys.stderr)

    existing_ids = {t["id"] for t in existing_tx}
    merged = list(existing_tx)
    for t in new_tx:
        if t["id"] in existing_ids:
            skipped += 1
            continue
        merged.append(t)
        existing_ids.add(t["id"])
        added += 1

    merged.sort(key=lambda t: t["d"])

    payload = {
        "version": 1,
        "account": account,
        "taxonomy": TAXONOMY,
        "transactions": merged,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    if out_path.exists():
        shutil.copy2(out_path, out_path.with_suffix(out_path.suffix + ".bak"))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    stats = {"existing": len(existing_tx), "added": added, "skipped": skipped, "total": len(merged)}
    print(f"Fusión: {stats['existing']} existentes + {stats['added']} nuevas (omitidas {stats['skipped']})", file=sys.stderr)
    return payload, stats
