#!/usr/bin/env python3
"""Parser de extractos de tarjeta de crédito de CaixaBank.

Formato detectado:
  columnas: Fecha | Establecimiento/concepto | Estado | Importe
  una fila de cabecera, sin metadatos globales.
  importe positivo = cargo (gasto), negativo = abono (pago de tarjeta, etc).

Uso:
    python3 build_credit_card.py ruta/al/xls --last4 1234
    # genera/fusiona data/cc-1234.json

El identificador de la cuenta se construye a partir de los últimos 4 dígitos
de la tarjeta que pasa el usuario por --last4 (no aparece en el XLS).
"""

import argparse
import json
import re
import sys
from pathlib import Path

import xlrd

from alias_resolver import compute_alias, load_aliases
from common import (
    DATA_DIR,
    TAXONOMY,
    assign_ids,
    categorize,
    load_user_rules,
    merge_and_write,
    normalize_text,
    slug,
)

EXPECTED_HEADER = ["Fecha", "Establecimiento/concepto", "Estado", "Importe"]


def is_credit_card_xls(xls_path):
    """Detector rápido: primera fila debe coincidir (de forma flexible) con el
    formato esperado. Útil para que serve.py sepa qué parser usar."""
    try:
        wb = xlrd.open_workbook(xls_path)
        sh = wb.sheet_by_index(0)
        if sh.nrows < 2 or sh.ncols < 4:
            return False
        header = [str(sh.cell_value(0, i)).strip() for i in range(4)]
        return header == EXPECTED_HEADER
    except Exception:
        return False


def parse_date(v):
    if not v or not isinstance(v, str):
        return None
    parts = v.strip().split("/")
    if len(parts) != 3:
        return None
    dd, mm, yyyy = parts
    return f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"


def read_rows(xls_path):
    wb = xlrd.open_workbook(xls_path)
    sh = wb.sheet_by_index(0)
    header = [str(sh.cell_value(0, i)).strip() for i in range(sh.ncols)]
    if header[:4] != EXPECTED_HEADER:
        raise RuntimeError(
            f"Cabecera inesperada para extracto de tarjeta de crédito: {header[:4]!r}"
        )
    rows = []
    for i in range(1, sh.nrows):
        row = sh.row_values(i)
        if not any(row):
            continue
        rows.append({
            "fecha": row[0],
            "concepto": row[1],
            "estado": row[2],
            "importe": row[3],
        })
    return rows


def build(xls_path, last4, interactive=True):
    last4 = (last4 or "").strip()
    if not re.fullmatch(r"\d{4}", last4):
        raise ValueError("--last4 debe ser exactamente 4 dígitos")

    alias_rules = load_aliases()
    user_rules = load_user_rules()
    raw_rows = read_rows(xls_path)

    parsed = []
    for r in raw_rows:
        d = parse_date(r["fecha"])
        imp = r["importe"]
        if d is None or not isinstance(imp, (int, float)) or imp == 0:
            continue
        is_income = imp < 0  # negativo en tarjeta = abono (ingreso al saldo)
        a = round(abs(float(imp)), 2)
        m = normalize_text(str(r["concepto"]))
        # Raw guarda los campos para el panel de detalle
        raw = []
        for label, key in (("Fecha", "fecha"), ("Establecimiento/concepto", "concepto"),
                            ("Estado", "estado"), ("Importe", "importe")):
            v = r.get(key)
            if isinstance(v, str):
                v = normalize_text(v)
            if v == "" or v is None:
                continue
            raw.append({"k": label, "v": v if isinstance(v, str) else round(float(v), 2)})

        cat, sub = categorize(m, is_income=is_income, user_rules=user_rules)
        tx = {
            "d": d,
            "a": a,
            "dir": "in" if is_income else "out",
            "m": m,
            "c": "",
            "cat": cat,
            "sub": sub,
            "raw": raw,
        }
        tx["alias"] = compute_alias(tx, alias_rules)
        tx["alias_manual"] = False
        parsed.append(tx)

    parsed.sort(key=lambda t: t["d"])
    assign_ids(parsed)

    parsed = [
        {"id": t["id"], "d": t["d"], "a": t["a"], "dir": t["dir"], "m": t["m"],
         "alias": t.get("alias", ""), "alias_manual": t.get("alias_manual", False),
         "c": t["c"], "cat": t["cat"], "sub": t["sub"], "raw": t["raw"]}
        for t in parsed
    ]

    account = {
        "iban": "",
        "bank": "CaixaBank",
        "alias": "",
        "kind": "credit_card",
        "last4": last4,
    }

    out_path = DATA_DIR / f"cc-{last4}.json"
    payload, stats = merge_and_write(out_path, parsed, account)
    return payload, out_path


def main():
    ap = argparse.ArgumentParser(description="Build JSON desde extracto de tarjeta de crédito CaixaBank")
    ap.add_argument("xls", help="Ruta al XLS")
    ap.add_argument("--last4", required=True, help="Últimos 4 dígitos de la tarjeta")
    args = ap.parse_args()

    xls_path = Path(args.xls).expanduser().resolve()
    if not xls_path.exists():
        print(f"Error: no existe {xls_path}", file=sys.stderr)
        sys.exit(1)

    payload, out_path = build(xls_path, args.last4)
    print(f"Escrito {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
