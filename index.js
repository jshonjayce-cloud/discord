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
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1552637829815865414";
const MOBILE_ROLE_ID = process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";
const LOADER_URL = "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
const PANEL_COLOR = 0xff7518;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const app = express();
app.get("/", (_req, res) => res.status(200).send("🎃 Jayce Mobile is running! 🦇"));
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", bot: "Jayce Mobile", discord: client.isReady() });
});
app.listen(PORT, "0.0.0.0", () => console.log(`[WEB] Listening on port ${PORT}`));

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;
function startKeepAlive() {
  const urlStr = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const mod = urlStr.startsWith("https") ? https : http;

  setInterval(() => {
    const req = mod.get(urlStr, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.status === "ok") {
            console.log("[KEEP-ALIVE] Ping successful — " + new Date().toLocaleTimeString());
          }
        } catch {}
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("keep-alive timeout"));
    });

    req.on("error", (err) => {
      console.log("[KEEP-ALIVE] Ping failed (expected if just started): " + err.message);
    });
  }, KEEP_ALIVE_INTERVAL);
}
startKeepAlive();

let db = {
  accounts: {},
  access: {},
  keys: {},
  blacklisted: {},
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
        accounts: loaded.accounts || {},
        access: loaded.access || {},
        keys: loaded.keys || {},
        blacklisted: loaded.blacklisted || {},
      };
    }
    saveDatabase();
    console.log("[DATABASE] Loaded successfully.");
  } catch (error) {
    console.error("[DATABASE] Load error:", error);
  }
}
loadDatabase();

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "jayce ♡ soft & secure" })
    .setTimestamp();
}

function replyWithHeart(interaction, options) {
  if (!interaction || !interaction.isRepliable) {
    return Promise.resolve();
  }

  if (typeof options.content === "string" && !options.content.trimStart().startsWith("♡")) {
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

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options);
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

async function getGuildMember(guild, userId) {
  if (!guild) return null;
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

function isStaff(member) {
  return Boolean(member?.roles?.cache?.has(STAFF_ROLE_ID));
}

function getAccount(userId) {
  return db.accounts[userId] || null;
}

function hasOneAccount(userId) {
  return Boolean(db.accounts[userId]);
}

function isBlacklisted(userId) {
  return Boolean(db.blacklisted[userId]);
}

function accessEnabled(userId) {
  return db.access[userId] !== false;
}

function generateKeyForUser(userId) {
  let code;
  do {
    code = makeCode();
  } while (db.keys[code]);

  db.keys[code] = { userId, createdAt: new Date().toISOString(), redeemed: false };
  db.accounts[userId].key = code;
  db.accounts[userId].keyCreatedAt = Date.now();
  saveDatabase();
  return code;
}

async function sendScriptDM(user) {
  const script = `loadstring(game:HttpGet("${LOADER_URL}"))()`;
  const embed = makeEmbed("📱 Jayce Mobile Main", "Here is your mobile script. Keep it private. ♡");
  await user.send({
    embeds: [embed],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

function makePanel() {
  const embed = makeEmbed(
    "🎃 JAYCE MOBILE 🦇",
    [
      "**Welcome to Jayce Mobile!**",
      "",
      "🎀 **Register** — link your Roblox username",
      "📱 **Get Key** — receive your access key",
      "🧩 **Mobile** — send the mobile loader",
      "🛠️ **Reset HWID** — reset your device lock",
      "",
      "*Choose an option below, boo! ♡*",
    ].join("\n")
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("jc_register").setLabel("Register").setEmoji("🎀").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("jc_key").setLabel("Get Key").setEmoji("🔑").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("jc_mobile").setLabel("Mobile").setEmoji("📱").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("jc_resethwid").setLabel("Reset HWID").setEmoji("🛠️").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

const commands = [
  new SlashCommandBuilder().setName("panel").setDescription("Send the Jayce Mobile customer panel"),
  new SlashCommandBuilder().setName("adminpanel").setDescription("View the Jayce Mobile admin panel"),
  new SlashCommandBuilder().setName("generate-key").setDescription("Generate a key for a user").addUserOption((o) => o.setName("user").setDescription("User receiving the key").setRequired(true)),
  new SlashCommandBuilder().setName("account").setDescription("View a user's Jayce account").addUserOption((o) => o.setName("user").setDescription("Account to inspect").setRequired(true)),
  new SlashCommandBuilder().setName("grantaccess").setDescription("Grant access to Jayce Mobile").addUserOption((o) => o.setName("user").setDescription("User to grant access").setRequired(true)),
  new SlashCommandBuilder().setName("disableaccess").setDescription("Disable a user's Jayce access").addUserOption((o) => o.setName("user").setDescription("User to disable").setRequired(true)),
  new SlashCommandBuilder().setName("lookup").setDescription("Look up a buyer").addStringOption((o) => o.setName("query").setDescription("Discord ID or Roblox username").setRequired(true)),
  new SlashCommandBuilder().setName("revoke").setDescription("Revoke a buyer's Jayce access").addUserOption((o) => o.setName("user").setDescription("Buyer to revoke").setRequired(true)),
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

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const member = await getGuildMember(interaction.guild, userId);

      if (!member || !member.roles.cache.has(MOBILE_ROLE_ID)) {
        return replyWithHeart(interaction, {
          content: "You need the Mobile Main role to use these buttons.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_register") {
        if (hasOneAccount(userId)) {
          return replyWithHeart(interaction, {
            content: "You already have one account. You can only make one account.",
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
          .setMaxLength(32);

        modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
        return interaction.showModal(modal);
      }

      if (interaction.customId === "jc_key") {
        const record = getAccount(userId);
        if (!record) {
          return replyWithHeart(interaction, {
            content: "You do not have an account yet. Use Register first.",
            ephemeral: true,
          });
        }

        try {
          await interaction.user.send({
            embeds: [makeEmbed("🔑 Your Jayce Key", `Your key is:\n\n\`${record.key}\`\n\nKeep it private.`)],
          });
          return replyWithHeart(interaction, {
            content: "Your key was sent to your DMs.",
            ephemeral: true,
          });
        } catch {
          return replyWithHeart(interaction, {
            content: `I could not DM you. Your key is:\n\`${record.key}\``,
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === "jc_mobile") {
        if (isBlacklisted(userId)) {
          return replyWithHeart(interaction, { content: "⛔ Your account is blacklisted.", ephemeral: true });
        }
        if (!accessEnabled(userId)) {
          return replyWithHeart(interaction, { content: "🔒 Your Jayce access is disabled. Contact staff.", ephemeral: true });
        }

        const record = getAccount(userId);
        if (!record || !record.key) {
          return replyWithHeart(interaction, {
            content: "Register first and generate your key before using Mobile.",
            ephemeral: true,
          });
        }

        try {
          await sendScriptDM(interaction.user);
          return replyWithHeart(interaction, { content: "📱 Mobile loader was sent to your DMs.", ephemeral: true });
        } catch {
          return replyWithHeart(interaction, { content: "I couldn't DM you. Enable server DMs and try again.", ephemeral: true });
        }
      }

      if (interaction.customId === "jc_resethwid") {
        const record = getAccount(userId);
        if (!record) {
          return replyWithHeart(interaction, { content: "You do not have an account yet. Use Register first.", ephemeral: true });
        }

        record.hwid = null;
        saveDatabase();
        return replyWithHeart(interaction, { content: "♡ HWID reset complete.", ephemeral: true });
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "jc_register_modal") {
      const username = interaction.fields.getTextInputValue("roblox_username").trim();
      const userId = interaction.user.id;

      if (!username) {
        return replyWithHeart(interaction, { content: "Please enter a valid username.", ephemeral: true });
      }

      if (hasOneAccount(userId)) {
        return replyWithHeart(interaction, {
          content: "You already have one account. You can only make one account.",
          ephemeral: true,
        });
      }

      const key = makeCode();
      db.accounts[userId] = {
        username,
        key,
        hwid: null,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag,
      };
      db.access[userId] = true;
      db.keys[key] = { userId, createdAt: new Date().toISOString(), redeemed: false };
      saveDatabase();

      try {
        await interaction.user.send({
          embeds: [makeEmbed("♡ Registration Complete", `**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}\n**Key:** \`${key}\``)],
        });
      } catch {
        // no-op: DM may be blocked, but the account still exists
      }

      return replyWithHeart(interaction, {
        embeds: [makeEmbed("♡ Registration Complete", `**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}\n**Key:** \`${key}\``)],
        ephemeral: true,
      });
    }

    if (!interaction.isChatInputCommand()) return;

    if (!isStaff(interaction.member)) {
      return replyWithHeart(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const commandName = interaction.commandName;

    if (commandName === "panel") {
      return replyWithHeart(interaction, makePanel());
    }

    if (commandName === "adminpanel") {
      const embed = makeEmbed("♡ Jayce Mobile Admin Panel", [
        "**Account Management**",
        "`/account` — inspect an account",
        "`/grantaccess` — grant access",
        "`/disableaccess` — disable access",
        "`/generate-key` — generate a key",
        "",
        "**Buyer tools**",
        "`/lookup` — search buyer details",
        "`/revoke` — revoke access",
      ].join("\n"));

      return replyWithHeart(interaction, { embeds: [embed], ephemeral: true });
    }

    if (commandName === "generate-key") {
      const user = interaction.options.getUser("user", true);
      const record = getAccount(user.id);

      if (!record) {
        return replyWithHeart(interaction, { content: "No account found for that user.", ephemeral: true });
      }

      const key = generateKeyForUser(user.id);
      try {
        await user.send({
          embeds: [makeEmbed("🔑 New Jayce Key", `Your key is:\n\n\`${key}\``)],
        });
      } catch {
        // no-op
      }

      return replyWithHeart(interaction, {
        content: `New key generated for ${user}: \`${key}\``,
        ephemeral: true,
      });
    }

    if (commandName === "account") {
      const user = interaction.options.getUser("user", true);
      const record = getAccount(user.id);
      if (!record) {
        return replyWithHeart(interaction, { content: "No account found for that user.", ephemeral: true });
      }

      return replyWithHeart(interaction, {
        embeds: [makeEmbed("♡ Jayce Account", `**Discord:** ${user.tag}\n**Roblox:** ${record.username}\n**Key:** \`${record.key}\`\n**HWID:** ${record.hwid ? "Locked" : "Open"}`)],
        ephemeral: true,
      });
    }

    if (commandName === "grantaccess") {
      const user = interaction.options.getUser("user", true);
      db.access[user.id] = true;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access granted for ${user}.`, ephemeral: true });
    }

    if (commandName === "disableaccess") {
      const user = interaction.options.getUser("user", true);
      db.access[user.id] = false;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access disabled for ${user}.`, ephemeral: true });
    }

    if (commandName === "lookup") {
      const query = interaction.options.getString("query", true).trim();
      const account = Object.entries(db.accounts).find(([id, value]) => {
        const matchUsername = value.username?.toLowerCase() === query.toLowerCase();
        const matchDiscord = value.discordTag === query;
        const matchId = id === query;
        return matchUsername || matchDiscord || matchId;
      });

      if (!account) {
        return replyWithHeart(interaction, { content: "No buyer found for that lookup.", ephemeral: true });
      }

      const [userId, record] = account;
      return replyWithHeart(interaction, {
        content: `**User ID:** ${userId}\n**Roblox:** ${record.username}\n**Discord:** ${record.discordTag}`,
        ephemeral: true,
      });
    }

    if (commandName === "revoke") {
      const user = interaction.options.getUser("user", true);
      delete db.accounts[user.id];
      db.access[user.id] = false;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access revoked for ${user}.`, ephemeral: true });
    }
  } catch (error) {
    console.error("[INTERACTION] Error:", error);
    if (interaction && interaction.isRepliable && !interaction.replied) {
      return interaction.reply({ content: "An unexpected error occurred.", ephemeral: true });
    }
  }
});

client.once("ready", () => {
  registerCommands().catch((error) => console.error("[COMMANDS] Registration failed:", error));
  console.log("[Bot Online] Logged into Discord as " + client.user.tag);
});

client.login(TOKEN);
