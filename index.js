
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");

// ==================================================
// JAYCE MAIN CONFIG
// ==================================================
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE = "1552637829815865414";
const MAIN_ROLE = "1552637429456961657";
const MOBILE_ROLE =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const COLOR = 0xff9ed2;
const PORT = process.env.PORT || 3000;

const LOADER_URL =
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

const MAIN_SCRIPT = `loadstring(game:HttpGet("${LOADER_URL}"))()`;
const MOBILE_SCRIPT = MAIN_SCRIPT;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

// ==================================================
// DISCORD CLIENT
// ==================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ==================================================
// EXPRESS + KEEP ALIVE
// ==================================================
const app = express();

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    bot: client.isReady(),
    uptime: Math.floor(process.uptime()),
  });
});

app.listen(PORT, () => {
  console.log(
    "[EXPRESS SERVICE RUNNING] Listening on incoming gateway port " + PORT
  );
});

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

function startKeepAlive() {
  const urlStr =
    process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT;

  const mod = urlStr.startsWith("https") ? https : http;

  setInterval(() => {
    const pingUrl =
      urlStr + (urlStr.includes("?") ? "&" : "?") + "keepalive=1";

    const request = mod.get(
      pingUrl,
      { timeout: 5000 },
      (res) => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const json = JSON.parse(data);

            if (res.statusCode === 200 && json.status === "ok") {
              console.log(
                "[KEEP-ALIVE] Ping successful — " +
                new Date().toLocaleTimeString()
              );
            } else {
              console.log(
                "[KEEP-ALIVE] Unexpected response: HTTP " +
                res.statusCode
              );
            }
          } catch {
            console.log("[KEEP-ALIVE] Response was not JSON.");
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Request timed out"));
    });

    request.on("error", err => {
      console.log("[KEEP-ALIVE] Ping failed: " + err.message);
    });
  }, KEEP_ALIVE_INTERVAL);
}

startKeepAlive();

// ==================================================
// DATABASE
// ==================================================
const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "database.json");

let db = {
  keys: {},
  accounts: {},
  hwids: {},
  access: {},
  blacklisted: {},
};

function saveDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tempFile = DB_FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error("[DATABASE] Save error:", error);
  }
}

function loadDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(DB_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DB_FILE, "utf8")
      );

      db = {
        keys: saved.keys || {},
        accounts: saved.accounts || {},
        hwids: saved.hwids || {},
        access: saved.access || {},
        blacklisted: saved.blacklisted || {},
      };
    }

    saveDB();
    console.log("[DATABASE] Loaded.");
  } catch (error) {
    console.error("[DATABASE] Load error:", error);
  }
}

loadDB();

// ==================================================
// HELPERS
// ==================================================
function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "jayce  ♡  soft & secure" })
    .setTimestamp();
}

function isStaff(interaction) {
  const roles = interaction.member?.roles;

  if (Array.isArray(roles)) {
    return roles.includes(STAFF_ROLE);
  }

  return Boolean(roles?.cache?.has(STAFF_ROLE));
}

async function requireStaff(interaction) {
  if (isStaff(interaction)) return true;

  await safeReply(interaction, {
    content: "❌ Only Jayce staff can use this feature.",
    ephemeral: true,
  });

  return false;
}

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }

    return await interaction.reply(options);
  } catch (error) {
    console.error("[REPLY]", error.message);
  }
}

function isBlocked(userId) {
  return Boolean(db.blacklisted[userId]);
}

function hasAccess(userId) {
  return db.access[userId] !== false && !isBlocked(userId);
}

function createUniqueKey() {
  let key;

  do {
    key = crypto.randomBytes(18).toString("hex").toUpperCase();
  } while (db.keys[key]);

  return key;
}

function findUserKey(userId) {
  return Object.entries(db.keys).find(
    ([, data]) =>
      data.userId === userId && !data.revoked
  );
}

async function getMember(guild, userId) {
  if (!guild) return null;

  return guild.members.fetch(userId).catch(() => null);
}

async function assignRole(member, type) {
  const roleId = type === "mobile" ? MOBILE_ROLE : MAIN_ROLE;

  const role = await member.guild.roles
    .fetch(roleId)
    .catch(() => null);

  if (!role) {
    throw new Error(`Role ${roleId} was not found.`);
  }

  await member.roles.add(roleId);
}

async function removeScriptRoles(member) {
  await member.roles.remove([MAIN_ROLE, MOBILE_ROLE]);
}

async function sendScript(user, type) {
  const script =
    type === "mobile" ? MOBILE_SCRIPT : MAIN_SCRIPT;

  await user.send({
    embeds: [
      makeEmbed(
        type === "mobile"
          ? "📱 Jayce Mobile Main"
          : "♡ Jayce Main Script",
        "Your script is below. Keep it private. ♡"
      ),
    ],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

// ==================================================
// UPDATED PANEL BUTTONS
// ==================================================
function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("jc_register")
        .setLabel("♡ Register")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("jc_key")
        .setLabel("Get Key")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("jc_script")
        .setLabel("Get Script")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("jc_reset")
        .setLabel("Reset HWID")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("jc_generate_key")
        .setLabel("Generate Key")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ==================================================
// REGISTER MODAL: USERNAME + GENERATED KEY
// ==================================================
function registrationModal() {
  const modal = new ModalBuilder()
    .setCustomId("jc_register_modal")
    .setTitle("Jayce Registration");

  const username = new TextInputBuilder()
    .setCustomId("roblox")
    .setLabel("Roblox username")
    .setPlaceholder("Enter your Roblox username")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);

  const key = new TextInputBuilder()
    .setCustomId("license_key")
    .setLabel("Generated license key")
    .setPlaceholder("Paste your key from Discord DMs")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(username),
    new ActionRowBuilder().addComponents(key)
  );

  return modal;
}

// ==================================================
// STAFF KEY GENERATOR MODAL
// ==================================================
function generateKeyModal() {
  const modal = new ModalBuilder()
    .setCustomId("jc_generate_key_modal")
    .setTitle("Jayce Key Generator");

  const buyer = new TextInputBuilder()
    .setCustomId("buyer_id")
    .setLabel("Buyer's Discord user ID")
    .setPlaceholder("Enter their Discord ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const type = new TextInputBuilder()
    .setCustomId("script_type")
    .setLabel("Script type: main or mobile")
    .setPlaceholder("Enter main or mobile")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(buyer),
    new ActionRowBuilder().addComponents(type)
  );

  return modal;
}

// ==================================================
// SLASH COMMANDS
// ==================================================
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Jayce customer panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Show staff commands"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot status"),

  new SlashCommandBuilder()
    .setName("pm")
    .setDescription("Show payment information"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show bot statistics"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a server announcement")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Destination channel")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a key for a buyer")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("script")
        .setDescription("Script type")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("getkey")
    .setDescription("DM yourself your assigned key"),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("DM a buyer their script")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("script")
        .setDescription("Script type")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up a buyer")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View an account")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Account")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant script access")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("script")
        .setDescription("Script type")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's access")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke keys and access")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("dmbuyerupdate")
    .setDescription("DM a buyer an update")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Update text")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forceresethwid")
    .setDescription("Clear a locally stored HWID field")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a blacklist entry")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered accounts"),
].map(command => command.toJSON());

// ==================================================
// REGISTER SLASH COMMANDS
// ==================================================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const result = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log(`[COMMANDS] Registered ${result.length} commands.`);
}

// ==================================================
// INTERACTION HANDLER
// ==================================================
client.on("interactionCreate", async interaction => {
  try {
    // BUTTONS
    if (interaction.isButton()) {
      const id = interaction.customId;
      const userId = interaction.user.id;

      if (id === "jc_register") {
        return interaction.showModal(registrationModal());
      }

      if (id === "jc_generate_key") {
        if (!(await requireStaff(interaction))) return;
        return interaction.showModal(generateKeyModal());
      }

      if (id === "jc_reset") {
        if (!(await requireStaff(interaction))) return;

        delete db.hwids[userId];
        saveDB();

        return safeReply(interaction, {
          content:
            "♡ Cleared the locally stored HWID field. This does not reset an external authentication provider.",
          ephemeral: true,
        });
      }

      if (id === "jc_key") {
        if (!hasAccess(userId)) {
          return safeReply(interaction, {
            content: "Your access is disabled or blacklisted.",
            ephemeral: true,
          });
        }

        const found = findUserKey(userId);

        if (!found) {
          return safeReply(interaction, {
            content: "No key is assigned to you. Contact staff.",
            ephemeral: true,
          });
        }

        try {
          await interaction.user.send(
            `♡ Your Jayce key: \`${found[0]}\``
          );

          return safeReply(interaction, {
            content: "Key sent to your DMs.",
            ephemeral: true,
          });
        } catch {
          return safeReply(interaction, {
            content: "Enable DMs and try again.",
            ephemeral: true,
          });
        }
      }

      if (id === "jc_script") {
        if (!hasAccess(userId)) {
          return safeReply(interaction, {
            content: "Your access is disabled or blacklisted.",
            ephemeral: true,
          });
        }

        const member = await getMember(interaction.guild, userId);

        if (!member) {
          return safeReply(interaction, {
            content: "Couldn't find your server membership.",
            ephemeral: true,
          });
        }

        const type = member.roles.cache.has(MAIN_ROLE)
          ? "main"
          : member.roles.cache.has(MOBILE_ROLE)
            ? "mobile"
            : null;

        if (!type) {
          return safeReply(interaction, {
            content: "You need a Main or Mobile Main role.",
            ephemeral: true,
          });
        }

        await sendScript(interaction.user, type);

        return safeReply(interaction, {
          content: "Script sent to your DMs.",
          ephemeral: true,
        });
      }

      return;
    }

    // REGISTRATION MODAL
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "jc_register_modal"
    ) {
      const username = interaction.fields
        .getTextInputValue("roblox")
        .trim();

      const submittedKey = interaction.fields
        .getTextInputValue("license_key")
        .trim()
        .toUpperCase();

      const userId = interaction.user.id;

      if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
        return safeReply(interaction, {
          content:
            "❌ Username must be 3–32 letters, numbers, or underscores.",
          ephemeral: true,
        });
      }

      if (isBlocked(userId)) {
        return safeReply(interaction, {
          content: "Your account is blocked. Contact staff.",
          ephemeral: true,
        });
      }

      if (db.accounts[userId]) {
        return safeReply(interaction, {
          content:
            "You already have an account registered. Contact staff for changes.",
          ephemeral: true,
        });
      }

      const keyData = db.keys[submittedKey];

      if (
        !keyData ||
        keyData.userId !== userId ||
        keyData.revoked ||
        keyData.redeemedAt
      ) {
        return safeReply(interaction, {
          content:
            "❌ Invalid key, used key, revoked key, or a key assigned to another Discord account.",
          ephemeral: true,
        });
      }

      keyData.redeemedAt = new Date().toISOString();

      db.accounts[userId] = {
        username,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag,
        key: submittedKey,
      };

      saveDB();

      return safeReply(interaction, {
        embeds: [
          makeEmbed(
            "🎀 Registration Complete",
            `**Roblox username:** ${username}\n**License key:** Verified ♡\n\nContact staff to receive your Main or Mobile 
