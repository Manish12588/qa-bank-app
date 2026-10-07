# QABank

A small, self-contained demo banking app (REST API + server-rendered HTML UI) built specifically to be a stable, controllable target for Playwright test automation. No external dependencies besides Docker — no flaky third-party site, no shared state with other users, resets clean on every container restart.

## Run it

```bash
docker compose up -d --wait
```

Then:
- **http://localhost:8080** — landing page
- **http://localhost:8080/register.html** — jump straight to registration
- **http://localhost:8080/api-docs** — full interactive Swagger / OpenAPI docs for every endpoint (built from `openapi.yaml`, with request/response schemas and examples — use the "Try it out" button to call the API directly from the browser)
- **http://localhost:8080/api/...** — the API itself

Stop it with `docker compose down`.

## Design decision: no OAuth

Deliberately not implemented. Session-cookie auth (what's here) matches the rest of this portfolio's testing patterns, needs no third-party identity provider or mock IdP, and is simpler and more reliable to automate than an OAuth redirect flow — none of which a demo banking app actually needs to be realistic.

## Why this exists

ParaBank (the usual demo banking app for this kind of portfolio project) has real, interesting defects — overdraft acceptance, no idempotency, a concurrency bug in registration — which made for good test-automation *material*, but it also meant fighting an app that behaves unpredictably under things like parallel workers, and the public instance (`parabank.parasoft.com`) is shared and resets, so tests against it are inherently flaky for reasons that have nothing to do with your test code.

QABank is **deliberately correct** — it rejects overdrafts, negative amounts, same-account transfers, duplicate usernames, and revokes access on logout. It's a clean target: when a test fails here, it's your test or your code, not the app under test.

## Auth model

Session-based via an `httpOnly` cookie (`session`), set on register/login, cleared on logout. Every account/transaction endpoint requires it — calling them without a valid session returns `401`. (This is the *correct* version of the access-control issue documented as a defect on the ParaBank side of this portfolio — worth mentioning in an interview as "I also built a reference implementation showing the correct behavior.")

## API reference

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/register` | `firstName, lastName, username, password` (+ optional `address, city, state, zipCode, phone, ssn`) | Creates customer + one CHECKING account, balance **1000.00**. Logs in automatically. `409` if username taken. |
| POST | `/api/login` | `username, password` | `400` on bad credentials. |
| POST | `/api/logout` | — | Clears the session. |
| GET | `/api/me` | — | Current logged-in customer. `401` if not logged in. |
| GET | `/api/accounts` | — | All accounts for the logged-in customer. |
| POST | `/api/accounts` | `type: "SAVINGS", fromAccountId` | Opens a savings account, funded with **100.00** from the given account. `400` if insufficient funds. |
| GET | `/api/accounts/:id/transactions?amount=&type=` | — | Optional filters: exact `amount`, or `type` = `Debit` / `Credit` / `All`. |
| POST | `/api/transfer` | `fromAccountId, toAccountId, amount` | Rejects: insufficient funds, negative/zero amount, >2 decimal places, same-account, unknown account. |
| POST | `/api/billpay` | `accountId, amount, payeeName` | Rejects negative/zero amount and insufficient funds. |
| POST | `/api/loan` | `amount, downPayment, fromAccountId` | Approved if `amount <= downPayment * 10` and the account can cover the down payment; otherwise `{approved: false}` (still `200`, matching ParaBank's loan response shape, so existing loan tests need minimal changes if you're porting them). |

All money-moving endpoints return the resulting balance(s) in the response, and `GET /api/accounts` always reflects true current state — no need to guess at timing the way the ParaBank "create account shows balance 0" quirk required.

## UI pages (plain HTML, real `name`/`id` attributes — no hidden JS-framework DOM)

`index.html` (landing page), `register.html`, `login.html`, `dashboard.html` (Accounts Overview), `openaccount.html`, `transfer.html`, `billpay.html`, `loan.html`, `findtrans.html`.

Dark fintech-style design (Poppins font via Google Fonts CDN, card-based layout). Every footer and the landing page nav link out to `/api-docs` (Swagger) and this project's GitHub/LinkedIn — useful if you're sharing this as a live demo rather than just a test target.

Every form field has a stable `id` matching its `name` (e.g. `#firstName`, `#username`, `#amount`, `#fromAccountId`), buttons have descriptive `id`s (`#registerButton`, `#transferButton`, `#sendPaymentButton`), and result/error regions have fixed `id`s (`#registerMessage`, `#transferError`, `#loanStatus`) — all the DOM-inspection chasing from the ParaBank registration/account-number debugging should be unnecessary here, since the markup is intentionally minimal and the ids are authored deliberately for automation rather than reverse-engineered from a legacy app.

## Data is in-memory

Everything resets when the container restarts — no shared state, no admin panel defaults to track, no "what's the current Init. Balance" guesswork like ParaBank required. Every fresh customer starts with exactly **1000.00** in checking, every time.

## Porting your existing Playwright suite

The shape is close enough to ParaBank that most of your existing structure (fixtures, `ApiHelper`, page objects) carries over with: updated base URL (`http://localhost:8080`, no `/parabank` prefix, no `/services/bank/` split — one `baseURL` works for both API and UI here since the app is simpler), updated field/selector names per the table above, and updated expected balances (1000 / 100 instead of 515.50 / 100). Your `test.fail()` defect tests won't carry over as-is, since those scenarios are now correctly rejected — they'd need rewriting as plain positive assertions (rejection *is* the expected behavior now, not a documented bug).
