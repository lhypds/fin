fin
===


Auto reconciliation of financial transactions.

Bank accounts are set up by hand on the left (bank, branch, account number, holder). A statement
is dropped onto its account: the bank's CSV export, or photos, scans and PDFs of the passbook
(通帳). The model reads it into rows on the ledger, the way it reads receipts (a CSV in parts of
about a hundred rows so nothing is lost), and what a passbook cover says about the account fills
in the details not typed in yet. Receipts on the right are uploaded as images or PDFs, read by
OCR, and matched to the rows. The ledger shows one account (or all of them) and one month at a time.


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

The file is read on every login, so edits apply without a restart.

Data lives under `data/` (`DATA_DIR` in `.env`):

```
data/
├── users.json                 login accounts
├── state.json                 banks, statements, transactions, receipts, matches
└── uploads/<unix ms>/         one folder per upload (a CSV statement or a receipt)
    ├── <original file name>   byte-identical upload
    ├── meta.json
    ├── thumbnail.webp         images only
    └── ocr.json               raw model output, once it has run
```

CSV statements may be Shift_JIS or UTF-8 (with or without a BOM); the server decodes them and
hands the text to the model with the account's columns left for it to work out.
