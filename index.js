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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1552637829815865414";
const MAIN_ROLE_ID = "1552637429456961657";
const MOBILE_MAIN_ROLE_ID = process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || "1556208545278595142";

const LOADER_URL =
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
const PANEL_COLOR = 0xff7518;
const TICKET_COLOR = 0x5865f2;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMITS = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

let db = {
  keys: {},
  blacklisted: {},
  hwids: {},
  accounts: {},
  access: {},
  logs: [],
};

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
        logs: Array.isArray(loaded.logs) ? loaded.logs : [],
      };
    }

    saveDatabase();
    console.log("[DATABASE] Loaded successfully.");
  } catch (error) {
    console.error("[DATABASE] Load error:", error);
  }
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
  res.status(200).json({ ok: true, logs: db.logs.slice(-50) });
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

app.post("/client/redeem", (req, res) => {
  const { username, key, hwid } = req.body || {};

  if (!username || !key || !hwid) {
    return res.status(400).json({ ok: false, error: "Missing username, key, or hwid." });
  }

  const accountEntry = Object.entries(db.accounts).find(
    ([userId, account]) =>
      account &&
      typeof account.username === "string" &&
      account.username.toLowerCase() === String(username).toLowerCase()
  );

  if (!accountEntry) {
    return res.status(404).json({ ok: false, error: "No account found for that Roblox username." });
  }

  const [userId] = accountEntry;
  const keyEntry = db.keys[key];

  if (!keyEntry) {
    return res.status(404).json({ ok: false, error: "Invalid key." });
  }

  if (String(keyEntry.userId) !== String(userId)) {
    return res.status(403).json({ ok: false, error: "This key does not belong to that Roblox account." });
  }

  if (keyEntry.revoked) {
    return res.status(403).json({ ok: false, error: "This key has been revoked." });
  }

  if (keyEntry.redeemed && keyEntry.hwid && String(keyEntry.hwid) !== String(hwid)) {
    appendLog("hwid_mismatch_client", {
      key,
      userId,
      submittedHwid: String(hwid),
      storedHwid: String(keyEntry.hwid),
    });

    return res.status(403).json({ ok: false, error: "HWID mismatch. Contact staff for a reset." });
  }

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

  return res.status(200).json({
    ok: true,
    message: "Key redeemed successfully.",
    loaderUrl: LOADER_URL,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WEB] Listening on port ${PORT}`);
});

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

function createLegacyPanel() {
  return {
    embeds: [
      makeEmbed(
        "♡ Jayce Main",
        [
          "**Register** your account.",
          "**Get key** to activate access.",
          "**Stats** for account/log info.",
          "**Main script** and **mobile main script** options."
        ].join("\n")
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("jc_register").setLabel("Register").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("jc_key").setLabel("Get Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("jc_stats").setLabel("Stats").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("jc_script").setLabel("Main Script").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("jc_mobile_script").setLabel("Mobile Main").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function createTicketPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle("jayce.EXE Tickets")
        .setDescription("Choose a reason...")
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ticket_select")
          .setPlaceholder("Choose a reason...")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("support").setValue("support").setDescription("Open a ticket for support"),
            new StringSelectMenuOptionBuilder().setLabel("purchase").setValue("purchase").setDescription("Open a ticket for purchase"),
            new StringSelectMenuOptionBuilder().setLabel("script").setValue("script").setDescription("Open a ticket for script"),
            new StringSelectMenuOptionBuilder().setLabel("help").setValue("help").setDescription("Open a ticket for help"),
            new StringSelectMenuOptionBuilder().setLabel("bugs").setValue("bugs").setDescription("Open a ticket for bugs")
          )
      ),
    ],
  };
}

async function openTicket(interaction, ticketType) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: "This ticket system only works in a server.",
      ephemeral: true,
    });
  }

  const ticketChannel =
    guild.channels.cache.get(TICKET_CHANNEL_ID) ||
    (await guild.channels.fetch(TICKET_CHANNEL_ID).catch(() => null));

  if (!ticketChannel) {
    return interaction.reply({
      content: "Ticket channel is not set or not found. Please configure `TICKET_CHANNEL_ID`.",
      ephemeral: true,
    });
  }

  const labelMap = {
    support: "Support",
    purchase: "Purchase",
    script: "Script",
    help: "Help",
    bugs: "Bugs",
  };

  const ticketLabel = labelMap[ticketType] || "Support";

  const ticketEmbed = new EmbedBuilder()
    .setColor(TICKET_COLOR)
    .setTitle(`🎫 New ${ticketLabel} Ticket`)
    .setDescription(
      `**User:** ${interaction.user.tag}\n` +
        `**Discord ID:** ${interaction.user.id}\n` +
        `**Type:** ${ticketLabel}\n` +
        `**Created:** <t:${Math.floor(Date.now() / 1000)}:F>`
    )
    .addFields({
      name: "Next step",
      value: "A staff member will respond here shortly.",
    })
    .setTimestamp();

  const ticketMessage = await ticketChannel.send({
    content: `<@&${STAFF_ROLE_ID}> New ${ticketLabel.toLowerCase()} ticket`,
    embeds: [ticketEmbed],
  });

  await interaction.reply({
    content: `✅ Your ${ticketLabel.toLowerCase()} ticket was created in <#${TICKET_CHANNEL_ID}>.`,
    ephemeral: true,
  });

  try {
    await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(TICKET_COLOR)
          .setTitle("🎫 Ticket Created")
          .setDescription(
            `Your ${ticketLabel.toLowerCase()} ticket was submitted successfully.\n\n` +
              `Ticket channel: <#${TICKET_CHANNEL_ID}>\n` +
              `Reference: ${ticketMessage.id}`
          )
          .setTimestamp(),
      ],
    }).catch(() => {});
  } catch (err) {}
}

const commands = [
  new SlashCommandBuilder().setName("panel").setDescription("Send the Jayce Main customer panel"),
  new SlashCommandBuilder().setName("ticketpanel").setDescription("Open the jayce.EXE ticket panel"),
  new SlashCommandBuilder().setName("adminpanel").setDescription("View the Jayce Main admin panel"),
  new SlashCommandBuilder().setName("announce").setDescription("Send an announcement").addStringOption((o) =>
    o.setName("message").setDescription("Announcement text").setRequired(true)
  ).addChannelOption((o) =>
    o.setName("channel").setDescription("Channel to announce in")
  ),
  new SlashCommandBuilder().setName("generate-key").setDescription("Generate a Jayce access code").addUserOption((o) =>
    o.setName("user").setDescription("User receiving the code").setRequired(true)
  ),
  new SlashCommandBuilder().setName("resetpassword").setDescription("Reset a buyer's account password").addUserOption((o) =>
    o.setName("user").setDescription("Account owner").setRequired(true)
  ).addStringOption((o) =>
    o.setName("password").setDescription("New password").setRequired(true).setMinLength(6).setMaxLength(128)
  ),
  new SlashCommandBuilder().setName("exportlogs").setDescription("Show recent Jayce activity logs"),
  new SlashCommandBuilder().setName("jaycescripts").setDescription("Send a buyer their Jayce script").addUserOption((o) =>
    o.setName("user").setDescription("Buyer receiving the script").setRequired(true)
  ).addStringOption((o) =>
    o.setName("script").setDescription("Choose which script").setRequired(true).addChoices(
      { name: "Main", value: "main" },
      { name: "Mobile Main", value: "mobile" }
    )
  ),
  new SlashCommandBuilder().setName("account").setDescription("View a user's Jayce account").addUserOption((o) =>
    o.setName("user").setDescription("Account to inspect").setRequired(true)
  ),
  new SlashCommandBuilder().setName("disableaccess").setDescription("Disable a user's Jayce access").addUserOption((o) =>
    o.setName("user").setDescription("User to disable").setRequired(true)
  ),
  new SlashCommandBuilder().setName("grantaccess").setDescription("Grant access to a Jayce script").addUserOption((o) =>
    o.setName("user").setDescription("User to grant access").setRequired(true)
  ).addStringOption((o) =>
    o.setName("script").setDescription("Which script?").setRequired(true).addChoices(
      { name: "Main", value: "main" },
      { name: "Mobile Main", value: "mobile" }
    )
  ),
  new SlashCommandBuilder().setName("blacklist").setDescription("Blacklist a user").addUserOption((o) =>
    o.setName("user").setDescription("User to blacklist").setRequired(true)
  ).addStringOption((o) =>
    o.setName("reason").setDescription("Reason for blacklist")
  ),
  new SlashCommandBuilder().setName("unblacklist").setDescription("Remove a user's blacklist").addUserOption((o) =>
    o.setName("user").setDescription("User to unblacklist").setRequired(true)
  ),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member from this server").addUserOption((o) =>
    o.setName("user").setDescription("Member to ban").setRequired(true)
  ).addStringOption((o) =>
    o.setName("reason").setDescription("Reason for ban")
  ),
  new SlashCommandBuilder().setName("listallaccounts").setDescription("List registered Jayce accounts"),
  new SlashCommandBuilder().setName("lookup").setDescription("Look up a buyer").addStringOption((o) =>
    o.setName("query").setDescription("Discord ID or Roblox username").setRequired(true)
  ),
  new SlashCommandBuilder().setName("revoke").setDescription("Revoke a buyer's Jayce access").addUserOption((o) =>
    o.setName("user").setDescription("Buyer to revoke").setRequired(true)
  ),
  new SlashCommandBuilder().setName("dmbuyerupdate").setDescription("DM an update to a buyer").addUserOption((o) =>
    o.setName("user").setDescription("Buyer to message").setRequired(true)
  ).addStringOption((o) =>
    o.setName("message").setDescription("Update message").setRequired(true)
  ),
  new SlashCommandBuilder().setName("forceresethwid").setDescription("Clear a buyer's locally saved HWID").addUserOption((o) =>
    o.setName("user").setDescription("Buyer whose HWID should be cleared").setRequired(true)
  ),
].map((command) => command.toJSON());

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error("[CONFIG] Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID environment variables.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("[COMMANDS] Registered successfully.");
}

client.on("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isCommand()) {
      if (interaction.commandName === "panel") {
        return interaction.reply(createLegacyPanel());
      }

      if (interaction.commandName === "ticketpanel") {
        return interaction.reply(createTicketPanel());
      }

      if (interaction.commandName === "adminpanel") {
        return interaction.reply({
          embeds: [
            makeEmbed(
              "🛠️ Admin Panel",
              "Staff tools are available in the admin dashboard.\n\nTicket queue is managed in the configured ticket channel."
            ),
          ],
          ephemeral: true,
        });
      }

      if (interaction.commandName === "announce") {
        const message = interaction.options.getString("message");
        const channel = interaction.options.getChannel("channel") || interaction.channel;

        if (!channel || !channel.isTextBased()) {
          return interaction.reply({
            content: "Please choose a valid text channel.",
            ephemeral: true,
          });
        }

        await channel.send({ embeds: [makeEmbed("📢 Announcement", message)] });
        return interaction.reply({
          content: `✅ Announcement sent to ${channel}.`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: "That command is not available yet.",
        ephemeral: true,
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
      const selected = interaction.values[0];
      return openTicket(interaction, selected);
    }

    if (interaction.isButton()) {
      const ticketMap = {
        ticket_support: "support",
        ticket_purchase: "purchase",
        ticket_script: "script",
        ticket_help: "help",
        ticket_bugs: "bugs",
      };

      if (ticketMap[interaction.customId]) {
        return openTicket(interaction, ticketMap[interaction.customId]);
      }

      if (interaction.customId === "jc_script") {
        if (isRateLimited(interaction.user.id, "script_send")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait before requesting another script.",
            ephemeral: true,
          });
        }

        await sendScriptDM(interaction.user, "main");
        return interaction.reply({
          content: "✅ Your main script has been DM'd.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_mobile_script") {
        if (isRateLimited(interaction.user.id, "script_send_mobile")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait before requesting another mobile script.",
            ephemeral: true,
          });
        }

        await sendScriptDM(interaction.user, "mobile");
        return interaction.reply({
          content: "✅ Your mobile main script has been DM'd.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_register") {
        if (isRateLimited(interaction.user.id, "register")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait a bit before registering again.",
            ephemeral: true,
          });
        }

        if (db.accounts[interaction.user.id]) {
          return replyWithHeart(interaction, {
            content: "♻️ You already have one registered account.",
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder().setCustomId("jc_register_modal").setTitle("♡ Jayce Registration");

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
                `**Audit entries:** ${db.logs.length}`,
              ].join("\n")
            ),
          ],
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_key") {
        if (isRateLimited(interaction.user.id, "key_generate")) {
          return replyWithHeart(interaction, {
            content: "♻️ Please wait before generating another key.",
            ephemeral: true,
          });
        }

        const key = makeKey();
        db.keys[key] = {
          key,
          userId: interaction.user.id,
          createdAt: new Date().toISOString(),
          redeemed: false,
          revoked: false,
        };

        appendLog("key_created", {
          key,
          userId: interaction.user.id,
        });
        saveDatabase();

        return interaction.reply({
          embeds: [
            makeEmbed(
              "🔑 Your Key",
              `Your access key is:\n\n\`\`${key}\`\`\n\nKeep it private.`
            ),
          ],
          ephemeral: true,
        });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "jc_register_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");
        const password = interaction.fields.getTextInputValue("account_password");

        const safeUsername = username.trim();
        const safePassword = password.trim();

        if (!safeUsername || !safePassword) {
          return interaction.reply({
            content: "Please enter both username and password.",
            ephemeral: true,
          });
        }

        if (db.accounts[interaction.user.id]) {
          return interaction.reply({
            content: "You already have one registered account.",
            ephemeral: true,
          });
        }

        db.accounts[interaction.user.id] = {
          username: safeUsername,
          passwordHash: hashPassword(safePassword),
          createdAt: new Date().toISOString(),
        };

        appendLog("account_registered", {
          userId: interaction.user.id,
          username: safeUsername,
        });
        saveDatabase();

        return interaction.reply({
          embeds: [
            makeEmbed(
              "✅ Registered",
              `Your account has been registered as **${safeUsername}**.`
            ),
          ],
          ephemeral: true,
        });
      }
    }
  } catch (error) {
    console.error("[INTERACTION] Error:", error);

    if (interaction && !interaction.deferred && !interaction.replied) {
      await interaction.reply({
        content: "Something went wrong while processing that action.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

if (!TOKEN) {
  console.warn("[CONFIG] DISCORD_TOKEN is not set. Bot will not login.");
} else {
  client.login(TOKEN);
}

loadDatabase();

module.exports = { createLegacyPanel, createTicketPanel, openTicket };
