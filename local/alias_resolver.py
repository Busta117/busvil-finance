#!/usr/bin/env python3
"""Resuelve el alias legible de una transacción.

Orden de resolución:
  1. Si la tx tiene `alias_manual: true`, devuelve `alias` tal cual (protegido).
  2. Busca en `merchant_aliases.json` la primera regla cuyo patrón aparezca en
     el texto concatenado de campos relevantes (merchant + titular + contraparte
     + conceptos + descripción + info extras).
  3. Fallback inteligente: limpia el merchant (quita prefijos de código
     bancario, hashes, colas tipo "SANTIAGO BUSTAMANTE GARCIA") y devuelve
     una versión titlecase razonable. Si no encuentra base, usa el propio
     merchant sin cambios.
"""

import json
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
CATALOGS_DIR = SCRIPT_DIR.parent / "catalogs"
ALIASES_PATH = CATALOGS_DIR / "merchant_aliases.json"

# Prefijos de código bancario La Caixa que preceden a conceptos genéricos.
CODE_PREFIX = re.compile(r"^\d{8,}[A-Z]{3}\s+", re.IGNORECASE)
# Prefijo de domiciliación SEPA estilo "D-0030318QCVJ9 "
SEPA_PREFIX = re.compile(r"^D-[0-9A-Z]{10,}\s+", re.IGNORECASE)
# ID numérico largo que a veces precede a un nombre
NUMID_PREFIX = re.compile(r"^\d{6,}\s+", re.IGNORECASE)
# Cola genérica del titular repetida
OWNER_TAIL = re.compile(r"\s*SANTIAGO\s+BUSTAMANTE\s+GARCIA.*$", re.IGNORECASE)
OWNER_TAIL_2 = re.compile(r"\s*BUSTAMANTE\s+GARCIA\s+SANTIAGO.*$", re.IGNORECASE)
# "NOTPROVIDE" que añade la Caixa
NOTPROVIDE = re.compile(r"\s*NOTPROVIDE\s*$", re.IGNORECASE)
# Colapsa espacios/whitespace
WS = re.compile(r"\s+")


_aliases_cache = None


def load_aliases():
    global _aliases_cache
    if _aliases_cache is not None:
        return _aliases_cache
    if not ALIASES_PATH.exists():
        _aliases_cache = []
        return _aliases_cache
    with open(ALIASES_PATH, encoding="utf-8") as f:
        data = json.load(f)
    _aliases_cache = data.get("rules", [])
    return _aliases_cache


def collect_text(tx):
    """Concatena todos los campos de texto relevantes para buscar patrones."""
    parts = [tx.get("m", ""), tx.get("c", "")]
    for kv in tx.get("raw", []) or []:
        v = kv.get("v", "")
        if isinstance(v, str):
            parts.append(v)
    return " ".join(parts).upper()


def _cleanup(text):
    """Limpia ruido tipográfico y de formato del banco."""
    if not text:
        return ""
    text = WS.sub(" ", text).strip()
    text = NOTPROVIDE.sub("", text)
    text = SEPA_PREFIX.sub("", text)
    text = NUMID_PREFIX.sub("", text)
    text = CODE_PREFIX.sub("", text)
    text = OWNER_TAIL.sub("", text)
    text = OWNER_TAIL_2.sub("", text)
    text = text.strip()
    return text


def _titlecase(text):
    """Title case que respeta siglas cortas, preposiciones y el ampersand."""
    if not text:
        return text
    small = {"de", "la", "el", "y", "&", "del", "los", "las", "i", "a", "en", "por"}
    keep_upper = {"SL", "SA", "BCN", "CBA", "SRL", "SAS", "SLU", "SCP", "LLC",
                  "S.L.", "S.A.", "BBVA", "IBKR", "TGSS", "MYCARD", "VISA",
                  "TMB", "CCO", "HM", "DS", "SP", "SQ"}
    words = text.split()
    out = []
    for i, w in enumerate(words):
        wu = w.strip(",.;:()").upper()
        if wu in keep_upper:
            out.append(w.upper())
        elif w.lower() in small and i != 0:
            out.append(w.lower())
        else:
            out.append(w.capitalize())
    return " ".join(out)


OWN_NAME_PATTERNS = [
    re.compile(r"^SANTIAGO\s+BUSTAMANTE", re.IGNORECASE),
    re.compile(r"^BUSTAMANTE\s+GARCIA\s+SANTIAGO", re.IGNORECASE),
]


def _is_own_name(s):
    s = (s or "").strip()
    return any(p.match(s) for p in OWN_NAME_PATTERNS)


def _fallback_alias(tx):
    """Deriva un alias razonable cuando no hay regla. Preferencia:

    1. Merchant limpio si queda algo descriptivo.
    2. Si merchant es el titular propio, intenta la contraparte.
    3. Si todo apunta al titular propio, devuelve "Auto-transferencia".
    4. Merchant original como último recurso.
    """
    m_raw = tx.get("m", "")
    m = _cleanup(m_raw)
    titular = ""
    contraparte = ""
    for kv in tx.get("raw", []) or []:
        k = kv.get("k")
        v = str(kv.get("v", ""))
        if k == "Titular / nombre propio":
            titular = v
        elif k == "Contraparte":
            contraparte = v
    t_clean = _cleanup(titular)
    c_clean = _cleanup(contraparte)

    # Si el merchant es solo el titular propio, probamos con la contraparte.
    if _is_own_name(m_raw) or _is_own_name(m):
        if c_clean and not _is_own_name(c_clean):
            return _titlecase(c_clean)
        if t_clean and not _is_own_name(t_clean):
            return _titlecase(t_clean)
        return "Auto-transferencia"

    if m and not _is_own_name(m):
        return _titlecase(m)
    if c_clean and not _is_own_name(c_clean):
        return _titlecase(c_clean)
    if t_clean and not _is_own_name(t_clean):
        return _titlecase(t_clean)
    return "Auto-transferencia"


def compute_alias(tx, rules=None):
    """Devuelve el alias resuelto para una transacción. Respeta alias_manual=True."""
    if tx.get("alias_manual"):
        existing = tx.get("alias")
        if existing:
            return existing
    if rules is None:
        rules = load_aliases()
    haystack = collect_text(tx)
    for rule in rules:
        for p in rule.get("patterns", []):
            if p.upper() in haystack:
                return rule.get("alias", "")
    return _fallback_alias(tx)
