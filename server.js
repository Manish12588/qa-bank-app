const express = require("express");
const cookieParser = require("cookie-parser");
const { v4: uuid } = require("uuid");
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------- API docs (Swagger UI), served from the OpenAPI spec ----------
const openapiDoc = yaml.load(fs.readFileSync(path.join(__dirname, "openapi.yaml"), "utf8"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDoc, { customSiteTitle: "QABank API Docs" }));

const PORT = process.env.PORT || 8080;

// ---------- in-memory "database" ----------
// reset automatically every time the container restarts
let nextCustomerId = 1000;
let nextAccountId = 5000;
let nextTxnId = 9000;

const customers = new Map(); // customerId -> { firstName, lastName, username, password, ssn, phone, address... }
const usernames = new Map(); // username -> customerId
const accounts = new Map(); // accountId -> { id, customerId, type, balance }
const transactions = new Map(); // accountId -> [ { id, type, amount, description, date } ]
const sessions = new Map(); // token -> customerId

const INITIAL_BALANCE = 1000.0;
const SAVINGS_FUNDING = 100.0;

function newAccount(customerId, type, balance) {
  const id = nextAccountId++;
  accounts.set(id, { id, customerId, type, balance });
  transactions.set(id, []);
  return accounts.get(id);
}

function addTxn(accountId, type, amount, description) {
  const txn = { id: nextTxnId++, accountId, type, amount, description, date: Date.now() };
  transactions.get(accountId).push(txn);
  return txn;
}

function customerAccounts(customerId) {
  return [...accounts.values()].filter((a) => a.customerId === customerId);
}

function getSessionCustomer(req) {
  const token = req.cookies.session;
  if (!token || !sessions.has(token)) return null;
  const customerId = sessions.get(token);
  return customers.get(customerId) ? customerId : null;
}

function requireAuth(req, res, next) {
  const customerId = getSessionCustomer(req);
  if (!customerId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  req.customerId = customerId;
  next();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------- Auth ----------

app.post("/api/register", (req, res) => {
  const { firstName, lastName, username, password, phone, ssn, address, city, state, zipCode } = req.body;

  const missing = [];
  if (!firstName) missing.push("firstName");
  if (!lastName) missing.push("lastName");
  if (!username) missing.push("username");
  if (!password) missing.push("password");
  if (missing.length) {
    return res.status(400).json({ error: "Missing required fields", fields: missing });
  }
  if (usernames.has(username)) {
    return res.status(409).json({ error: "This username already exists." });
  }

  const customerId = nextCustomerId++;
  customers.set(customerId, {
    id: customerId,
    firstName,
    lastName,
    username,
    password,
    phone: phone || "",
    ssn: ssn || "",
    address: address || "",
    city: city || "",
    state: state || "",
    zipCode: zipCode || "",
  });
  usernames.set(username, customerId);

  const checking = newAccount(customerId, "CHECKING", INITIAL_BALANCE);

  const token = uuid();
  sessions.set(token, customerId);
  res.cookie("session", token, { httpOnly: true });

  res.status(201).json({ customerId, username, checkingAccountId: checking.id });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const customerId = usernames.get(username);
  const customer = customerId ? customers.get(customerId) : null;

  if (!customer || customer.password !== password) {
    return res.status(400).json({ error: "Invalid username and/or password" });
  }

  const token = uuid();
  sessions.set(token, customerId);
  res.cookie("session", token, { httpOnly: true });
  res.json({ customerId, firstName: customer.firstName, lastName: customer.lastName, username: customer.username });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies.session;
  if (token) sessions.delete(token);
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const c = customers.get(req.customerId);
  res.json({ customerId: c.id, firstName: c.firstName, lastName: c.lastName, username: c.username });
});

// ---------- Accounts ----------

app.get("/api/accounts", requireAuth, (req, res) => {
  res.json(customerAccounts(req.customerId));
});

app.post("/api/accounts", requireAuth, (req, res) => {
  const { type, fromAccountId } = req.body;
  if (type !== "SAVINGS") {
    return res.status(400).json({ error: "Only SAVINGS can be opened (CHECKING is created at registration)" });
  }
  const from = accounts.get(Number(fromAccountId));
  if (!from || from.customerId !== req.customerId) {
    return res.status(400).json({ error: "Invalid funding account" });
  }
  if (from.balance < SAVINGS_FUNDING) {
    return res.status(400).json({ error: "Insufficient funds to open a new account" });
  }

  from.balance = round2(from.balance - SAVINGS_FUNDING);
  addTxn(from.id, "Debit", SAVINGS_FUNDING, "New Account Funding");

  const savings = newAccount(req.customerId, "SAVINGS", SAVINGS_FUNDING);
  addTxn(savings.id, "Credit", SAVINGS_FUNDING, "New Account Funding");

  res.status(201).json(savings);
});

app.get("/api/accounts/:id/transactions", requireAuth, (req, res) => {
  const accountId = Number(req.params.id);
  const account = accounts.get(accountId);
  if (!account || account.customerId !== req.customerId) {
    return res.status(404).json({ error: "Account not found" });
  }
  let results = transactions.get(accountId) || [];

  const { amount, type } = req.query;
  if (amount !== undefined) {
    const amt = Number(amount);
    results = results.filter((t) => t.amount === amt);
  }
  if (type && type !== "All") {
    results = results.filter((t) => t.type === type);
  }
  res.json(results);
});

// ---------- Transfers ----------

app.post("/api/transfer", requireAuth, (req, res) => {
  const fromAccountId = Number(req.body.fromAccountId);
  const toAccountId = Number(req.body.toAccountId);
  const amount = Number(req.body.amount);

  const from = accounts.get(fromAccountId);
  const to = accounts.get(toAccountId);

  if (!from || from.customerId !== req.customerId) {
    return res.status(400).json({ error: "Source account not found" });
  }
  if (!to) {
    return res.status(400).json({ error: `Could not find account number ${fromAccountId} and/or ${toAccountId}` });
  }
  if (fromAccountId === toAccountId) {
    return res.status(400).json({ error: "Cannot transfer to the same account" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }
  if (Math.round(amount * 100) !== amount * 100) {
    return res.status(400).json({ error: "Amount cannot have more than two decimal places" });
  }
  if (amount > from.balance) {
    return res.status(400).json({ error: "Insufficient funds" });
  }

  from.balance = round2(from.balance - amount);
  to.balance = round2(to.balance + amount);
  addTxn(from.id, "Debit", amount, "Funds Transfer Sent");
  addTxn(to.id, "Credit", amount, "Funds Transfer Received");

  res.json({
    message: `$${amount.toFixed(2)} has been transferred from account #${fromAccountId} to account #${toAccountId}.`,
    fromBalance: from.balance,
    toBalance: to.balance,
  });
});

// ---------- Bill pay ----------

app.post("/api/billpay", requireAuth, (req, res) => {
  const accountId = Number(req.body.accountId);
  const amount = Number(req.body.amount);
  const payeeName = req.body.payeeName || "Payee";

  const account = accounts.get(accountId);
  if (!account || account.customerId !== req.customerId) {
    return res.status(400).json({ error: "Account not found" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }
  if (amount > account.balance) {
    return res.status(400).json({ error: "Insufficient funds" });
  }

  account.balance = round2(account.balance - amount);
  addTxn(account.id, "Debit", amount, `Bill Payment to ${payeeName}`);

  res.json({
    message: `Bill Payment to ${payeeName} in the amount of $${amount.toFixed(2)} from account #${accountId} was successful.`,
    payeeName,
    amount,
    accountId,
    balance: account.balance,
  });
});

// ---------- Loans ----------

app.post("/api/loan", requireAuth, (req, res) => {
  const amount = Number(req.body.amount);
  const downPayment = Number(req.body.downPayment);
  const fromAccountId = Number(req.body.fromAccountId);

  const from = accounts.get(fromAccountId);
  if (!from || from.customerId !== req.customerId) {
    return res.status(400).json({ error: "Account not found" });
  }
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(downPayment) || downPayment < 0) {
    return res.status(400).json({ error: "Invalid amount or down payment" });
  }
  if (downPayment > from.balance) {
    return res.status(200).json({ approved: false, message: "error.insufficient.funds", accountId: null });
  }

  // simple approval rule: approved if requested amount is no more than 10x the down payment
  const approved = amount <= downPayment * 10;

  if (!approved) {
    return res.json({ approved: false, message: "error.insufficient.funds", accountId: null });
  }

  from.balance = round2(from.balance - downPayment);
  addTxn(from.id, "Debit", downPayment, "Loan Down Payment");

  const loan = newAccount(req.customerId, "LOAN", amount);
  res.json({ approved: true, accountId: loan.id, amount, downPayment });
});

// ---------- Security check endpoint (intentionally requires auth, unlike ParaBank) ----------
// Demonstrates the CORRECT behavior for the defect ParaBank has (T16): no session, no data.

app.listen(PORT, () => {
  console.log(`QABank listening on port ${PORT}`);
});
