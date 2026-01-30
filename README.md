# Rifa Dashboard

Minimal raffle sales control system with seller logins, number locking (reservations), and a superuser dashboard.

## Features
- Seller login with role-based access
- Seller dashboard showing total sales, active reservations, and number selection (1-100000)
- Search by number and lock reserved numbers to prevent duplicates
- Buyer info captured per number
- Superuser dashboard for totals, per-seller stats, recent sales, and audit log
- Full audit log page with filters (action, actor, seller, number, date)
- Superuser creates seller accounts
- Audit log for edits, voids, reservations, and releases

## Tech
- Python + Flask
- SQLite (stored in `instance/raffle.db`)

## Setup
1) Create a virtual environment and install dependencies:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

2) Set environment variables for the first run (to bootstrap the superuser):

```bash
export SECRET_KEY="casamentoguto"
export SUPERUSER_USENAME="guto"
export SUPERUSER_PASSWORD="casamento"
```

Notes:
- `SUPERUSER_USENAME` is supported as an alias for `SUPERUSER_USERNAME`.
- If you do not set env variables, defaults are `SECRET_KEY=casamentoguto`, `SUPERUSER_USENAME=guto`, `SUPERUSER_PASSWORD=casamento`.
- The superuser is created on first run if none exists and username/password are available (defaults count).

3) Run the app:

```bash
python app.py
```

4) Visit `http://127.0.0.1:5000` and log in with the superuser.

## Workflow
- Superuser creates seller accounts from the admin screen.
- Sellers can reserve numbers (15 minutes) or complete a sale with buyer info.
- Admin can edit or void sales; sellers can edit/void their own sales.
