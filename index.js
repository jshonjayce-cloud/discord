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
        }

        const modal = new ModalBuilder()
          .setCustomId("jc_key_modal")
          .setTitle("♡ Get Your Jayce Key");

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
          .setPlaceholder("Enter your account password")
          .setRequired(true)
          .setMaxLength(128);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
          new ActionRowBuilder().addComponents(passwordInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "jc_mobilemain") {
        if (isRateLimited(userId, "mobile_redeem")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait before trying Mobile Main again.",
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("jc_mobilemain_modal")
          .setTitle("📱 Mobile Main — Verify");

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
          .setPlaceholder("Enter your account password")
          .setRequired(true)
          .setMaxLength(128);

        const keyInput = new TextInputBuilder()
          .setCustomId("access_key")
          .setLabel("Access key")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter the JAYCE-... key")
          .setRequired(true)
          .setMaxLength(64);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
          new ActionRowBuilder().addComponents(passwordInput),
          new ActionRowBuilder().addComponents(keyInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "jc_resethwid") {
        const modal = new ModalBuilder()
          .setCustomId("jc_resethwid_modal")
          .setTitle("🔁 Reset Local HWID");

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
          .setPlaceholder("Enter your account password")
          .setRequired(true)
          .setMaxLength(128);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
          new ActionRowBuilder().addComponents(passwordInput)
        );

        return interaction.showModal(modal);
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "jc_register_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username").trim();
        const password = interaction.fields.getTextInputValue("account_password");

        if (!isValidUsername(username)) {
          return replyWithHeart(interaction, {
            content: "Please enter a valid Roblox username (3-20 letters, numbers, or underscores).",
            ephemeral: true,
          });
        }

        if (!isValidPassword(password)) {
          return replyWithHeart(interaction, {
            content: "Please enter a password with at least 6 characters.",
            ephemeral: true,
          });
        }

        const existingUsername = Object.values(db.accounts).find(
          (account) =>
            account &&
            typeof account.username === "string" &&
            account.username.toLowerCase() === username.toLowerCase()
        );

        if (existingUsername) {
          return replyWithHeart(interaction, {
            content: "That Roblox username is already registered.",
            ephemeral: true,
          });
        }

        if (db.accounts[interaction.user.id]) {
          return replyWithHeart(interaction, {
            content: "You are already registered. Use Get Key or Reset HWID instead.",
            ephemeral: true,
          });
        }

        db.accounts[interaction.user.id] = {
          username,
          password: hashPassword(password),
          registeredAt: new Date().toISOString(),
          discordTag: interaction.user.tag,
        };

        appendLog("register", {
          userId: interaction.user.id,
          robloxUsername: username,
          discordTag: interaction.user.tag,
        });

        saveDatabase();

        return replyWithHeart(interaction, {
          embeds: [
            makeEmbed(
              "♡ Registration Complete",
              `**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}`
            ),
          ],
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_key_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username").trim();
        const password = interaction.fields.getTextInputValue("account_password");

        if (!username || !password) {
          return replyWithHeart(interaction, {
            content: "Please enter a valid username and password.",
            ephemeral: true,
          });
        }

        const account = db.accounts[interaction.user.id];

        if (!account || account.username !== username) {
          return replyWithHeart(interaction, {
            content: "No registered account found for that username. Register first.",
            ephemeral: true,
          });
        }

        if (!verifyPassword(account.password, password)) {
          return replyWithHeart(interaction, {
            content: "Invalid password.",
            ephemeral: true,
          });
        }

        const code = makeKey();

        db.keys[code] = {
          userId: interaction.user.id,
          createdAt: new Date().toISOString(),
          redeemed: false,
          revoked: false,
        };

        appendLog("key_generated", {
          userId: interaction.user.id,
          key: code,
          robloxUsername: username,
        });

        saveDatabase();

        try {
          await interaction.user.send({
            embeds: [
              makeEmbed(
                "♡ Your Jayce Access Code",
                `Your access code is:\n\n\`${code}\`\n\nKeep it private.`
              ),
            ],
          });

          return replyWithHeart(interaction, {
            content: "Access code generated and sent to your DMs.",
            ephemeral: true,
          });
        } catch {
          return replyWithHeart(interaction, {
            content: `I couldn't DM you. Your code is:\n\`${code}\``,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === "jc_mobilemain_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username").trim();
        const password = interaction.fields.getTextInputValue("account_password");
        const accessKey = interaction.fields.getTextInputValue("access_key").trim();

        if (!username || !password || !accessKey) {
          return replyWithHeart(interaction, {
            content: "Please enter username, password, and access key.",
            ephemeral: true,
          });
        }

        const account = db.accounts[interaction.user.id];

        if (!account || account.username !== username) {
          return replyWithHeart(interaction, {
            content: "No registered account found for that username. Register first.",
            ephemeral: true,
          });
        }

        if (!verifyPassword(account.password, password)) {
          return replyWithHeart(interaction, {
            content: "Invalid password.",
            ephemeral: true,
          });
        }

        const keyEntry = db.keys[accessKey];

        if (!keyEntry || keyEntry.userId !== interaction.user.id) {
          return replyWithHeart(interaction, {
            content: "That access key is invalid or doesn't belong to you.",
            ephemeral: true,
          });
        }

        if (keyEntry.revoked) {
          return replyWithHeart(interaction, {
            content: "That access key has been revoked.",
            ephemeral: true,
          });
        }

        if (keyEntry.redeemed && keyEntry.hwid) {
          return replyWithHeart(interaction, {
            content: "That access key has already been redeemed.",
            ephemeral: true,
          });
        }

        if (!keyEntry.hwid) {
          keyEntry.hwid = `discord:${interaction.user.id}`;
        }

        keyEntry.redeemed = true;
        keyEntry.redeemedAt = new Date().toISOString();
        db.access[interaction.user.id] = true;

        appendLog("mobile_redeemed", {
          userId: interaction.user.id,
          key: accessKey,
          hwid: keyEntry.hwid,
        });

        saveDatabase();

        try {
          await sendScriptDM(interaction.user, "mobile");

          return replyWithHeart(interaction, {
            content: "📱 Mobile Main was sent to your DMs.",
            ephemeral: true,
          });
        } catch {
          return replyWithHeart(interaction, {
            content: "I couldn't DM you. Enable server DMs and try again.",
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === "jc_resethwid_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username").trim();
        const password = interaction.fields.getTextInputValue("account_password");

        if (!username || !password) {
          return replyWithHeart(interaction, {
            content: "Please enter a valid username and password.",
            ephemeral: true,
          });
        }

        const account = db.accounts[interaction.user.id];

        if (!account || account.username !== username) {
          return replyWithHeart(interaction, {
            content: "No registered account found for that username. Register first.",
            ephemeral: true,
          });
        }

        if (!verifyPassword(account.password, password)) {
          return replyWithHeart(interaction, {
            content: "Invalid password.",
            ephemeral: true,
          });
        }

        let cleared = false;

        if (Object.prototype.hasOwnProperty.call(db.hwids, interaction.user.id)) {
          delete db.hwids[interaction.user.id];
          cleared = true;
        }

        if (
          db.accounts[interaction.user.id] &&
          Object.prototype.hasOwnProperty.call(db.accounts[interaction.user.id], "hwid")
        ) {
          delete db.accounts[interaction.user.id].hwid;
          cleared = true;
        }

        for (const entry of Object.values(db.keys)) {
          if (
            entry &&
            entry.userId === interaction.user.id &&
            Object.prototype.hasOwnProperty.call(entry, "hwid")
          ) {
            delete entry.hwid;
            entry.redeemed = false;
            cleared = true;
          }
        }

        appendLog("hwid_reset_self", {
          userId: interaction.user.id,
          robloxUsername: username,
        });

        saveDatabase();

        return replyWithHeart(interaction, {
          content: cleared
            ? "♡ Cleared locally saved HWID data for you."
            : "No locally saved HWID was found for you. An HWID stored in FlowAuth must be reset there separately.",
          ephemeral: true,
        });
      }
    }

    if (!interaction.isChatInputCommand()) return;

    if (!isStaff(interaction.member)) {
      return replyWithHeart(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const commandName = interaction.commandName;

    if (commandName === "panel") {
      const embed = makeEmbed(
        "🎃 JAYCE MAIN 🦇",
        [
          "**Welcome to Jayce Main!**",
          "",
          "🎀 **Register** — link your Roblox username",
          "🔑 **Get Key** — receive your JAYCE access key",
          "📱 **Mobile Main** — receive the mobile loader (requires key)",
          "🔁 **Reset HWID** — clear your locally saved HWID",
          "🔮 **Get Stats** — view public statistics",
          "",
          "*Choose an option below, boo! ♡*",
        ].join("\n")
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("jc_register")
          .setLabel("Register")
          .setEmoji("🎀")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("jc_key")
          .setLabel("Get Key")
          .setEmoji("🔑")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("jc_mobilemain")
          .setLabel("Mobile Main")
          .setEmoji("📱")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("jc_resethwid")
          .setLabel("Reset HWID")
          .setEmoji("🔁")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("jc_stats")
          .setLabel("Get Stats")
          .setEmoji("🔮")
          .setStyle(ButtonStyle.Primary)
      );

      return replyWithHeart(interaction, {
        embeds: [embed],
        components: [row],
      });
    }

    if (commandName === "adminpanel") {
      const embed = makeEmbed(
        "♡ Jayce Main Admin Panel",
        [
          "**Account Management**",
          "`/account` — inspect an account",
          "`/grantaccess` — grant access",
          "`/disableaccess` — disable access",
          "`/generate-key` — generate a key",
          "`/resetpassword` — reset a buyer password",
          "`/exportlogs` — view recent logs",
          "",
          "**Scripts**",
          "`/jaycescripts` — send a script",
          "`/panel` — post the customer panel",
          "",
          "**Moderation**",
          "`/blacklist` — blacklist a user",
          "`/unblacklist` — remove a blacklist",
          "`/ban` — ban a member",
          "`/revoke` — revoke access",
          "",
          "**Buyer tools**",
          "`/lookup` — search buyer details",
          "`/dmbuyerupdate` — DM an update",
          "`/forceresethwid` — clear locally saved HWID",
        ].join("\n")
      );

      return replyWithHeart(interaction, {
        embeds: [embed],
        ephemeral: true,
      });
    }

    if (commandName === "announce") {
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel") || interaction.channel;

      if (!channel?.isTextBased() || !channel.send) {
        return replyWithHeart(interaction, {
          content: "Please select a text channel.",
          ephemeral: true,
        });
      }

      await channel.send({
        embeds: [makeEmbed("♡ Jayce Main Announcement", message)],
      });

      return replyWithHeart(interaction, {
        content: `Announcement sent to ${channel}.`,
        ephemeral: true,
      });
    }

    if (commandName === "generate-key") {
      const user = interaction.options.getUser("user", true);
      if (isRateLimited(user.id, "staff_key_generate")) {
        return replyWithHeart(interaction, {
          content: "♻️ Please wait before generating another key for that user.",
          ephemeral: true,
        });
      }

      let code;
      do {
        code = makeKey();
      } while (db.keys[code]);

      db.keys[code] = {
        userId: user.id,
        createdAt: new Date().toISOString(),
        redeemed: false,
        revoked: false,
      };

      appendLog("key_generated_staff", {
        userId: user.id,
        key: code,
        staffId: interaction.user.id,
      });

      saveDatabase();

      try {
        await user.send({
          embeds: [
            makeEmbed(
              "♡ Your Jayce Access Code",
              `Your access code is:\n\n\`${code}\`\n\nKeep it private.`
            ),
          ],
        });

        return replyWithHeart(interaction, {
          content: `Access code generated and sent to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return replyWithHeart(interaction, {
          content: `I couldn't DM ${user}. Their code is:\n\`${code}\``,
          ephemeral: true,
        });
      }
    }

    if (commandName === "resetpassword") {
      const user = interaction.options.getUser("user", true);
      const password = interaction.options.getString("password", true);

      if (!isValidPassword(password)) {
        return replyWithHeart(interaction, {
          content: "Password must be at least 6 characters.",
          ephemeral: true,
        });
      }

      if (!db.accounts[user.id]) {
        return replyWithHeart(interaction, {
          content: "That user does not have an account registered yet.",
          ephemeral: true,
        });
      }

      db.accounts[user.id].password = hashPassword(password);
      appendLog("password_reset", {
        userId: user.id,
        staffId: interaction.user.id,
      });
      saveDatabase();

      return replyWithHeart(interaction, {
        content: `♡ Password reset for ${user}.`,
        ephemeral: true,
      });
    }

    if (commandName === "exportlogs") {
      const recent = db.logs.slice(-10).reverse();

      if (!recent.length) {
        return replyWithHeart(interaction, {
          content: "No logs yet.",
          ephemeral: true,
        });
      }

      const entries = recent.map(
        (entry) =>
          `• **${entry.action}** — ${new Date(entry.timestamp).toLocaleString()} — ${JSON.stringify({
            userId: entry.userId || null,
            staffId: entry.staffId || null,
            key: entry.key || null,
            hwid: entry.hwid || null,
          })}`
      );

      return replyWithHeart(interaction, {
        embeds: [
          makeEmbed(
            "♡ Recent Jayce Logs",
            entries.join("\n").slice(0, 4000)
          ),
        ],
        ephemeral: true,
      });
    }

    if (commandName === "jaycescripts") {
      const user = interaction.options.getUser("user", true);
      const scriptType = interaction.options.getString("script", true);

      if (isBlacklisted(user.id)) {
        return replyWithHeart(interaction, {
          content: "⛔ That user is blacklisted.",
          ephemeral: true,
        });
      }

      if (!accessEnabled(user.id)) {
        return replyWithHeart(interaction, {
          content: "🔒 That user's Jayce access is disabled.",
          ephemeral: true,
        });
      }

      const member = await getGuildMember(interaction.guild, user.id);

      if (!member) {
        return replyWithHeart(interaction, {
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      const requiredRole =
        scriptType === "mobile" ? MOBILE_MAIN_ROLE_ID : MAIN_ROLE_ID;

      if (!member.roles.cache.has(requiredRole)) {
        return replyWithHeart(interaction, {
          content: "That user doesn't have the required script role.",
          ephemeral: true,
        });
      }

      try {
        await sendScriptDM(user, scriptType);

        return replyWithHeart(interaction, {
          content: `♡ Sent the ${
            scriptType === "mobile" ? "Mobile Main" : "Main"
          } script to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return replyWithHeart(interaction, {
          content: `I couldn't DM ${user}. They may need to enable server DMs.`,
          ephemeral: true,
        });
      }
    }

    if (commandName === "account") {
      const user = interaction.options.getUser("user", true);
      const account = db.accounts[user.id];
      const member = await getGuildMember(interaction.guild, user.id);

      const codes = Object.entries(db.keys)
        .filter(([, data]) => data.userId === user.id)
        .map(([code, data]) => `${code} — ${data.redeemed ? "Redeemed" : "Not redeemed"}`);

      return replyWithHeart(interaction, {
        embeds: [
          makeEmbed(
            "♡ Jayce Account Information",
            [
              `**Discord:** ${user.tag}`,
              `**User ID:** ${user.id}`,
              `**Roblox username:** ${account?.username || "Not registered"}`,
              `**Registered:** ${account?.registeredAt || "No"}`,
              `**Access:** ${accessEnabled(user.id) ? "Enabled" : "Disabled"}`,
              `**Blacklisted:** ${isBlacklisted(user.id) ? "Yes" : "No"}`,
              `**Main role:** ${member?.roles.cache.has(MAIN_ROLE_ID) ? "Yes" : "No"}`,
              `**Mobile Main role:** ${member?.roles.cache.has(MOBILE_MAIN_ROLE_ID) ? "Yes" : "No"}`,
              "",
              "**Generated codes:**",
              codes.length ? codes.join("\n") : "No codes found.",
            ].join("\n")
          ),
        ],
        ephemeral: true,
      });
    }

    if (commandName === "disableaccess") {
      const user = interaction.options.getUser("user", true);
      const member = await getGuildMember(interaction.guild, user.id);

      db.access[user.id] = false;
      saveDatabase();

      if (member) {
        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error("[ACCESS] Role removal failed:", error);

          return replyWithHeart(interaction, {
            content: "Access was disabled in the database, but I couldn't remove all roles. Check the bot's role hierarchy.",
            ephemeral: true,
          });
        }
      }

      return replyWithHeart(interaction, {
        content: `🔒 Jayce access disabled for ${user}.`,
        ephemeral: true,
      });
    }

    if (commandName === "grantaccess") {
      const user = interaction.options.getUser("user", true);
      const scriptType = interaction.options.getString("script", true);

      if (isBlacklisted(user.id)) {
        return replyWithHeart(interaction, {
          content: "Remove the user's blacklist before granting access.",
          ephemeral: true,
        });
      }

      const member = await getGuildMember(interaction.guild, user.id);

      if (!member) {
        return replyWithHeart(interaction, {
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      const roleId =
        scriptType === "mobile" ? MOBILE_MAIN_ROLE_ID : MAIN_ROLE_ID;
      const productName = scriptType === "mobile" ? "Mobile Main" : "Main";

      try {
        const role =
          member.guild.roles.cache.get(roleId) ||
          (await member.guild.roles.fetch(roleId));

        if (!role) throw new Error(`Role not found: ${roleId}`);

        await member.roles.add(roleId);
      } catch (error) {
        console.error("[ACCESS] Role grant failed:", error);

        return replyWithHeart(interaction, {
          content: `I couldn't assign the ${productName} role. Check Manage Roles and the bot's role hierarchy.`,
          ephemeral: true,
        });
      }

      db.access[user.id] = true;
      saveDatabase();

      return replyWithHeart(interaction, {
        content: `${productName} access granted to ${user}.`,
        ephemeral: true,
      });
    }

    if (commandName === "blacklist") {
      const user = interaction.options.getUser("user", true);
      const reason =
        interaction.options.getString("reason") || "No reason provided";

      db.blacklisted[user.id] = {
        reason,
        moderator: interaction.user.id,
        createdAt: new Date().toISOString(),
      };

      db.access[user.id] = false;
      saveDatabase();

      const member = await getGuildMember(interaction.guild, user.id);

      if (member) {
        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error("[BLACKLIST] Role removal failed:", error);
        }
      }

      return replyWithHeart(interaction, {
        content: `⛔ ${user} has been blacklisted.\nReason: ${reason}`,
        ephemeral: true,
      });
    }

    if (commandName === "unblacklist") {
      const user = interaction.options.getUser("user", true);

      if (!isBlacklisted(user.id)) {
        return replyWithHeart(interaction, {
          content: "That user isn't blacklisted.",
          ephemeral: true,
        });
      }

      delete db.blacklisted[user.id];
      saveDatabase();

      return replyWithHeart(interaction, {
        content: `♡ Removed the blacklist for ${user}. Use /grantaccess to restore access if appropriate.`,
        ephemeral: true,
      });
    }

    if (commandName === "ban") {
      const user = interaction.options.getUser("user", true);
      const reason =
        interaction.options.getString("reason") || "No reason provided";

      const member = await getGuildMember(interaction.guild, user.id);

      if (!member) {
        return replyWithHeart(interaction, {
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      if (!member.bannable) {
        return replyWithHeart(interaction, {
          content: "I can't ban that member. Check Ban Members permission and role hierarchy.",
          ephemeral: true,
        });
      }

      await member.ban({ reason });

      return replyWithHeart(interaction, {
        content: `🔨 Banned ${user}.\nReason: ${reason}`,
        ephemeral: true,
      });
    }

    if (commandName === "lookup") {
      const query = interaction.options.getString("query", true).trim();
      const queryLower = query.toLowerCase();

      const matches = Object.entries(db.accounts).filter(
        ([userId, account]) =>
          userId === query ||
          String(account?.username || "").toLowerCase() === queryLower
      );

      const matchedIds = new Set(matches.map(([userId]) => userId));

      if (/^\d{17,20}$/.test(query)) {
        matchedIds.add(query);
      }

      for (const entry of Object.values(db.keys)) {
        if (
          entry &&
          (entry.userId === query ||
            String(entry.username || "").toLowerCase() === queryLower)
        ) {
          if (entry.userId) matchedIds.add(entry.userId);
        }
      }

      if (!matchedIds.size) {
        return replyWithHeart(interaction, {
          content: `No buyer found for \`${query}\`.`,
          ephemeral: true,
        });
      }

      const lines = [];

      for (const userId of matchedIds) {
        const account = db.accounts[userId];
        const user = await client.users.fetch(userId).catch(() => null);
        const member = await getGuildMember(interaction.guild, userId);

        lines.push(
          [
            `**Buyer:** ${user ? user.tag : `<@${userId}>`}`,
            `**Discord ID:** \`${userId}\``,
            `**Roblox username:** ${account?.username || "Not registered"}`,
            `**Registered:** ${account?.registeredAt || "No"}`,
            `**Access:** ${accessEnabled(userId) ? "Enabled" : "Disabled"}`,
            `**Blacklisted:** ${isBlacklisted(userId) ? "Yes" : "No"}`,
            `**Main role:** ${member?.roles.cache.has(MAIN_ROLE_ID) ? "Yes" : "No/unknown"}`,
            `**Mobile role:** ${member?.roles.cache.has(MOBILE_MAIN_ROLE_ID) ? "Yes" : "No/unknown"}`,
            `**Saved HWID:** ${db.hwids[userId] ? "Present (value hidden)" : "None saved"}`,
          ].join("\n")
        );
      }

      return replyWithHeart(interaction, {
        embeds: [
          makeEmbed(
            "♡ Buyer Lookup",
            lines.join("\n\n────────────\n\n").slice(0, 4000)
          ),
        ],
        ephemeral: true,
      });
    }

    if (commandName === "revoke") {
      const user = interaction.options.getUser("user", true);
      const member = await getGuildMember(interaction.guild, user.id);

      db.access[user.id] = false;

      for (const entry of Object.values(db.keys)) {
        if (entry && entry.userId === user.id) {
          entry.revoked = true;
          entry.revokedAt = new Date().toISOString();
          entry.revokedBy = interaction.user.id;
        }
      }

      saveDatabase();

      let roleWarning = "";

      if (member) {
        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error("[REVOKE] Role removal failed:", error);
          roleWarning = "\n⚠️ I couldn't remove all roles. Check the bot's role hierarchy.";
        }
      }

      return replyWithHeart(interaction, {
        content: `🔒 Revoked Jayce access for ${user}.${roleWarning}`,
        ephemeral: true,
      });
    }

    if (commandName === "dmbuyerupdate") {
      const user = interaction.options.getUser("user", true);
      const message = interaction.options.getString("message", true).trim();

      if (!message) {
        return replyWithHeart(interaction, {
          content: "Enter an update message to send.",
          ephemeral: true,
        });
      }

      try {
        await user.send({
          embeds: [makeEmbed("♡ Jayce Buyer Update", message)],
        });

        return replyWithHeart(interaction, {
          content: `♡ Buyer update sent to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return replyWithHeart(interaction, {
          content: `I couldn't DM ${user}. They may have DMs disabled.`,
          ephemeral: true,
        });
      }
    }

    if (commandName === "forceresethwid") {
      const user = interaction.options.getUser("user", true);
      let cleared = false;

      if (Object.prototype.hasOwnProperty.call(db.hwids, user.id)) {
        delete db.hwids[user.id];
        cleared = true;
      }

      if (
        db.accounts[user.id] &&
        Object.prototype.hasOwnProperty.call(db.accounts[user.id], "hwid")
      ) {
        delete db.accounts[user.id].hwid;
        cleared = true;
      }

      for (const entry of Object.values(db.keys)) {
        if (
          entry &&
          entry.userId === user.id &&
          Object.prototype.hasOwnProperty.call(entry, "hwid")
        ) {
          delete entry.hwid;
          entry.redeemed = false;
          cleared = true;
        }
      }

      appendLog("staff_hwid_reset", {
        userId: user.id,
        staffId: interaction.user.id,
      });

      saveDatabase();

      return replyWithHeart(interaction, {
        content: cleared
          ? `♡ Cleared locally saved HWID data for ${user}.`
          : `No locally saved HWID was found for ${user}. An HWID stored in FlowAuth must be reset there separately.`,
        ephemeral: true,
      });
    }

    if (commandName === "listallaccounts") {
      const entries = Object.entries(db.accounts);

      if (!entries.length) {
        return replyWithHeart(interaction, {
          content: "No registered accounts yet.",
          ephemeral: true,
        });
      }

      const lines = entries.map(
        ([userId, account]) =>
          `• **${account.username || "Unknown"}** — <@${userId}> (\`${userId}\`)`
      );

      const chunks = [];

      for (let i = 0; i < lines.length; i += 15) {
        chunks.push(lines.slice(i, i + 15).join("\n"));
      }

      const embeds = chunks.slice(0, 10).map((chunk, index) =>
        makeEmbed(
          `♡ Registered Accounts (${entries.length})`,
          `Page ${index + 1}\n\n${chunk}`
        )
      );

      return replyWithHeart(interaction, {
        embeds,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("[INTERACTION ERROR]", error);

    if (interaction.isRepliable()) {
      const response = {
        content: "Something went wrong. Check the Render logs for details.",
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMANDS] Registration failed:", error);
  }
});

if (!TOKEN) {
  console.error("[CONFIG] DISCORD_TOKEN is missing in Render environment variables.");
} else {
  client.login(TOKEN).catch((error) => {
    console.error("[BOT] Login failed:", error);
  });
}

process.on("unhandledRejection", (error) => {
  console.error("[UNHANDLED REJECTION]", error);
});
