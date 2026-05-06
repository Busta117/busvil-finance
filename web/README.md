# Busta Finance · Web (Firebase Hosting + Firestore)

Versión del dashboard desplegada en Firebase Hosting. Los datos viven en
Firestore y el acceso se controla con Firebase Auth (email/password).

## Estructura

```
web/
├── firebase.json           # config hosting + firestore rules
├── firestore.rules         # solo el owner puede leer/escribir su projects/{id}/**
├── .firebaserc             # proyecto Firebase asociado
└── public/
    ├── index.html          # dashboard SPA
    └── assets/
        ├── firebase-client.js
        ├── alias-resolver.js
        ├── common.js
        ├── xls-parsers.js
        ├── config.example.js   # plantilla
        └── config.local.js     # gitignored, con la config real
```

## Configuración inicial

1. En Firebase Console:
   - Crea proyecto.
   - Activa Authentication (email/password).
   - Crea tu usuario.
   - Activa Firestore (modo producción; las rules se suben con el deploy).
   - Registra app web y copia el `firebaseConfig`.

2. Copia la plantilla y rellena valores reales:
   ```bash
   cp public/assets/config.example.js public/assets/config.local.js
   # Edita config.local.js con tu firebaseConfig y PROJECT_ID
   ```

   `PROJECT_ID` es el slug bajo el que cuelga todo dentro de Firestore
   (`projects/{PROJECT_ID}/...`). Útil si compartes el proyecto Firebase
   con varios mini-proyectos de este monorepo.

3. Deploy:
   ```bash
   firebase login
   firebase deploy --only hosting,firestore:rules
   ```

## Estructura en Firestore

```
projects/{PROJECT_ID}/          # doc raíz con owner: <UID>
├── accounts/
│   └── {accountId}             # alias, bank, iban, kind, last4, card_type, holder
│       └── transactions/
│           └── {txId}          # 1 doc por transacción
├── config/
│   ├── taxonomy                # {taxonomy: {...}}
│   ├── user_rules              # {merchants: {...}, patterns: [...]}
│   ├── merchant_aliases        # {rules: [{patterns, alias}, ...]}
│   └── suggestion_rules        # {rules: [{patterns, cat, sub}, ...]}
└── observations/               # ediciones manuales, promoción a ≥3 iguales
    └── {obsId}                 # {token, tokenKind, kind, cat, sub, alias, createdAt}
```

`accountId`:
- Cuenta corriente: últimos 10 dígitos del IBAN.
- Tarjeta de crédito: `cc-<last4>`.

## Autenticación

Solo el `owner` del doc `projects/{PROJECT_ID}` puede leer/escribir todo lo
que cuelga debajo. Reglas en `firestore.rules`.

Al hacer login por primera vez con un usuario nuevo, `ensureProjectInitialized()`
crea el doc `projects/{PROJECT_ID}` con ese `owner` si no existe. Para
colaboración multi-usuario habría que ampliar reglas con un campo `members`.

## Desarrollo local

```bash
firebase emulators:start --only hosting
# abre http://localhost:5000
```

Nota: el hosting local habla con el Firestore de **producción**, no con
emulador. Cualquier cambio desde aquí afecta los datos reales.

## Deploy

```bash
firebase deploy --only hosting,firestore:rules
```
