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
    status: "online",
    bot: "Jayce Main",
    discord: client.isReady(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WEB] Listening on port ${PORT}`);
});

// ==================== KEEP-ALIVE PINGS ====================
// Configure KEEP_ALIVE_URL to your public service URL (e.g. https://your-service.onrender.com/)
// or an external hc-ping / UptimeRobot / Pingdom endpoint. If not set, no pings run.
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
        // consume body to avoid memory leaks
        res.on("data", () => {});
        res.on("end", () => {
          // optional: could log res.statusCode in debug mode
        });
      });

      req.on("error", (err) => {
        console.error("[KEEPALIVE] Ping error:", err.message);
      });

      // safety timeout
      req.setTimeout(10_000, () => {
        req.abort();
      });
    } catch (err) {
      console.error("[KEEPALIVE] Invalid KEEP_ALIVE_URL:", err.message);
    }
  }

  // ping every 4 minutes (use a value < 10 minutes for many free hosts)
  const INTERVAL_MS = 4 * 60 * 1000;
  setInterval(pingKeepAlive, INTERVAL_MS);

  // initial delayed ping so server has started
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

    // Account details
    if (commandName === "account") {
      const user = interaction.options.getUser("user", true);
      const account = db.accounts[user.id];
      const member = await getGuildMember(interaction.guild, user.id);

      const codes = Object.entries(db.keys)
        .filter(([, data]) => data.userId === user.id)
        .map(
          ([code, data]) =>
            `${code} — ${data.redeemed ? "Redeemed" : "Not redeemed"}`
        );

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

    // Disable access
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

    // Grant access
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

    // Blacklist
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

    // Unblacklist
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

    // Ban
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

    // Lookup buyer
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

    // Revoke access
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
          roleWarning =
            "\n⚠️ I couldn't remove all roles. Check the bot's role hierarchy.";
        }
      }

      return replyWithHeart(interaction, {
        content: `🔒 Revoked Jayce access for ${user}.${roleWarning}`,
        ephemeral: true,
      });
    }

    // DM buyer update
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

    // Clear locally stored HWID
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
          cleared = true;
        }
      }

      saveDatabase();

      return replyWithHeart(interaction, {
        content: cleared
          ? `♡ Cleared locally saved HWID data for ${user}.`
          : `No locally saved HWID was found for ${user}. An HWID stored in FlowAuth must be reset there separately.`,
        ephemeral: true,
      });
    }

    // List accounts
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

// ==================== BOT READY ====================
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMANDS] Registration failed:", error);
  }
});

// ==================== LOGIN ====================
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
