const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const app = express();

/* ================================
   ENVIRONMENT CONFIG
================================ */

const PORT = process.env.PORT || 3000;

const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bitrewards";

const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const TELEGRAM_USERNAME = process.env.TELEGRAM_USERNAME || "YOUR_TELEGRAM_ID";

/* ================================
   LOAD LANGUAGES
================================ */

const languages = {
  en: JSON.parse(
    fs.readFileSync(path.join(__dirname, "locales/en.json"), "utf8"),
  ),
  cs: JSON.parse(
    fs.readFileSync(path.join(__dirname, "locales/cs.json"), "utf8"),
  ),
  hr: JSON.parse(
    fs.readFileSync(path.join(__dirname, "locales/hr.json"), "utf8"),
  ),
  hu: JSON.parse(
    fs.readFileSync(path.join(__dirname, "locales/hu.json"), "utf8"),
  ),
};

/* ================================
   MIDDLEWARE
================================ */

app.set("trust proxy", 1); // required for Railway / proxies

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.set("view engine", "ejs");

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // set true only if forcing HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  }),
);

/* ================================
   LANGUAGE MIDDLEWARE
================================ */

app.use((req, res, next) => {
  const langCode = req.cookies.lang || "en";
  res.locals.lang = langCode;
  res.locals.t = languages[langCode] || languages["en"];
  next();
});

app.use((req, res, next) => {
  res.locals.telegramUser = TELEGRAM_USERNAME;
  next();
});

/* ================================
   DATABASE CONNECTION
================================ */

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

/* ================================
   MODELS
================================ */

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0.0 },
  isAdmin: { type: Boolean, default: false },
});

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, default: "withdrawal" },
  amount: Number,
  vatFee: Number,
  method: String,
  details: String,
  status: { type: String, default: "Pending" },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);

/* ================================
   SEED ADMIN (SAFE)
================================ */

async function seedAdmin() {
  try {
    const adminExists = await User.findOne({ username: "admin" });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await User.create({
        username: "admin",
        password: hashedPassword,
        isAdmin: true,
        balance: 0,
      });
      console.log("✅ Admin account created");
    }
  } catch (err) {
    console.error("Admin seed error:", err);
  }
}
seedAdmin();

/* ================================
   AUTH MIDDLEWARE
================================ */

const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  const user = await User.findById(req.session.userId);
  if (!user || !user.isAdmin) return res.redirect("/dashboard");
  next();
};

/* ================================
   ROUTES
================================ */

// Language switch
app.get("/set-lang/:code", (req, res) => {
  const code = req.params.code;
  if (["en", "cs", "hr", "hu"].includes(code)) {
    res.cookie("lang", code, { maxAge: 900000000, path: "/" });
  }
  res.redirect(req.get("referer") || "/dashboard");
});

// Auth
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.userId = user._id;
      return user.isAdmin ? res.redirect("/admin") : res.redirect("/dashboard");
    }

    res.render("login", { error: "Invalid credentials" });
  } catch (err) {
    res.render("login", { error: "Login error" });
  }
});

app.get("/register", (req, res) => res.render("register"));

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username,
      password: hashedPassword,
    });

    req.session.userId = newUser._id;
    res.redirect("/dashboard");
  } catch (e) {
    res.render("register", { error: "Username taken" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* ================================
   USER PAGES
================================ */

app.get("/dashboard", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const transactions = await Transaction.find({ userId: user._id }).sort({
    date: -1,
  });
  res.render("dashboard", { user, transactions });
});

app.get("/invest", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render("invest", { user });
});

app.get("/rewards", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render("rewards", { user });
});

app.get("/about-us", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render("about-us", { user });
});

/* ================================
   WITHDRAWAL
================================ */

app.get("/withdraw", requireLogin, (req, res) => res.render("withdraw"));

app.post("/withdraw/confirm", requireLogin, async (req, res) => {
  try {
    const { amount, method, details } = req.body;
    const user = await User.findById(req.session.userId);

    if (!amount || isNaN(amount)) return res.send("Invalid Amount");

    const parsedAmount = parseFloat(amount);

    if (parsedAmount > user.balance)
      return res.send(
        `Insufficient funds. Balance: €${user.balance.toFixed(2)}`,
      );

    const vat = parseFloat((parsedAmount * 0.075).toFixed(2));

    const newTx = await Transaction.create({
      userId: user._id,
      amount: parsedAmount,
      vatFee: vat,
      method,
      details,
    });

    res.redirect(`/invoice/${newTx._id}`);
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.send("Withdrawal failed. Try again.");
  }
});

app.get("/invoice/:id", requireLogin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id).populate("userId");
    if (!tx) return res.redirect("/dashboard");
    res.render("invoice", { tx });
  } catch {
    res.redirect("/dashboard");
  }
});

/* ================================
   ADMIN
================================ */

app.get("/admin", requireAdmin, async (req, res) => {
  const users = await User.find({ isAdmin: false });
  const transactions = await Transaction.find()
    .populate("userId")
    .sort({ date: -1 });

  res.render("admin", { users, transactions });
});

app.post("/admin/balance", requireAdmin, async (req, res) => {
  await User.findByIdAndUpdate(req.body.userId, {
    balance: parseFloat(req.body.newBalance),
  });
  res.redirect("/admin");
});

app.post("/admin/approve", requireAdmin, async (req, res) => {
  const { txId, action } = req.body;
  const tx = await Transaction.findById(txId);

  if (!tx) return res.redirect("/admin");

  if (action === "approve") {
    const user = await User.findById(tx.userId);

    if (user.balance >= tx.amount) {
      user.balance -= tx.amount;
      await user.save();
      tx.status = "Approved";
    } else {
      tx.status = "Failed (Insufficient Funds)";
    }
  } else {
    tx.status = "Rejected";
  }

  await tx.save();
  res.redirect("/admin");
});

/* ================================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
