# Busta Finance

Personal dashboard to visualize and categorize bank transactions, with
automatic rule learning from manual edits. Two ways to use it: **local**
(Python parsers + own server) or **web** (Firebase Hosting + Firestore).

## Structure

```
busta-finance/
├── local/                  # Python parsers + local server
│   ├── build_transactions.py        # CaixaBank current account
│   ├── build_credit_card.py         # CaixaBank credit card
│   ├── common.py                    # Taxonomy, rules, utilities
│   ├── alias_resolver.py            # computeAlias(tx)
│   ├── enrich_aliases.py            # Re-apply aliases to all JSONs
│   ├── learn_rules.py               # Generate user_rules.json
│   ├── serve.py                     # Local server (autosave + upload)
│   ├── transaction_dashboard.html   # Local dashboard
│   ├── data/                        # Local datasets (gitignored)
│   └── samples/                     # Sample XLS files (gitignored)
├── web/                    # Firebase Hosting + Firestore
│   ├── firebase.json
│   ├── firestore.rules
│   ├── .firebaserc
│   └── public/
│       ├── index.html
│       └── assets/
│           ├── firebase-client.js
│           ├── common.js
│           ├── alias-resolver.js
│           ├── xls-parsers.js
│           ├── config.example.js    # Config template
│           └── config.local.js      # Real config (gitignored)
├── catalogs/               # Rules shared between local and web
│   ├── user_rules.json
│   ├── merchant_aliases.json
│   └── suggestion_rules.json
├── CLAUDE.md               # Operational guide for assistants
└── README.md
```

## Scope

Parsers are built **only for CaixaBank XLS exports** (current account and
credit card). For other banks a new parser must be added; see `CLAUDE.md`
for the extension guide.

## Local mode

Work offline with Python parsers + dashboard served from your machine:

```bash
python3 -m pip install --user --break-system-packages xlrd
cd local
python3 build_transactions.py path/to/statement.xls        # current account
python3 build_credit_card.py path/to/card.xls --last4 1234 # credit card
python3 serve.py
# open http://localhost:8000/transaction_dashboard.html
```

Datasets are saved to `local/data/<account>.json` (one per account). New
XLS uploads merge idempotently by transaction `id`.

### Utilities

```bash
cd local
python3 enrich_aliases.py      # re-apply catalog aliases to all JSONs
python3 learn_rules.py         # extract user_rules.json from manual edits
```

## Web mode (Firebase)

Data lives in Firestore. The dashboard is served from Firebase Hosting and
accesses Firestore via Firebase Auth (email/password).

### Initial setup

1. Create a Firebase project and enable Auth (email/password) + Firestore.
2. Create your user in Authentication.
3. Copy `web/public/assets/config.example.js` → `config.local.js` and fill in:
   - `firebaseConfig` (Firebase Console > Project settings > General).
   - `PROJECT_ID`: slug under which everything will be nested in Firestore
     (`projects/{PROJECT_ID}/...`). Useful if you share the Firebase project
     across several sub-projects.
4. Deploy:
   ```bash
   cd web
   firebase deploy --only hosting,firestore:rules
   ```

### Firestore layout

```
projects/{PROJECT_ID}/
├── accounts/{accountId}/
│   └── transactions/{txId}
├── config/
│   ├── taxonomy
│   ├── user_rules
│   ├── merchant_aliases
│   └── suggestion_rules
└── observations/{obsId}         # manual edits, validated at ≥3 matches
```

`accountId`:
- Current account: last 10 digits of the IBAN (e.g. `0200680387`).
- Card: `cc-<last 4 digits>` (e.g. `cc-5994`).

### Security rules

Each project has an `owner` (UID). Only the owner can read/write anything
under `projects/{PROJECT_ID}/`. See `web/firestore.rules`.

## Shared catalogs

`catalogs/*.json` are the categorization and alias rules shared between
local and web. In web mode they are uploaded to Firestore
(`projects/{PROJECT_ID}/config/`) and read from there. Locally they are
read directly from disk.

Three files:

- `user_rules.json`: category rules (exact merchants + patterns). Expanded
  with `learn_rules.py` or by learning from manual edits.
- `merchant_aliases.json`: readable alias rules for each merchant.
  First matching rule wins.
- `suggestion_rules.json`: keywords used to suggest a category in the
  dashboard editor (fallback when no similar transactions are available).
