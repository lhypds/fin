fin
===


Auto reconciliation of financial transactions.

Setup
-----

```
./setup.sh       # install deps, build, create .env and data/users.json
                 # then put your OPENAI_API_KEY in .env
                 # and set the login accounts in data/users.json
./start.sh       # serve under pm2 (PORT from .env, default 3015)
./stop.sh
./restart.sh     # git pull, rebuild, restart

npm run dev      # development server
```

Login
-----

The app asks for a username and password. Accounts are a list in `data/users.json`
(copied from `users.example.json` by `setup.sh`); any number of them, all opening
the same workspace:

```json
[
  { "username": "admin", "password": "change-me" },
  { "username": "liu", "password": "..." }
]
```

The file is read on every login, so edits apply without a restart. Sessions are
kept in memory: restarting the server logs everyone out.

Data lives under `data/` (`DATA_DIR` in `.env`):

```
data/
├── users.json                 login accounts
├── state.json                 transactions, receipts, matches
└── uploads/<unix ms>/
    ├── <original file name>   byte-identical upload
    ├── meta.json
    ├── thumbnail.webp         images only
    └── ocr.json               raw OCR output, once it has run
```
