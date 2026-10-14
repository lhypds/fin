fin
===


Auto reconciliation of financial transactions.

Bank accounts live on the left. Each has a name of its own, which is all the app shows for it; the
bank it is at is one of its details, with the branch, number and holder. A photo, scan or PDF of
the passbook (通帳) dropped there is read by the model for the account on its cover (bank, branch,
account number, holder) and makes the account, or completes one with that number; its rows are
never read. The bank's CSV or Excel
export is what the rows come from: dropping one asks which account it belongs to (or makes a new one), then
the model reads it into rows on the ledger, in parts of about a hundred rows so nothing is lost;
it never touches the account's details, which are typed in or come from the passbook. Neither
file is kept: it is uploaded to be read and removed once the result is in. A read can be
called off while it runs, and a page reloaded mid-read picks it up again (the server runs the
model once per file and lets a second asker join). Receipts on the right are uploaded as images
or PDFs, kept, read by OCR, and matched to the rows. The ledger shows one account (or all of
them) and one month at a time.


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
├── state.json                 banks, transactions, receipts, matches
└── uploads/<unix ms>/         one folder per receipt (a statement is here only while being read)
    ├── <original file name>   byte-identical upload
    ├── meta.json
    ├── thumbnail.webp         images only
    └── ocr.json               raw model output, once it has run
```

CSV statements may be Shift_JIS or UTF-8 (with or without a BOM); the server decodes them and
hands the text to the model with the account's columns left for it to work out. Excel statements
(.xlsx, .xls) are turned into the same text first, sheet by sheet, with dates written out as
YYYY-MM-DD and amounts as plain numbers.
