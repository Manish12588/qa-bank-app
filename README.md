# QABank

[![Promotion pipeline](https://github.com/Manish12588/qa-bank-app/actions/workflows/promotion.yml/badge.svg)](https://github.com/Manish12588/qa-bank-app/actions/workflows/promotion.yml)
&nbsp;[Latest test report](https://manish12588.github.io/qa-bank-app/latest/) · [Test suite](https://github.com/Manish12588/qa-bank-app-test) · [CI/CD](#cicd)

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

To use another host port, set `APP_PORT` (the app still listens on 8080 inside the container):

```bash
APP_PORT=8081 docker compose up -d --build --wait
```

## Design decision: no OAuth

Deliberately not implemented. Session-cookie auth (what's here) needs no third-party identity provider or mock IdP, and is simpler and more reliable to automate than an OAuth redirect flow, none of which a demo banking app needs to be realistic.

## Auth model

Session-based via an `httpOnly` cookie (`session`), set on register/login, cleared on logout. Every account/transaction endpoint requires it. Calling them without a valid session returns `401`.

## API reference

| Method | Path                                           | Body                                                                                               | Notes                                                                                                                             |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/register`                                | `firstName, lastName, username, password` (+ optional `address, city, state, zipCode, phone, ssn`) | Creates customer + one CHECKING account, balance **1000.00**. Logs in automatically. `409` if username taken.                     |
| POST   | `/api/login`                                   | `username, password`                                                                               | `400` on bad credentials.                                                                                                         |
| POST   | `/api/logout`                                  | —                                                                                                  | Clears the session.                                                                                                               |
| GET    | `/api/me`                                      | —                                                                                                  | Current logged-in customer. `401` if not logged in.                                                                               |
| GET    | `/api/accounts`                                | —                                                                                                  | All accounts for the logged-in customer.                                                                                          |
| POST   | `/api/accounts`                                | `type: "SAVINGS", fromAccountId`                                                                   | Opens a savings account, funded with **100.00** from the given account. `400` if insufficient funds.                              |
| GET    | `/api/accounts/:id/transactions?amount=&type=` | —                                                                                                  | Optional filters: exact `amount`, or `type` = `Debit` / `Credit` / `All`.                                                         |
| POST   | `/api/transfer`                                | `fromAccountId, toAccountId, amount`                                                               | Rejects: insufficient funds, negative/zero amount, >2 decimal places, same-account, unknown account.                              |
| POST   | `/api/billpay`                                 | `accountId, amount, payeeName`                                                                     | Rejects negative/zero amount and insufficient funds.                                                                              |
| POST   | `/api/loan`                                    | `amount, downPayment, fromAccountId`                                                               | Approved if `amount <= downPayment * 10` and the account can cover the down payment; otherwise `{approved: false}` (still `200`). |

All money-moving endpoints return the resulting balance(s) in the response, and `GET /api/accounts` always reflects the true current state.

## UI pages (plain HTML, real `name`/`id` attributes — no hidden JS-framework DOM)

`index.html` (landing page), `register.html`, `login.html`, `dashboard.html` (Accounts Overview), `openaccount.html`, `transfer.html`, `billpay.html`, `loan.html`, `findtrans.html`.

Dark fintech-style design (Poppins font via Google Fonts CDN, card-based layout). Every footer and the landing page nav link out to `/api-docs` (Swagger) and this project's GitHub/LinkedIn — useful if you're sharing this as a live demo rather than just a test target.

Every form field has a stable `id` matching its `name` (e.g. `#firstName`, `#username`, `#amount`, `#fromAccountId`), buttons have descriptive `id`s (`#registerButton`, `#transferButton`, `#sendPaymentButton`), and result/error regions have fixed `id`s (`#registerMessage`, `#transferError`, `#loanStatus`). The markup is intentionally minimal and the ids are authored deliberately for automation.

## Data is in-memory

Everything resets when the container restarts: no shared state and no admin defaults to track. Every fresh customer starts with exactly **1000.00** in checking, every time.

## CI/CD

The tests live in their own repo, [qa-bank-app-test](https://github.com/Manish12588/qa-bank-app-test): Playwright and TypeScript, 50 tests (31 API, 19 UI), every one described in its test plan. The pipeline lives here, so the app is tested before it is released.

### Promotion pipeline: DEV, QA, STAGE

Start it from **Actions → Promotion DEV - QA - STAGE → Run workflow** and choose how far it should go.

| Run up to | Stages that run     |
| --------- | ------------------- |
| DEV       | DEV                 |
| QA        | DEV, then QA        |
| STAGE     | DEV, QA, then STAGE |

| Stage | Tests                     | Notes                                   |
| ----- | ------------------------- | --------------------------------------- |
| DEV   | 10 smoke tests (`@smoke`) | Quick check that the core journeys work |
| QA    | All 50 tests              | Full regression                         |
| STAGE | The 10 smoke tests again  | Starts only after a manual approval     |

Each stage builds the app from this repo's `Dockerfile`, starts it with `docker compose up --wait` on that environment's port (the `APP_PORT` variable of the GitHub Environment), and runs the test repo against it. A stage only starts if the one before it passed.

The three environments are simulated. They run the same code from the same commit on the same kind of runner, and differ in configuration and in how much of the suite they run. There is no separate deployment behind them.

## See the pipeline catch a bug

`scripts/break-loan.sh` plants one deliberate bug: the loan limit changes from 10x to 11x the down payment. Run it on a branch and open a pull request. The `e2e` check goes red on one test, `LOAN-03 denies loan above the limit`.

```bash
git checkout -b demo-break-loan-limit
./scripts/break-loan.sh
git commit -am "Demo: break loan limit"
git push -u origin HEAD
```

Open a pull request into `main` and watch the `e2e` check fail. Close the pull request without merging, then delete the branch. `./scripts/fix-loan.sh` restores the original rule.

Pull requests never publish reports, so the Pages site keeps showing the last good run on `main`.

### Reports

Every run publishes its reports to GitHub Pages, whether it passed or failed:

- Newest run: https://manish12588.github.io/qa-bank-app/latest/
- A specific run: `https://manish12588.github.io/qa-bank-app/runs/<run id>/`

Each stage has its Playwright HTML report and a reportingLabs report. The run's summary page on GitHub shows the result of each stage.
