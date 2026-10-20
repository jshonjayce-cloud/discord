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

// ==================== DISCORD CLIENT ====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ==================== RENDER KEEP-ALIVE SERVER ====================
const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("🎃 Jayce Main is running! 🦇");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    bot: "Jayce Main",
    discord: client.isReady(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WEB] Listening on port ${PORT}`);
});

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
            console.log(
              "[KEEP-ALIVE] Ping successful — " +
                new Date().toLocaleTimeString()
            );
          }
        } catch {
          // ignore invalid responses
        }
      });
    });

    req.on("error", (err) => {
      console.log(
        "[KEEP-ALIVE] Ping failed (expected if just started): " + err.message
      );
    });
  }, KEEP_ALIVE_INTERVAL);
}

startKeepAlive();

// ==================== DATABASE ====================
let db = {
  keys: {},
  blacklisted: {},
  hwids: {},
  accounts: {},
  access: {},
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
        hwids: loaded.hwid || {},
        accounts: loaded.accounts || {},
        access: loaded.access || {},
      };
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
      // embed may be an EmbedBuilder instance
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

async function hasRequiredPanelRole(guild, userId) {
  const member = await getGuildMember(guild, userId);

  if (!member) return false;

  return member.roles.cache.has(MOBILE_MAIN_ROLE_ID);
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

// ==================== SLASH COMMANDS ====================
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
      o
        .setName("query")
        .setDescription("Discord ID or Roblox username")
        .setRequired(true)
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

// ==================== REGISTER COMMANDS ====================
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

// ==================== INTERACTION HANDLER ====================
client.on("interactionCreate", async (interaction) => {
  try {
    // Customer panel buttons
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

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput)
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

      if (
        interaction.customId === "jc_key" ||
        interaction.customId === "jc_mobilemain"
      ) {
        const member = await getGuildMember(interaction.guild, userId);

        if (!member) {
          return replyWithHeart(interaction, {
            content: "I couldn't find you in this server.",
            ephemeral: true,
          });
        }

        const mobile = interaction.customId === "jc_mobilemain";
        const requiredRole = mobile ? MOBILE_MAIN_ROLE_ID : MAIN_ROLE_ID;

        if (!member.roles.cache.has(requiredRole)) {
          return replyWithHeart(interaction, {
            content: mobile
              ? "You don't have the Mobile Main role."
              : "You don't have the Jayce Main role.",
            ephemeral: true,
          });
        }

        try {
          await sendScriptDM(interaction.user, mobile ? "mobile" : "main");

          return replyWithHeart(interaction, {
            content: mobile
              ? "📱 Mobile Main was sent to your DMs."
              : "💗 Jayce Main was sent to your DMs.",
            ephemeral: true,
          });
        } catch {
          return replyWithHeart(interaction, {
            content: "I couldn't DM you. Enable server DMs and try again.",
            ephemeral: true,
          });
        }
      }

      return;
    }

    // Registration modal
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "jc_register_modal"
    ) {
      const username = interaction.fields
        .getTextInputValue("roblox_username")
        .trim();

      if (!username) {
        return replyWithHeart(interaction, {
          content: "Please enter a valid username.",
          ephemeral: true,
        });
      }

      db.accounts[interaction.user.id] = {
        username,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag,
      };

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

    if (!interaction.isChatInputCommand()) return;

    if (!isStaff(interaction.member)) {
      return replyWithHeart(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const commandName = interaction.commandName;

    // Send customer panel
    if (commandName === "panel") {
      const embed = makeEmbed(
        "🎃 JAYCE MAIN 🦇",
        [
          "**Welcome to Jayce Main!**",
          "",
          "🎀 **Register** — link your Roblox username",
          "🕸️ **Get Script** — receive your Main script",
          "📱 **Mobile Main** — receive the mobile loader",
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
          .setLabel("Get Script")
          .setEmoji("🕸️")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("jc_mobilemain")
          .setLabel("Mobile Main")
          .setEmoji("📱")
          .setStyle(ButtonStyle.Success),
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

    // Admin panel
    if (commandName === "adminpanel") {
      const embed = makeEmbed(
        "♡ Jayce Main Admin Panel",
        [
          "**Account Management**",
          "`/account` — inspect an account",
          "`/grantaccess` — grant access",
          "`/disableaccess` — disable access",
          "`/generate-key` — generate a key",
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

    // Announcements
    if (commandName === "announce") {
      const message = interaction.options.getString("message", true);
      const channel =
        interaction.options.getChannel("channel") || interaction.channel;

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

    // Generate access key
    if (commandName === "generate-key") {
      const user = interaction.options.getUser("user", true);
      let code;

      do {
        code = makeCode();
      } while (db.keys[code]);

      db.keys[code] = {
        userId: user.id,
        createdAt: new Date().toISOString(),
        redeemed: false,
      };

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

    // Send script to buyer
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

    // other command branches omitted in snippet; existing logic continues below
  } catch (error) {
    console.error("[INTERACTION] Error:", error);

    if (interaction && interaction.isRepliable && !interaction.replied) {
      return interaction.reply({
        content: "An unexpected error occurred.",
        ephemeral: true,
      });
    }
  }
});

// If you want to register commands when the bot starts:
client.once("ready", () => {
  registerCommands().catch((error) => {
    console.error("[COMMANDS] Registration failed:", error);
  });
});

client.login(TOKEN);
