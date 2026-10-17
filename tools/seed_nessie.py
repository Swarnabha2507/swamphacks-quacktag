"""Creates the SwampTag demo account in Capital One's Nessie API.

    python tools/seed_nessie.py          # first time
    python tools/seed_nessie.py --fresh  # create a brand-new set of demo data

Needs NESSIE_API_KEY in .env. Writes the created IDs to nessie_ids.json, which
server.py hands to the dashboard.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402  (reuses the key loading and Nessie request helper)

HOME = {"lat": 29.6436, "lng": -82.3549}  # University of Florida
OPENING_BALANCE = 2450  # Nessie stores whole dollars

CUSTOMER = {
    "first_name": "Albert", "last_name": "Gator",
    "address": {"street_number": "1765", "street_name": "Stadium Rd", "city": "Gainesville", "state": "FL", "zip": "32611"},
}

FRIENDS = [
    ("Diego", "Brss", "DI"),
    ("Swarnabha", "Chakrabarty", "SW"),
    ("Angel", "Gator", "AN"),
]

# role "store" shows up under Pay in store; role "fraud" is used by Simulate fraud.
MERCHANTS = [
    {"key": "publix", "name": "Publix Super Market", "initials": "PX", "place": "Gainesville, FL", "category": "Grocery",
     "lat": 29.6524, "lng": -82.3410, "amount": 42, "role": "store",
     "address": {"street_number": "1250", "street_name": "W University Ave", "city": "Gainesville", "state": "FL", "zip": "32601"}},
    {"key": "starbucks", "name": "Starbucks · Reitz Union", "initials": "SB", "place": "UF campus", "category": "Coffee",
     "lat": 29.6463, "lng": -82.3478, "amount": 6, "role": "store",
     "address": {"street_number": "655", "street_name": "Reitz Union Dr", "city": "Gainesville", "state": "FL", "zip": "32611"}},
    {"key": "chipotle", "name": "Chipotle", "initials": "CH", "place": "W University Ave", "category": "Restaurant",
     "lat": 29.6519, "lng": -82.3389, "amount": 14, "role": "store",
     "address": {"street_number": "1502", "street_name": "W University Ave", "city": "Gainesville", "state": "FL", "zip": "32603"}},
    {"key": "bookstore", "name": "UF Bookstore", "initials": "UF", "place": "UF campus", "category": "Books",
     "lat": 29.6467, "lng": -82.3477, "amount": 90, "role": "store",
     "address": {"street_number": "1", "street_name": "Museum Rd", "city": "Gainesville", "state": "FL", "zip": "32611"}},
    {"key": "quickfuel", "name": "QuickFuel Gas #2291", "initials": "QF", "place": "Orlando, FL", "category": "Gas",
     "lat": 28.5384, "lng": -81.3789, "amount": 390, "role": "fraud",
     "address": {"street_number": "400", "street_name": "S Orange Ave", "city": "Orlando", "state": "FL", "zip": "32801"}},
    {"key": "sunshine", "name": "Sunshine Electronics", "initials": "SE", "place": "Miami, FL", "category": "Electronics",
     "lat": 25.7617, "lng": -80.1918, "amount": 1249, "role": "fraud",
     "address": {"street_number": "100", "street_name": "Biscayne Blvd", "city": "Miami", "state": "FL", "zip": "33132"}},
]

# Past purchases that make Publix and Starbucks "known merchants" for the risk check.
HISTORY = [
    ("publix", 54, 12), ("starbucks", 6, 10), ("publix", 38, 8), ("starbucks", 7, 6),
    ("starbucks", 5, 4), ("publix", 62, 2), ("starbucks", 6, 1),
]

BILLS = [
    {"payee": "Sweetwater Apartments", "nickname": "Rent", "payment_amount": 725, "days_until_due": 16},
    {"payee": "Duke Energy", "nickname": "Electric", "payment_amount": 64, "days_until_due": 5},
]


def day(offset):
    return (date.today() + timedelta(days=offset)).isoformat()


def post(path, body):
    status, data = server.nessie_request("POST", path, body)
    if status not in (200, 201):
        sys.exit(f"\nNessie refused POST /{path} (HTTP {status}):\n{json.dumps(data, indent=2)}\nBody sent:\n{json.dumps(body, indent=2)}")
    created = data.get("objectCreated", data) if isinstance(data, dict) else {}
    return created.get("_id")


def main():
    if not server.API_KEY:
        sys.exit("No NESSIE_API_KEY found. Copy .env.example to .env and paste your key.")
    if server.IDS_FILE.exists() and "--fresh" not in sys.argv:
        sys.exit(f"{server.IDS_FILE.name} already exists. Run with --fresh to create a new set of demo data.")

    try:
        status, _ = server.nessie_request("GET", "customers")
    except OSError as err:
        sys.exit(f"Can't reach Nessie at {server.NESSIE_BASE}: {err}")
    if status != 200:
        sys.exit(f"Nessie returned HTTP {status} for GET /customers. Is the API key right?")

    print("Creating Albert Gator and his checking account...")
    customer_id = post("customers", CUSTOMER)
    account_id = post(f"customers/{customer_id}/accounts",
                      {"type": "Checking", "nickname": "SwampTag Checking", "rewards": 0, "balance": OPENING_BALANCE})

    print("Creating friends for peer-to-peer transfers...")
    contacts = []
    for first, last, initials in FRIENDS:
        cid = post("customers", {"first_name": first, "last_name": last, "address": CUSTOMER["address"]})
        aid = post(f"customers/{cid}/accounts",
                   {"type": "Checking", "nickname": f"{first}'s Checking", "rewards": 0, "balance": 1000})
        contacts.append({"name": f"{first} {last}", "initials": initials, "customerId": cid, "accountId": aid})

    print("Creating merchants with map locations...")
    merchants = []
    for m in MERCHANTS:
        mid = post("merchants", {"name": m["name"], "category": m["category"], "address": m["address"],
                                 "geocode": {"lat": m["lat"], "lng": m["lng"]}})
        merchants.append({"id": mid, **{k: m[k] for k in ("key", "name", "initials", "place", "lat", "lng", "amount", "role")}})
    by_key = {m["key"]: m for m in merchants}

    print("Adding purchase history...")
    for key, amount, days_ago in HISTORY:
        post(f"accounts/{account_id}/purchases", {
            "merchant_id": by_key[key]["id"], "medium": "balance", "purchase_date": day(-days_ago),
            "status": "completed", "amount": amount, "description": "Card purchase",
        })

    # Nessie transfers have no payee field, so P2P = transfer out of the sender + deposit into the receiver.
    print("Adding a P2P payment from Diego...")
    jordan = contacts[0]
    post(f"accounts/{jordan['accountId']}/transfers", {
        "transaction_date": day(-1), "status": "completed", "amount": 40,
        "description": "SwampTag verified · To Albert Gator · Dinner split",
    })
    post(f"accounts/{account_id}/deposits", {
        "medium": "balance", "transaction_date": day(-1), "status": "completed", "amount": 40,
        "description": f"From {jordan['name']} · Dinner split",
    })

    print("Adding upcoming bills...")
    for b in BILLS:
        post(f"accounts/{account_id}/bills", {
            "status": "pending", "payee": b["payee"], "nickname": b["nickname"],
            "payment_date": day(b["days_until_due"]), "payment_amount": b["payment_amount"],
            # Nessie can only read bills back when recurring_date is set.
            "recurring_date": int(day(b["days_until_due"])[-2:]),
        })

    ids = {
        "customerId": customer_id,
        "accountId": account_id,
        "openingBalance": OPENING_BALANCE,
        "home": HOME,
        "contacts": contacts,
        "merchants": merchants,
    }
    server.IDS_FILE.write_text(json.dumps(ids, indent=2), encoding="utf-8")
    print(f"\nDone. Saved IDs to {server.IDS_FILE.name}.")
    print(f"Customer {customer_id}, account {account_id}")
    print("Now run: python server.py")


if __name__ == "__main__":
    main()
