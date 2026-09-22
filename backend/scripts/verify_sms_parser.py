"""
Tests the M-Pesa SMS parser in app/routers/sms.py.

    python scripts/verify_sms_parser.py

Standalone on purpose — the project has no test runner and this needs none.
The parser is pure regex over a string, so it imports nothing from FastAPI or
the database.

Why this exists: the "received" pattern required the literal "KES " while
Safaricom commonly writes "Ksh1,000.00". Real confirmations could be rejected
as unrecognised_format while the Android app's built-in test message — written
in the one spelling that matched — passed, so testing the pipeline proved
nothing about the traffic it would actually see.
"""
import pathlib
import re
import sys

SRC = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "sms.py"

# Lift just the parser: everything between the amount pattern and the first
# route. Importing the module would drag in FastAPI, SQLAlchemy and the DB.
source = SRC.read_text(encoding="utf-8")
chunk = source[source.index("# Safaricom writes"):source.index("@router.post")]
namespace: dict = {"re": re}
exec(compile(chunk, str(SRC), "exec"), namespace)  # noqa: S102
parse = namespace["_parse_mpesa_sms"]

CASES = [
    # (label, body, expected code or None, expected amount or None)
    (
        "Ksh, no space — the common Safaricom form",
        "NLJ7RT61SV Confirmed. You have received Ksh1,000.00 from JOHN DOE 0712345678 "
        "on 3/5/26 at 10:00 AM New M-PESA balance is Ksh2,500.00.",
        "NLJ7RT61SV", 1000.00,
    ),
    (
        "KES with a space — the older form, must keep working",
        "QA12BC34DE confirmed. You have received KES 250.00 from TEST DEMO 0712000000 "
        "on 28/5/26 at 12:00 PM.",
        "QA12BC34DE", 250.00,
    ),
    (
        "the Android app's test message",
        "QA12BC34DE Confirmed. You have received Ksh250.00 from TEST DEMO 0712000000 "
        "on 28/5/26 at 12:00 PM. New M-Pesa balance is Ksh1,000.00. Transaction cost, Ksh0.00.",
        "QA12BC34DE", 250.00,
    ),
    (
        "masked sender number",
        "NLJ7RT61SV Confirmed. You have received Ksh1,500.50 from JANE W 0712***678 "
        "on 3/5/26 at 10:00 AM",
        "NLJ7RT61SV", 1500.50,
    ),
    (
        "254-prefixed sender number",
        "NLJ7RT61SV Confirmed. You have received Ksh750.00 from JANE W 254712345678 "
        "on 3/5/26 at 10:00 AM",
        "NLJ7RT61SV", 750.00,
    ),
    (
        "thousands separator and no decimals",
        "PQR1STU2VW Confirmed. You have received Ksh12,000 from BULK BUYER 0733111222 "
        "on 3/5/26 at 10:00 AM",
        "PQR1STU2VW", 12000.00,
    ),
    (
        "paid-to form, Ksh",
        "QB34CD56EF Confirmed. Ksh500.00 paid to DZELINE SHOP on 3/5/26 at 10:00 AM",
        "QB34CD56EF", 500.00,
    ),
    (
        "paid-to form, KES with a space",
        "QB34CD56EF Confirmed. KES 500.00 paid to DZELINE SHOP on 3/5/26 at 10:00 AM",
        "QB34CD56EF", 500.00,
    ),
    ("airtime message is not a payment", "Your airtime balance is Ksh50.00", None, None),
    ("promotional message is not a payment", "MPESA: Dial *334# for loans today!", None, None),
    ("empty body", "", None, None),
    (
        "code of the wrong length is not accepted",
        "SHORT1 Confirmed. You have received Ksh100.00 from A B 0712345678 on 3/5/26 at 10:00 AM",
        None, None,
    ),
]


def main() -> int:
    failures = 0
    for label, body, want_code, want_amount in CASES:
        got = parse(body)
        if want_code is None:
            ok = got is None
            detail = "rejected" if ok else f"unexpectedly parsed as {got}"
        else:
            ok = (
                got is not None
                and got["confirmation_code"] == want_code
                and abs(got["amount"] - want_amount) < 0.005
            )
            detail = (
                f"{got['confirmation_code']} {got['amount']}" if got else "did not parse"
            )
        failures += not ok
        print(f"{'  ok  ' if ok else '  FAIL'}  {label:46} -> {detail}")

    print()
    print("All SMS parser cases pass." if not failures else f"{failures} case(s) failed.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
