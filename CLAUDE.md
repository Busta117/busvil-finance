# Busta Finance · Operational guide for assistants

Personal finance project. Parses bank statements, categorizes transactions,
and presents an interactive dashboard. Two usage modes: **local** (Python
+ files) and **web** (Firebase Hosting + Firestore).

## Scope

The current parsers only support **CaixaBank XLS exports** (current
account and credit card). For other banks a new, specific parser must be
added without reusing the CaixaBank column logic; see the "Other banks"
section below.

## Structure

```
busta-finance/
├── local/           # Python parsers + local server
├── web/             # Firebase Hosting + Firestore (JS frontend)
├── catalogs/        # Shared rules (user_rules, aliases, suggestions)
├── CLAUDE.md
└── README.md
```

**gitignored:** `local/data/`, `local/samples/`, `*.xls`, `*.bak`, `__pycache__/`,
`web/.firebase/`, `web/public/assets/config.local.js`.

## Key files

| File | Purpose |
|---|---|
| `local/common.py` | TAXONOMY, hardcoded RULES, `categorize`, `assignIds`, `normalize_text`, `slug`, `merge_and_write`. Base for any parser. |
| `local/build_transactions.py` | CaixaBank current account → `local/data/<account>.json`. Idempotent merge by `id`. |
| `local/build_credit_card.py` | CaixaBank credit card → `local/data/cc-<last4>.json`. Requires `--last4`. |
| `local/alias_resolver.py` | `compute_alias(tx)` with clean fallback (strips SEPA codes, IDs, etc.). Reads `catalogs/merchant_aliases.json`. |
| `local/enrich_aliases.py` | Re-applies catalog aliases to all `data/*.json` respecting `alias_manual`. |
| `local/learn_rules.py` | Generates `catalogs/user_rules.json` from manual categorizations in the local datasets. |
| `local/serve.py` | Local HTTP server. Detects XLS format, dispatches to the right parser, autosave via POST /data/<file>. |
| `local/transaction_dashboard.html` | Local dashboard. Reads/writes via `fetch('/data/...')` to the server. |
| `web/public/index.html` | Web dashboard. Firebase Auth login + read/write to Firestore. |
| `web/public/assets/firebase-client.js` | Auth wrapper and Firestore CRUD. Imports `config.local.js`. |
| `web/public/assets/config.local.js` | **Gitignored.** `firebaseConfig` + `PROJECT_ID`. Copy of `config.example.js`. |
| `web/public/assets/xls-parsers.js` | JS port of the CaixaBank parsers, using SheetJS (`xlsx`). |
| `web/public/assets/alias-resolver.js` | JS port of `alias_resolver.py`. |
| `web/public/assets/common.js` | JS port of `common.py`. |
| `web/firestore.rules` | Each `projects/{PROJECT_ID}` belongs to an `owner` (UID); only they can read/write. |
| `catalogs/user_rules.json` | Exact merchants + patterns → category/subcategory. |
| `catalogs/merchant_aliases.json` | Patterns → readable alias. |
| `catalogs/suggestion_rules.json` | Keywords → category suggestion in the editor. |

## Dataset JSON format

```jsonc
{
  "version": 1,
  "account": { "iban": "...", "bank": "...", "alias": "...",
                "kind": "account|credit_card", "last4": "...",
                "card_type": "...", "holder": "..." },
  "taxonomy": { "Transfers": [...], "Income": [...], ... },
  "transactions": [
    {
      "id": "YYYY-MM-DD_amount_slug_idx",
      "d": "YYYY-MM-DD",
      "a": 123.45,
      "dir": "in" | "out",
      "m": "bank technical merchant",
      "alias": "Readable alias",
      "alias_manual": false,
      "c": "concept/note",
      "cat": "Category",
      "sub": "Subcategory",
      "raw": [ { "k": "...", "v": "..." }, ... ]
    }
  ]
}
```

**Invariants:**
- Deterministic `id`: `{date}_{amount:.2f}_{slug(m)}_{idx-between-duplicates}`.
- `alias_manual: true` protects `alias` from `enrich_aliases.py` / rebuild.
- Existing transactions are **never overwritten** during a merge; only new
  ones are added (dedup by `id`).

## Task: load a new CaixaBank XLS

### Via web (Firebase)

1. Open `https://finance.busta.me` (or your custom domain).
2. Log in.
3. "+ Upload XLS" button. If it's a card, a prompt asks for the last 4 digits.
4. The JS parser detects the format, categorizes, aliases, and uploads to Firestore.
5. The merge is idempotent by `id`.

### Via local (CLI)

```bash
cd local

# Current account:
python3 build_transactions.py path/to/statement.xls

# Credit card:
python3 build_credit_card.py path/to/card.xls --last4 1234
```

After loading, optional:
```bash
python3 enrich_aliases.py    # re-apply catalog aliases
python3 learn_rules.py       # learn user_rules.json from manual edits
```

## Learning with observations (web only)

Every manual edit (category / alias) in the dashboard records an
observation under `projects/{PROJECT_ID}/observations/`. When ≥3
observations for the same token point to the same (cat, sub) or same
alias, they are promoted automatically to `user_rules` / `merchant_aliases`.
The threshold is hardcoded in `index.html` as `VALIDATION_THRESHOLD = 3`.

This way every correction improves future XLS categorization.

## Other banks

If an XLS is not from CaixaBank:

1. **Do not reuse** `build_transactions.py` or `build_credit_card.py`.
2. Create `local/build_<bank>.py` with the same contract:
   - Receives an XLS path.
   - Returns `(payload, out_path)`.
   - `payload` follows the dataset JSON format (above).
3. Reuse `common.py` (TAXONOMY, RULES, assignIds, merge_and_write) and
   `alias_resolver.py` (global, bank-agnostic).
4. Add a detector to `local/serve.py` → `dispatch_parser()` and to
   `web/public/assets/xls-parsers.js` → `parseXls()`.
5. Document the new bank and its layout here.

## General rules for Claude working on this project

- **Do not regenerate `local/data/*.json` without confirming with the
  user.** They are local backups of manual edits.
- **Backups before batches**: `shutil.copy2(path, path+'.bak')` before
  overwriting.
- **Preserve `alias_manual: true`** in any batch that touches `alias`.
- **JSON formatting**: `indent=2`, `ensure_ascii=False`.
- **Firestore does not allow nested arrays**; `user_rules.patterns` is
  stored as an array of maps `[{patterns, cat, sub}]`.
- **Secrets**: `firebaseConfig` is not secret (control is via Firestore
  rules), but UIDs and emails identify the owner; never commit
  `config.local.js` or scripts with hardcoded UIDs.
