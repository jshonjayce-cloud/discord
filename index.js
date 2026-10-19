const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const { SlashCommandBuilder } = require("@discordjs/builders");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

// ==================== CONFIG ====================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";
const MAIN_ROLE_ID = "1552637429456961657";
const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const LOADER_URL =
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
const PANEL_COLOR = 0xff7518;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMITS = new Map();

// ==================== DISCORD CLIENT ====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ==================== EXPRESS SERVER ====================
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

function appendLog(action, details = {}) {
  db.logs.push({
    timestamp: new Date().toISOString(),
    action,
    ...details,
  });

  if (db.logs.length > 2000) {
    db.logs = db.logs.slice(-2000);
  }

  saveDatabase();
}

function isRateLimited(userId, action, limitMs = RATE_LIMIT_WINDOW_MS, maxCalls = 3) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const entries = RATE_LIMITS.get(key) || [];
  const current = entries.filter((ts) => now - ts < limitMs);

  if (current.length >= maxCalls) {
    RATE_LIMITS.set(key, current);
    return true;
  }

  current.push(now);
  RATE_LIMITS.set(key, current);
  return false;
}

function isValidUsername(username) {
  return typeof username === "string" && /^[A-Za-z0-9_]{3,20}$/.test(username.trim());
}

function isValidPassword(password) {
  return typeof password === "string" && password.trim().length >= 6;
}

app.get("/", (_req, res) => {
  res.status(200).send("🎃 Jayce Main is running! 🦇");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "online",
    bot: "Jayce Main",
    discord: client.isReady(),
  });
});

app.get("/logs", (_req, res) => {
  res.status(200).json({
    ok: true,
    logs: db.logs.slice(-50),
  });
});

app.get("/keys/:key", (req, res) => {
  const key = req.params.key;
  const entry = db.keys[key];

  if (!entry) {
    return res.status(404).json({ ok: false, error: "Key not found." });
  }

  return res.status(200).json({
    ok: true,
    key,
    userId: entry.userId,
    redeemed: Boolean(entry.redeemed),
    revoked: Boolean(entry.revoked),
    hwid: entry.hwid || null,
    createdAt: entry.createdAt || null,
    redeemedAt: entry.redeemedAt || null,
  });
});

app.post("/keys/:key/reset-hwid", (req, res) => {
  const key = req.params.key;
  const { userId, staffId } = req.body || {};
  const entry = db.keys[key];

  if (!entry) {
    return res.status(404).json({ ok: false, error: "Key not found." });
  }

  if (userId && entry.userId !== String(userId)) {
    return res.status(403).json({
      ok: false,
      error: "Key does not belong to the submitted userId.",
    });
  }

  delete entry.hwid;
  entry.redeemed = false;
  entry.revoked = false;

  appendLog("hwid_reset", {
    key,
    userId: entry.userId,
    staffId: staffId || null,
  });

  saveDatabase();
  return res.status(200).json({ ok: true, message: "HWID reset for key." });
});

app.post("/redeem", (req, res) => {
  const { key, userId, hwid } = req.body || {};

  if (!key || !userId || !hwid) {
    return res.status(400).json({
      ok: false,
      error: "Missing key, userId, or hwid.",
    });
  }

  const entry = db.keys[key];
  if (!entry) {
    return res.status(404).json({ ok: false, error: "Invalid key." });
  }

  if (String(entry.userId) !== String(userId)) {
    return res.status(403).json({
      ok: false,
      error: "This key does not belong to this user.",
    });
  }

  if (entry.revoked) {
    return res.status(403).json({ ok: false, error: "This key has been revoked." });
  }

  if (entry.redeemed && entry.hwid && entry.hwid !== hwid) {
    appendLog("hwid_mismatch", {
      key,
      userId,
      submittedHwid: String(hwid),
      storedHwid: String(entry.hwid),
    });

    return res.status(403).json({
      ok: false,
      error: "HWID mismatch. Contact staff for a reset.",
    });
  }

  if (!entry.hwid) {
    entry.hwid = String(hwid);
  }

  entry.redeemed = true;
  entry.redeemedAt = new Date().toISOString();
  db.access[userId] = true;

  appendLog("key_redeem", {
    key,
    userId,
    hwid: String(hwid),
  });

  saveDatabase();

  return res.status(200).json({
    ok: true,
    message: "Key redeemed successfully.",
    hwidBound: true,
  });
});

// Client-facing redeem endpoint: accepts { username, key, hwid }
app.post("/client/redeem", (req, res) => {
  const { username, key, hwid } = req.body || {};

  if (!username || !key || !hwid) {
    return res.status(400).json({ ok: false, error: "Missing username, key, or hwid." });
  }

  // Find account by Roblox username (case-insensitive)
  const accountEntry = Object.entries(db.accounts).find(
    ([userId, account]) =>
      account &&
      typeof account.username === "string" &&
      account.username.toLowerCase() === String(username).toLowerCase()
  );

  if (!accountEntry) {
    return res.status(404).json({ ok: false, error: "No account found for that Roblox username." });
  }

  const [userId, account] = accountEntry;

  const keyEntry = db.keys[key];

  if (!keyEntry) {
    return res.status(404).json({ ok: false, error: "Invalid key." });
  }

  // Ensure the key belongs to the same Discord user that owns the Roblox account
  if (String(keyEntry.userId) !== String(userId)) {
    return res.status(403).json({ ok: false, error: "This key does not belong to that Roblox account." });
  }

  if (keyEntry.revoked) {
    return res.status(403).json({ ok: false, error: "This key has been revoked." });
  }

  // HWID mismatch handling (same semantics as /redeem)
  if (keyEntry.redeemed && keyEntry.hwid && String(keyEntry.hwid) !== String(hwid)) {
    appendLog("hwid_mismatch_client", {
      key,
      userId,
      submittedHwid: String(hwid),
      storedHwid: String(keyEntry.hwid),
    });

    return res.status(403).json({ ok: false, error: "HWID mismatch. Contact staff for a reset." });
  }

  // Bind the HWID if not already set
  if (!keyEntry.hwid) {
    keyEntry.hwid = String(hwid);
  }

  keyEntry.redeemed = true;
  keyEntry.redeemedAt = new Date().toISOString();
  db.access[userId] = true;

  appendLog("client_key_redeem", {
    key,
    userId,
    hwid: String(hwid),
  });

  saveDatabase();

  // Return the loader URL (client decides how to use it)
  return res.status(200).json({
    ok: true,
    message: "Key redeemed successfully.",
    loaderUrl: LOADER_URL,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WEB] Listening on port ${PORT}`);
});

// ==================== KEEP-ALIVE PINGS ====================
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;

if (KEEP_ALIVE_URL) {
  const { URL } = require("url");
  const http = require("http");
  const https = require("https");

  function pingKeepAlive() {
    try {
      const urlObj = new URL(KEEP_ALIVE_URL);
      const lib = urlObj.protocol === "http:" ? http : https;

      const req = lib.get(KEEP_ALIVE_URL, (res) => {
        res.on("data", () => {});
        res.on("end", () => {});
      });

      req.on("error", (err) => {
        console.error("[KEEPALIVE] Ping error:", err.message);
      });

      req.setTimeout(10_000, () => {
        req.abort();
      });
    } catch (err) {
      console.error("[KEEPALIVE] Invalid KEEP_ALIVE_URL:", err.message);
    }
  }

  const INTERVAL_MS = 4 * 60 * 1000;
  setInterval(pingKeepAlive, INTERVAL_MS);
  setTimeout(pingKeepAlive, 5_000);

  console.log(`[KEEPALIVE] Keep-alive pings enabled for ${KEEP_ALIVE_URL}`);
} else {
  console.log("[KEEPALIVE] KEEP_ALIVE_URL not set — no keep-alive pings will run.");
}

// ==================== DATABASE ====================
let db = {
  keys: {},
  blacklisted: {},
  hwids: {},
  accounts: {},
  access: {},
  logs: [],
};

function saveDatabase() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error("[DATABASE] Save error:", error);
  }
}

function loadDatabase() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(DB_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

      db = {
        keys: loaded.keys || {},
        blacklisted: loaded.blacklisted || {},
        hwids: loaded.hwids || {},
        accounts: loaded.accounts || {},
        access: loaded.access || {},
        logs: loaded.logs || [],
      };
    }

    if (!Array.isArray(db.logs)) {
      db.logs = [];
    }

    saveDatabase();
    console.log("[DATABASE] Loaded successfully.");
  } catch (error) {
    console.error("[DATABASE] Load error:", error);
  }
}

loadDatabase();

// ==================== HELPERS ====================
function isStaff(member) {
  return Boolean(member?.roles?.cache?.has(STAFF_ROLE_ID));
}

function isBlacklisted(userId) {
  return Boolean(db.blacklisted[userId]);
}

function accessEnabled(userId) {
  return db.access[userId] !== false;
}

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "🎃 jayce ♡ spooky & secure 🦇" })
    .setTimestamp();
}

function replyWithHeart(interaction, options) {
  if (
    typeof options.content === "string" &&
    !options.content.trimStart().startsWith("♡")
  ) {
    options.content = `♡ ${options.content}`;
  }

  if (Array.isArray(options.embeds)) {
    options.embeds = options.embeds.map((embed) => {
      const title = embed.data?.title;
      if (typeof title === "string" && !title.trimStart().startsWith("♡")) {
        embed.setTitle(`♡ ${title}`);
      }
      return embed;
    });
  }

  return interaction.reply(options);
}

function makeCode(length = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function makeKey() {
  let key;
  do {
    key = `JAYCE-${makeCode(20)}`;
  } while (db.keys[key]);
  return key;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(stored, password) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const hash = crypto.scryptSync(password, stored.salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(stored.hash, "hex")
    );
  } catch (e) {
    return false;
  }
}

async function getGuildMember(guild, userId) {
  if (!guild) return null;

  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function setScriptRoles(member, enabled, scriptType = "both") {
  const roleIds = [];

  if (scriptType === "main" || scriptType === "both") {
    roleIds.push(MAIN_ROLE_ID);
  }

  if (scriptType === "mobile" || scriptType === "both") {
    roleIds.push(MOBILE_MAIN_ROLE_ID);
  }

  for (const roleId of [...new Set(roleIds)]) {
    const role =
      member.guild.roles.cache.get(roleId) ||
      (await member.guild.roles.fetch(roleId).catch(() => null));

    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }

    if (enabled) {
      await member.roles.add(roleId);
    } else {
      await member.roles.remove(roleId);
    }
  }
}

async function sendScriptDM(user, scriptType) {
  const script = `loadstring(game:HttpGet("${LOADER_URL}"))()`;

  const embed = makeEmbed(
    scriptType === "mobile" ? "📱 Jayce Mobile Main" : "🕸️ Jayce Main Script",
    "Here is your script. Keep it private. ♡"
  );

  await user.send({
    embeds: [embed],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send the Jayce Main customer panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("View the Jayce Main admin panel"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption((o) =>
      o.setName("message").setDescription("Announcement text").setRequired(true)
    )
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel to announce in")
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a Jayce access code")
    .addUserOption((o) =>
      o.setName("user").setDescription("User receiving the code").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("resetpassword")
    .setDescription("Reset a buyer's account password")
    .addUserOption((o) =>
      o.setName("user").setDescription("Account owner").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("password")
        .setDescription("New password")
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(128)
    ),

  new SlashCommandBuilder()
    .setName("exportlogs")
    .setDescription("Show recent Jayce activity logs"),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("Send a buyer their Jayce script")
    .addUserOption((o) =>
      o.setName("user").setDescription("Buyer receiving the script").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("script")
        .setDescription("Choose which script")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View a user's Jayce account")
    .addUserOption((o) =>
      o.setName("user").setDescription("Account to inspect").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's Jayce access")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to disable").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant access to a Jayce script")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to grant access").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("script")
        .setDescription("Which script?")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to blacklist").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for blacklist")
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user's blacklist")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to unblacklist").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to ban").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for ban")
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered Jayce accounts"),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up a buyer")
    .addStringOption((o) =>
      o.setName("query").setDescription("Discord ID or Roblox username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke a buyer's Jayce access")
    .addUserOption((o) =>
      o.setName("user").setDescription("Buyer to revoke").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("dmbuyerupdate")
    .setDescription("DM an update to a buyer")
    .addUserOption((o) =>
      o.setName("user").setDescription("Buyer to message").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("message").setDescription("Update message").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forceresethwid")
    .setDescription("Clear a buyer's locally saved HWID")
    .addUserOption((o) =>
      o.setName("user").setDescription("Buyer whose HWID should be cleared").setRequired(true)
    ),
].map((command) => command.toJSON());

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
      "[CONFIG] Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID environment variables."
    );
    return;
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });

  console.log("[COMMANDS] Registered successfully.");
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      const userId = interaction.user.id;

      if (interaction.customId === "jc_register") {
        if (isRateLimited(userId, "register")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait a bit before registering again.",
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("jc_register_modal")
          .setTitle("♡ Jayce Registration");

        const usernameInput = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("Your Roblox username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter your Roblox username")
          .setRequired(true)
          .setMaxLength(20);

        const passwordInput = new TextInputBuilder()
          .setCustomId("account_password")
          .setLabel("Password")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter a password")
          .setRequired(true)
          .setMaxLength(128);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
          new ActionRowBuilder().addComponents(passwordInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "jc_stats") {
        return interaction.reply({
          embeds: [
            makeEmbed(
              "🔮 Jayce Stats",
              [
                `**Registered accounts:** ${Object.keys(db.accounts).length}`,
                `**Keys created:** ${Object.keys(db.keys).length}`,
                `**Blacklisted accounts:** ${Object.keys(db.blacklisted).length}`,
                `**Disabled access records:** ${
                  Object.values(db.access).filter((value) => value === false).length
                }`,
                `**Audit entries:** ${db.logs.length}`,
              ].join("\n")
            ),
          ],
          ephemeral: true,
        });
      }

      if (isBlacklisted(userId)) {
        return replyWithHeart(interaction, {
          content: "⛔ Your account is blacklisted.",
          ephemeral: true,
        });
      }

      if (!accessEnabled(userId)) {
        return replyWithHeart(interaction, {
          content: "🔒 Your Jayce access is disabled. Contact staff.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_key") {
        if (isRateLimited(userId, "key_generate")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait before generating another key.",
            ephemeral: true,
          });

