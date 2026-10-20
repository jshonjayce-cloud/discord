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

const STAFF_ROLE_ID = "1552637829815865414";
const MOBILE_MAIN_ROLE_ID = process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";
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
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.status === "ok") {
            console.log("[KEEP-ALIVE] Ping successful — " + new Date().toLocaleTimeString());
          }
        } catch {}
      });
    });

    req.on("error", (err) => {
      console.log("[KEEP-ALIVE] Ping failed (expected if just started): " + err.message);
    });
  }, KEEP_ALIVE_INTERVAL);
}
startKeepAlive();

let db = {
  accounts: {},
  keys: {},
  access: {},
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
        keys: loaded.keys || {},
        access: loaded.access || {},
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
    .setFooter({ text: "🎃 jayce ♡ spooky & secure 🦇" })
    .setTimestamp();
}

function replyWithHeart(interaction, options) {
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

function isBlacklisted(userId) {
  return Boolean(db.blacklisted[userId]);
}

function accessEnabled(userId) {
  return db.access[userId] !== false;
}

async function sendScriptDM(user) {
  const script = `loadstring(game:HttpGet("https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua"))()`;
  const embed = makeEmbed("📱 Jayce Mobile Main", "Here is your mobile script. Keep it private. ♡");
  await user.send({ embeds: [embed], content: `\`\`\`lua\n${script}\n\`\`\`` });
}

const commands = [
  new SlashCommandBuilder().setName("panel").setDescription("Send the Jayce Mobile customer panel"),
  new SlashCommandBuilder().setName("adminpanel").setDescription("View the Jayce Mobile admin panel"),
  new SlashCommandBuilder().setName("announce").setDescription("Send an announcement").addStringOption((o) => o.setName("message").setDescription("Announcement text").setRequired(true)).addChannelOption((o) => o.setName("channel").setDescription("Channel to announce in")),
  new SlashCommandBuilder().setName("generate-key").setDescription("Generate a Jayce access code").addUserOption((o) => o.setName("user").setDescription("User receiving the code").setRequired(true)),
  new SlashCommandBuilder().setName("mobile-script").setDescription("Send a buyer their mobile script").addUserOption((o) => o.setName("user").setDescription("Buyer receiving the script").setRequired(true)),
  new SlashCommandBuilder().setName("account").setDescription("View a user's Jayce account").addUserOption((o) => o.setName("user").setDescription("Account to inspect").setRequired(true)),
  new SlashCommandBuilder().setName("disableaccess").setDescription("Disable a user's Jayce access").addUserOption((o) => o.setName("user").setDescription("User to disable").setRequired(true)),
  new SlashCommandBuilder().setName("grantaccess").setDescription("Grant access to Jayce Mobile").addUserOption((o) => o.setName("user").setDescription("User to grant access").setRequired(true)),
  new SlashCommandBuilder().setName("blacklist").setDescription("Blacklist a user").addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason for blacklist")),
  new SlashCommandBuilder().setName("unblacklist").setDescription("Remove a user's blacklist").addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member from this server").addUserOption((o) => o.setName("user").setDescription("Member to ban").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason for ban")),
  new SlashCommandBuilder().setName("lookup").setDescription("Look up a buyer").addStringOption((o) => o.setName("query").setDescription("Discord ID or Roblox username").setRequired(true)),
  new SlashCommandBuilder().setName("revoke").setDescription("Revoke a buyer's Jayce access").addUserOption((o) => o.setName("user").setDescription("Buyer to revoke").setRequired(true)),
  new SlashCommandBuilder().setName("forceresethwid").setDescription("Clear a buyer's locally saved HWID").addUserOption((o) => o.setName("user").setDescription("Buyer whose HWID should be cleared").setRequired(true)),
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

      if (!member || !member.roles.cache.has(MOBILE_MAIN_ROLE_ID)) {
        return replyWithHeart(interaction, {
          content: "You need the Mobile Main role to use these buttons.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_register") {
        const modal = new ModalBuilder().setCustomId("jc_register_modal").setTitle("♡ Jayce Registration");
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

      if (interaction.customId === "jc_mobile") {
        if (isBlacklisted(userId)) {
          return replyWithHeart(interaction, { content: "⛔ Your account is blacklisted.", ephemeral: true });
        }
        if (!accessEnabled(userId)) {
          return replyWithHeart(interaction, { content: "🔒 Your Jayce access is disabled. Contact staff.", ephemeral: true });
        }

        try {
          await sendScriptDM(interaction.user);
          return replyWithHeart(interaction, { content: "📱 Mobile Main was sent to your DMs.", ephemeral: true });
        } catch {
          return replyWithHeart(interaction, { content: "I couldn't DM you. Enable server DMs and try again.", ephemeral: true });
        }
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "jc_register_modal") {
      const username = interaction.fields.getTextInputValue("roblox_username").trim();
      if (!username) {
        return replyWithHeart(interaction, { content: "Please enter a valid username.", ephemeral: true });
      }

      db.accounts[interaction.user.id] = {
        username,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag,
      };
      saveDatabase();

      return replyWithHeart(interaction, {
        embeds: [makeEmbed("♡ Registration Complete", `**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}`)],
        ephemeral: true,
      });
    }

    if (!interaction.isChatInputCommand()) return;

    if (!isStaff(interaction.member)) {
      return replyWithHeart(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const commandName = interaction.commandName;

    if (commandName === "panel") {
      const embed = makeEmbed("🎃 JAYCE MOBILE 🦇", [
        "**Welcome to Jayce Mobile!**",
        "",
        "🎀 **Register** — link your Roblox username",
        "📱 **Get Mobile Script** — receive your mobile loader",
        "",
        "*Choose an option below, boo! ♡*",
      ].join("\n"));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("jc_register").setLabel("Register").setEmoji("🎀").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("jc_mobile").setLabel("Get Mobile Script").setEmoji("📱").setStyle(ButtonStyle.Success)
      );

      return replyWithHeart(interaction, { embeds: [embed], components: [row] });
    }

    if (commandName === "adminpanel") {
      const embed = makeEmbed("♡ Jayce Mobile Admin Panel", [
        "**Account Management**",
        "`/account` — inspect an account",
        "`/grantaccess` — grant access",
        "`/disableaccess` — disable access",
        "`/generate-key` — generate a key",
        "",
        "**Scripts**",
        "`/mobile-script` — send the mobile script",
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
        "`/forceresethwid` — clear locally saved HWID",
      ].join("\n"));

      return replyWithHeart(interaction, { embeds: [embed], ephemeral: true });
    }

    if (commandName === "announce") {
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel") || interaction.channel;

      if (!channel?.isTextBased() || !channel.send) {
        return replyWithHeart(interaction, { content: "Please select a text channel.", ephemeral: true });
      }

      await channel.send({ embeds: [makeEmbed("♡ Jayce Mobile Announcement", message)] });
      return replyWithHeart(interaction, { content: `Announcement sent to ${channel}.`, ephemeral: true });
    }

    if (commandName === "generate-key") {
      const user = interaction.options.getUser("user", true);
      let code;
      do {
        code = makeCode();
      } while (db.keys[code]);

      db.keys[code] = { userId: user.id, createdAt: new Date().toISOString(), redeemed: false };
      saveDatabase();

      try {
        await user.send({ embeds: [makeEmbed("♡ Your Jayce Access Code", `Your access code is:\n\n\`${code}\`\n\nKeep it private.`)] });
        return replyWithHeart(interaction, { content: `Access code generated and sent to ${user}.`, ephemeral: true });
      } catch {
        return replyWithHeart(interaction, { content: `I couldn't DM ${user}. Their code is:\n\`${code}\``, ephemeral: true });
      }
    }

    if (commandName === "mobile-script") {
      const user = interaction.options.getUser("user", true);
      const member = await getGuildMember(interaction.guild, user.id);

      if (isBlacklisted(user.id)) {
        return replyWithHeart(interaction, { content: "⛔ That user is blacklisted.", ephemeral: true });
      }
      if (!accessEnabled(user.id)) {
        return replyWithHeart(interaction, { content: "🔒 That user's Jayce access is disabled.", ephemeral: true });
      }
      if (!member) {
        return replyWithHeart(interaction, { content: "That user isn't a member of this server.", ephemeral: true });
      }
      if (!member.roles.cache.has(MOBILE_MAIN_ROLE_ID)) {
        return replyWithHeart(interaction, { content: "That user doesn't have the required Mobile Main role.", ephemeral: true });
      }

      try {
        await sendScriptDM(user);
        return replyWithHeart(interaction, { content: `♡ Sent the Mobile script to ${user}.`, ephemeral: true });
      } catch {
        return replyWithHeart(interaction, { content: `I couldn't DM ${user}. They may need to enable server DMs.`, ephemeral: true });
      }
    }

    if (commandName === "account") {
      const user = interaction.options.getUser("user", true);
      const record = db.accounts[user.id];
      if (!record) {
        return replyWithHeart(interaction, { content: "No account found for that user.", ephemeral: true });
      }
      return replyWithHeart(interaction, {
        embeds: [makeEmbed("♡ Jayce Account", `**Discord:** ${user.tag}\n**Roblox:** ${record.username}\n**Registered:** ${record.registeredAt}`)],
        ephemeral: true,
      });
    }

    if (commandName === "disableaccess") {
      const user = interaction.options.getUser("user", true);
      db.access[user.id] = false;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access disabled for ${user}.`, ephemeral: true });
    }

    if (commandName === "grantaccess") {
      const user = interaction.options.getUser("user", true);
      db.access[user.id] = true;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access granted for ${user}.`, ephemeral: true });
    }

    if (commandName === "blacklist") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "No reason given";
      db.blacklisted[user.id] = reason;
      saveDatabase();
      return replyWithHeart(interaction, { content: `Blacklisted ${user}.`, ephemeral: true });
    }

    if (commandName === "unblacklist") {
      const user = interaction.options.getUser("user", true);
      delete db.blacklisted[user.id];
      saveDatabase();
      return replyWithHeart(interaction, { content: `Removed ${user} from blacklist.`, ephemeral: true });
    }

    if (commandName === "ban") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "No reason given";
      const member = await getGuildMember(interaction.guild, user.id);
      if (member) await member.ban({ reason });
      return replyWithHeart(interaction, { content: `Banned ${user}.`, ephemeral: true });
    }

    if (commandName === "lookup") {
      const query = interaction.options.getString("query", true).trim();
      const account = Object.entries(db.accounts).find(([_, value]) => value.username?.toLowerCase() === query.toLowerCase() || value.discordTag === query || _ === query);
      if (!account) {
        return replyWithHeart(interaction, { content: "No buyer found for that lookup.", ephemeral: true });
      }
      const [userId, record] = account;
      return replyWithHeart(interaction, { content: `**User ID:** ${userId}\n**Roblox:** ${record.username}\n**Discord:** ${record.discordTag}`, ephemeral: true });
    }

    if (commandName === "revoke") {
      const user = interaction.options.getUser("user", true);
      db.access[user.id] = false;
      delete db.accounts[user.id];
      saveDatabase();
      return replyWithHeart(interaction, { content: `Access revoked for ${user}.`, ephemeral: true });
    }

    if (commandName === "forceresethwid") {
      const user = interaction.options.getUser("user", true);
      return replyWithHeart(interaction, { content: `HWID reset requested for ${user}.`, ephemeral: true });
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
