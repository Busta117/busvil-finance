#!/usr/bin/env python3
"""Lee un XLS bancario de La Caixa y produce un JSON en data/.

Uso:
    python3 build_transactions.py [ruta/al/xls]

Si no se pasa ruta, usa TT040526.133.XLS. El nombre de salida se deriva
de los últimos 10 dígitos de la cuenta y el rango de fechas:
    data/<cuenta>_<desde>_<hasta>.json
"""

import json
import os
import re
import sys
from pathlib import Path

import xlrd

from common import (
    DATA_DIR,
    TAXONOMY,
    RULES,
    assign_ids,
    categorize,
    load_user_rules,
    merge_and_write,
    normalize_text,
    slug,
)

SCRIPT_DIR = Path(__file__).parent.resolve()
# Por convención, pon XLS sueltos de prueba en local/samples/ (gitignored).
SAMPLES_DIR = SCRIPT_DIR / "samples"


def find_header_row(sheet):
    """Devuelve el índice de la fila que contiene 'F. Operación' en columna B (idx 1)."""
    for i in range(sheet.nrows):
        row = sheet.row_values(i)
        if len(row) > 4 and row[4] == "F. Operación":
            return i
    raise RuntimeError("No se encontró la fila de cabecera 'F. Operación' en el XLS")


def read_rows(xls_path):
    """Devuelve la lista de dicts crudos: {date, amount, merchant_raw, concept}."""
    wb = xlrd.open_workbook(xls_path)
    sh = wb.sheet_by_index(0)
    header_row_idx = find_header_row(sh)
    rows = []
    for i in range(header_row_idx + 1, sh.nrows):
        row = sh.row_values(i)
        if not any(row):
            continue
        # Columnas (1-indexed en el XLS visible, 0-indexed en xlrd):
        # B=1 cuenta, E=4 F.Operacion, G=6 Ingreso(+), H=7 Gasto(-)
        # N=13 Ref2, O=14 ConceptoComplementario1, R=17 CC4,
        # W=22 ConceptoComplementario9 (contraparte real en transferencias).
        def cell(idx):
            return row[idx] if len(row) > idx else ""
        rows.append({
            "cuenta": cell(1),
            "oficina": cell(2),
            "divisa": cell(3),
            "f_operacion": cell(4),
            "f_valor": cell(5),
            "ingreso": cell(6),
            "gasto": cell(7),
            "saldo_pos": cell(8),
            "saldo_neg": cell(9),
            "concepto_comun": cell(10),
            "concepto_propio": cell(11),
            "ref1": cell(12),
            "ref2": cell(13),
            "cc1": cell(14),
            "cc2": cell(15),
            "cc3": cell(16),
            "cc4": cell(17),
            "cc5": cell(18),
            "cc6": cell(19),
            "cc7": cell(20),
            "cc8": cell(21),
            "cc9": cell(22),
            "cc10": cell(23),
        })
    return rows


def parse_date(v):
    """Convierte '04/05/2026' (string) a '2026-05-04'."""
    if not v:
        return None
    if isinstance(v, str):
        parts = v.strip().split("/")
        if len(parts) != 3:
            return None
        dd, mm, yyyy = parts
        return f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"
    return None


def parse_amount(ingreso, gasto):
    """Devuelve el monto positivo (gasto tiene prioridad, luego ingreso)."""
    for v in (gasto, ingreso):
        if isinstance(v, (int, float)) and v != 0:
            return round(float(v), 2)
    return 0.0


CARD_PATTERN = re.compile(r"Fecha de operación:\s*\d{2}-\d{2}-\d{4}\s+(.+)")


def parse_merchant(cc1, cc4, cc7, is_income=False):
    """Extrae el nombre del merchant / contraparte.

    - Tarjeta: cc1 comienza con "Fecha de operación: DD-MM-YYYY    MERCHANT".
    - Ingreso entrante: cc1 lleva el pagador real (EVINOVA, BUSVIL, T.G.S.S.,
      David Taylor). cc7 es el titular de la cuenta propia.
    - Gasto/transferencia saliente: cc7 lleva la contraparte y cc1 trae el
      titular (a veces con basura tipo "NOTPROVIDE"), así que se prefiere cc7.
    """
    cc1 = (cc1 or "").strip()
    cc7 = (cc7 or "").strip()
    m = CARD_PATTERN.match(cc1)
    if m:
        return normalize_merchant(m.group(1))
    primary, secondary = (cc1, cc7) if is_income else (cc7, cc1)
    if primary:
        return normalize_merchant(primary)
    if secondary:
        return normalize_merchant(secondary)
    return ""


def normalize_merchant(s):
    """Wrapper para mantener compatibilidad local. Usa common.normalize_text."""
    return normalize_text(s)


ACCOUNT_DIGITS = re.compile(r"\d+")

# Tabla mínima de códigos de entidad bancaria española (primeros 4 dígitos del CCC).
BANK_CODES = {
    "2100": "CaixaBank",
    "0049": "Santander",
    "0081": "Banco Sabadell",
    "0182": "BBVA",
    "0128": "Bankinter",
    "0073": "Openbank",
    "1491": "Triodos",
    "1583": "Self Bank",
    "2038": "Bankia",
    "3058": "Cajamar",
}


def account_id(cuenta_str):
    """Extrae los últimos 10 dígitos de la cuenta como identificador."""
    digits = "".join(ACCOUNT_DIGITS.findall(cuenta_str or ""))
    return digits[-10:] if digits else "unknown"


def build_account_info(cuenta_str):
    """Prellena {iban, bank, alias} desde el CCC del XLS. El usuario puede
    luego editar estos campos desde el dashboard."""
    digits = "".join(ACCOUNT_DIGITS.findall(cuenta_str or ""))
    bank = BANK_CODES.get(digits[:4], "") if digits else ""
    return {
        "iban": cuenta_str.strip() if cuenta_str else "",
        "bank": bank,
        "alias": "",
    }


def derive_output_path(parsed):
    """Construye data/<cuenta>.json. Un JSON por cuenta, se fusiona con cada import."""
    if not parsed:
        raise RuntimeError("No hay transacciones para derivar nombre de archivo")
    cuenta_str = ""
    for kv in parsed[0].get("raw", []):
        if kv.get("k") == "Cuenta":
            cuenta_str = kv.get("v", "")
            break
    acct = account_id(cuenta_str)
    return DATA_DIR / f"{acct}.json"


RAW_FIELDS = [
    ("Cuenta", "cuenta"),
    ("Oficina", "oficina"),
    ("Divisa", "divisa"),
    ("F. Valor", "f_valor"),
    ("Saldo tras operación", "saldo_pos"),
    ("Concepto común", "concepto_comun"),
    ("Concepto propio", "concepto_propio"),
    ("Referencia 1", "ref1"),
    ("Referencia 2", "ref2"),
    ("Contraparte", "cc9"),
    ("Titular / nombre propio", "cc1"),
    ("Info extra 1", "cc2"),
    ("Info extra 2", "cc3"),
    ("Descripción / nota", "cc4"),
    ("Info extra 3", "cc5"),
    ("Info extra 4", "cc6"),
    ("Info extra 5", "cc7"),
    ("Info extra 6", "cc8"),
    ("Info extra 7", "cc10"),
]


def build_raw(r):
    """Recolecta campos crudos no vacíos para mostrarlos como detalle."""
    out = []
    for label, key in RAW_FIELDS:
        v = r.get(key, "")
        if isinstance(v, str):
            v = re.sub(r"\s+", " ", v).strip()
        if v == "" or v == 0 or v is None:
            continue
        out.append({"k": label, "v": v if isinstance(v, str) else round(float(v), 2)})
    return out


def build(xls_path, interactive=True):
    """Procesa un XLS y devuelve (payload, output_path)."""
    from alias_resolver import compute_alias, load_aliases
    alias_rules = load_aliases()
    user_rules = load_user_rules()
    raw_rows = read_rows(xls_path)
    parsed = []
    for r in raw_rows:
        d = parse_date(r["f_operacion"])
        a = parse_amount(r["ingreso"], r["gasto"])
        is_income = isinstance(r["ingreso"], (int, float)) and r["ingreso"] != 0
        m = parse_merchant(r["cc1"], r["cc4"], r["cc9"], is_income=is_income)
        c = (r["cc4"] or "").strip()
        if d is None or a == 0:
            continue
        cat, sub = categorize(m, is_income=is_income, user_rules=user_rules)
        tx = {
            "d": d, "a": a, "dir": "in" if is_income else "out",
            "m": m, "c": c, "cat": cat, "sub": sub,
            "raw": build_raw(r),
        }
        tx["alias"] = compute_alias(tx, alias_rules)
        tx["alias_manual"] = False
        parsed.append(tx)

    parsed.sort(key=lambda t: t["d"])
    assign_ids(parsed)

    parsed = [{"id": t["id"], "d": t["d"], "a": t["a"], "dir": t["dir"],
               "m": t["m"], "alias": t.get("alias", ""), "alias_manual": t.get("alias_manual", False),
               "c": t["c"], "cat": t["cat"], "sub": t["sub"], "raw": t["raw"]} for t in parsed]

    from collections import Counter
    cat_counts = Counter(t["cat"] for t in parsed)
    print(f"Total: {len(parsed)} transacciones", file=sys.stderr)
    for c, n in cat_counts.most_common():
        print(f"  {c}: {n}", file=sys.stderr)

    cuenta_str = ""
    for kv in parsed[0].get("raw", []):
        if kv.get("k") == "Cuenta":
            cuenta_str = kv.get("v", "")
            break
    account = build_account_info(cuenta_str)

    out_path = derive_output_path(parsed)
    payload, stats = merge_and_write(out_path, parsed, account)
    return payload, out_path


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 build_transactions.py <ruta-al-xls>", file=sys.stderr)
        sys.exit(1)
    xls_path = Path(sys.argv[1])
    if not xls_path.exists():
        print(f"Error: no existe {xls_path}", file=sys.stderr)
        sys.exit(1)
    payload, out_path = build(xls_path)
    print(f"Escrito {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
