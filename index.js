
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
  TextInputStyle
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

// ========================================
// CONFIGURATION
// ========================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1552637829815865414";
const GET_SCRIPT_ROLE_ID = "15543211313332469800";

const MOBILE_MAIN_URL = process.env.MOBILE_MAIN_URL || "";

const GET_SCRIPT_TEXT =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/576df60d62347e98101fde14e20dfc98.lua"))()';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Set DISCORD_TOKEN, CLIENT_ID and GUILD_ID in Render Environment."
  );
}

// ========================================
// DATABASE
// ========================================

const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {
      keys: {},
      blacklisted: {},
      hwids: {},
      accounts: {}
    };
  }
}

const db = loadDB();

db.keys ||= {};
db.blacklisted ||= {};
db.hwids ||= {};
db.accounts ||= {};

function saveDB() {
  const tempFile = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(db, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(tempFile, DB_FILE);
}

function makeKey() {
  return (
    "JAYCE-" +
    crypto.randomBytes(4).toString("hex").toUpperCase() +
    "-" +
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

// Securely hash passwords instead of saving plaintext.
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function hasAccess(interaction) {
  const roles = interaction.member?.roles;

  if (Array.isArray(roles)) {
    return roles.includes(ADMIN_ROLE_ID);
  }

  return roles?.cache?.has(ADMIN_ROLE_ID) ?? false;
}

function hasRole(member, roleId) {
  const roles = member?.roles;

  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }

  return roles?.cache?.has(roleId) ?? false;
}

// ========================================
// SLASH COMMANDS
// ========================================

const commands = [
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a Jayce announcement")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Announcement channel")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement message")
        .setRequired(true)
        .setMaxLength(2000)
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a Jayce license key")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Optional key owner")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("reset-hwid")
    .setDescription("Reset a license key HWID")
    .addStringOption(option =>
      option
        .setName("key")
        .setDescription("License key")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user or license key")
    .addStringOption(option =>
      option
        .setName("target")
        .setDescription("Discord user ID or license key")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a blacklist entry")
    .addStringOption(option =>
      option
        .setName("target")
        .setDescription("Discord user ID or license key")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to ban")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Jayce Main panel"),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered Jayce accounts")
].map(command => command.toJSON());

// ========================================
// BOT STARTUP
// ========================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Jayce slash commands registered.");
}

client.once("ready", () => {
  console.log(`Jayce bot online as ${client.user.tag}`);
});

// ========================================
// PANEL DESIGN — NO GET KEY BUTTON
// ========================================

function createPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription([
      "Welcome to **Jayce Main** ♡",
      "",
      "୨୧ **Register** — Create your account",
      "୨୧ **Get Script** — Receive the main loader",
      "୨୧ **Mobile Main** — Receive the mobile loader",
      "୨୧ **Reset HWID** — Clear the bot-side HWID record",
      "",
      "♡ Keep your account details private!"
    ].join("\n"))
    .setFooter({ text: "jayce  ♡  soft & secure" })
    .setTimestamp();
}

function createPanelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_register")
      .setLabel("♡ Register")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("jc_main")
      .setLabel("♡ Get Script")
      .setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_mobilemain")
      .setLabel("♡ Mobile Main")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("jc_resethwid")
      .setLabel("♡ Reset HWID")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

// ========================================
// INTERACTIONS
// ========================================

client.on("interactionCreate", async interaction => {
  try {
    // ------------------------------------
    // BUTTONS
    // ------------------------------------

    if (interaction.isButton()) {
      const userId = interaction.user.id;

      // REGISTER BUTTON
      if (interaction.customId === "jc_register") {
        const modal = new ModalBuilder()
          .setCustomId("jc_register_modal")
          .setTitle("♡ Register Jayce Main");

        const usernameInput = new TextInputBuilder()
          .setCustomId("register_username")
          .setLabel("Create a username")
          .setPlaceholder("3–24 characters")
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(24)
          .setRequired(true);

        const passwordInput = new TextInputBuilder()
          .setCustomId("register_password")
          .setLabel("Create a password")
          .setPlaceholder("Use a unique password")
          .setStyle(TextInputStyle.Short)
          .setMinLength(8)
          .setMaxLength(100)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
          new ActionRowBuilder().addComponents(passwordInput)
        );

        return await interaction.showModal(modal);
      }

      // GET MAIN SCRIPT
      if (interaction.customId === "jc_main") {
        if (!interaction.inGuild()) {
          return await interaction.reply({
            content: "Use this button inside the Jayce server.",
            ephemeral: true
          });
        }

        if (!hasRole(interaction.member, GET_SCRIPT_ROLE_ID)) {
          return await interaction.reply({
            content: "♡ You don't have the required role.",
            ephemeral: true
          });
        }

        try {
          await interaction.user.send({
            content: [
              "♡ **Jayce Main Loader**",
              "",
              "```lua",
              GET_SCRIPT_TEXT,
              "```",
              "",
              "Keep your loader private."
            ].join("\n")
          });

          return await interaction.reply({
            content: "♡ Check your DMs for the loader!",
            ephemeral: true
          });
        } catch {
          return await interaction.reply({
            content:
              "I couldn't DM you. Enable direct messages from server members and try again.",
            ephemeral: true
          });
        }
      }

      // MOBILE MAIN
      if (interaction.customId === "jc_mobilemain") {
        if (!MOBILE_MAIN_URL) {
          return await interaction.reply({
            content:
              "♡ The mobile loader URL isn't configured. Contact staff.",
            ephemeral: true
          });
        }

        if (!hasRole(interaction.member, GET_SCRIPT_ROLE_ID)) {
          return await interaction.reply({
            content: "♡ You don't have the required role.",
            ephemeral: true
          });
        }

        try {
          await interaction.user.send({
            content:
              "♡ **Jayce Mobile Main**\n\nYour mobile loader:\n" +
              MOBILE_MAIN_URL
          });

          return await interaction.reply({
            content: "♡ Check your DMs for the mobile loader!",
            ephemeral: true
          });
        } catch {
          return await interaction.reply({
            content:
              "I couldn't DM you. Enable direct messages from server members and try again.",
            ephemeral: true
          });
        }
      }

      // RESET HWID BUTTON
      if (interaction.customId === "jc_resethwid") {
        const modal = new ModalBuilder()
          .setCustomId("jc_resethwid_modal")
          .setTitle("♡ Reset HWID");

        const keyInput = new TextInputBuilder()
          .setCustomId("license_key")
          .setLabel("Your registered license key")
          .setPlaceholder("JAYCE-XXXXXXXX-XXXXXXXX")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(
          new ActionRowBuilder().addComponents(keyInput)
        );

        return await interaction.showModal(modal);
      }
    }

    // ------------------------------------
    // MODAL SUBMISSIONS
    // ------------------------------------

    if (interaction.isModalSubmit()) {
      const userId = interaction.user.id;

      // REGISTER USERNAME + PASSWORD
      if (interaction.customId === "jc_register_modal") {
        const username = interaction.fields
          .getTextInputValue("register_username")
          .trim();

        const password = interaction.fields
          .getTextInputValue("register_password");

        if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
          return await interaction.reply({
            content:
              "♡ Usernames must be 3–24 characters and contain only letters, numbers, underscores, periods, or hyphens.",
            ephemeral: true
          });
        }

        if (password.length < 8 || password.length > 100) {
          return await interaction.reply({
            content: "♡ Your password must be 8–100 characters.",
            ephemeral: true
          });
        }

        if (db.blacklisted[userId]) {
          return await interaction.reply({
            content: "♡ Your account is blacklisted.",
            ephemeral: true
          });
        }

        if (db.accounts[userId]) {
          return await interaction.reply({
            content:
              "♡ You already have a Jayce account. Contact staff if you need help.",
            ephemeral: true
          });
        }

        const usernameKey = normalizeUsername(username);

        const usernameTaken = Object.values(db.accounts).some(
          account => normalizeUsername(account.username) === usernameKey
        );

        if (usernameTaken) {
          return await interaction.reply({
            content: "♡ That username is already taken.",
            ephemeral: true
          });
        }

        const { salt, hash } = hashPassword(password);

        db.accounts[userId] = {
          username,
          salt,
          passwordHash: hash,
          createdAt: new Date().toISOString()
        };

        saveDB();

        return await interaction.reply({
          content: [
            "♡ **Registration successful!**",
            "",
            `Username: \`${username}\``,
            "Your account is linked to your Discord ID.",
            "",
            "For a license key, contact staff."
          ].join("\n"),
          ephemeral: true
        });
      }

      // RESET HWID MODAL
      if (interaction.customId === "jc_resethwid_modal") {
        const key = normalizeKey(
          interaction.fields.getTextInputValue("license_key")
        );

        const record = db.keys[key];

        if (!record || record.active !== true) {
          return await interaction.reply({
            content: "♡ That key is invalid or inactive.",
            ephemeral: true
          });
        }

        if (
          record.ownerId !== userId &&
          !hasAccess(interaction)
        ) {
          return await interaction.reply({
            content: "♡ You can only reset your own registered key.",
            ephemeral: true
          });
        }

        if (db.blacklisted[key] || db.blacklisted[userId]) {
          return await interaction.reply({
            content: "♡ This key or account is blacklisted.",
            ephemeral: true
          });
        }

        // Clears the bot-side HWID record only.
        record.hwid = null;
        delete db.hwids[key];
        record.hwidResetAt = new Date().toISOString();

        saveDB();

        return await interaction.reply({
          content:
            "♡ The bot-side HWID record was cleared. Verify FlowAuth separately if it stores its own HWID.",
          ephemeral: true
        });
      }
    }

    // ------------------------------------
    // SLASH COMMANDS
    // ------------------------------------

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.inGuild()) {
      return await interaction.reply({
        content: "This command must be used in the server.",
        ephemeral: true
      });
    }

    if (!hasAccess(interaction)) {
      return await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true
      });
    }

    const command = interaction.commandName;

    // ANNOUNCE
    if (command === "announce") {
      const channel = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message");

      if (!channel || typeof channel.send !== "function") {
        return await interaction.reply({
          content: "That channel cannot receive messages.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("♡ Jayce Main Announcement")
        .setDescription(message)
        .setFooter({ text: "jayce  ♡  soft & secure" })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      return await interaction.reply({
        content: "♡ Announcement sent!",
        ephemeral: true
      });
    }

    // GENERATE KEY
    if (command === "generate-key") {
      const user = interaction.options.getUser("user");

      let key = makeKey();
      while (db.keys[key]) key = makeKey();

      db.keys[key] = {
        active: true,
        ownerId: user?.id || null,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        hwid: null
      };

      saveDB();

      if (user) {
        try {
          await user.send(
            `♡ Your Jayce Main license key:\n\`${key}\``
          );
        } catch {
          // Key is still created if DMs are closed.
        }
      }

      return await interaction.reply({
        content: [
          "♡ **License key created**",
          `Key: \`${key}\``,
          user ? `Assigned to: ${user.tag}` : "Not assigned to a user.",
          user ? "The key was also sent by DM if DMs are open." : ""
        ].filter(Boolean).join("\n"),
        ephemeral: true
      });
    }

    // RESET HWID SLASH COMMAND
    if (command === "reset-hwid") {
      const key = normalizeKey(
        interaction.options.getString("key")
      );

      const record = db.keys[key];

      if (!record) {
        return await interaction.reply({
          content: "That license key was not found.",
          ephemeral: true
        });
      }

      record.hwid = null;
      delete db.hwids[key];
      record.hwidResetAt = new Date().toISOString();

      saveDB();

      return await interaction.reply({
        content:
          `♡ Bot-side HWID record cleared for \`${key}\`. Verify FlowAuth separately if it stores its own HWID.`,
        ephemeral: true
      });
    }

    // BLACKLIST
    if (command === "blacklist") {
      const target = interaction.options.getString("target").trim();
      const reason = interaction.options.getString("reason");

      db.blacklisted[target] = {
        reason,
        by: interaction.user.id,
        at: new Date().toISOString()
      };

      const key = normalizeKey(target);

      if (db.keys[key]) {
        db.keys[key].active = false;
      }

      for (const record of Object.values(db.keys)) {
        if (record.ownerId === target) {
          record.active = false;
        }
      }

      saveDB();

      return await interaction.reply({
        content: `♡ Blacklisted \`${target}\`.\nReason: ${reason}`,
        ephemeral: true
      });
    }

    // UNBLACKLIST
    if (command === "unblacklist") {
      const target = interaction.options.getString("target").trim();
      const key = normalizeKey(target);

      if (!db.blacklisted[target] && !db.blacklisted[key]) {
        return await interaction.reply({
          content: "No blacklist entry was found for that target.",
          ephemeral: true
        });
      }

      delete db.blacklisted[target];
      delete db.blacklisted[key];

      for (const [storedKey, record] of Object.entries(db.keys)) {
        if (
          (storedKey === key || record.ownerId === target) &&
          !db.blacklisted[storedKey]
        ) {
          record.active = true;
        }
      }

      saveDB();

      return await interaction.reply({
        content: `♡ Removed blacklist entry for \`${target}\`.`,
        ephemeral: true
      });
    }

    // BAN
    if (command === "ban") {
      const user = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") || "No reason provided";

      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!member) {
        return await interaction.reply({
          content: "That member could not be found in this server.",
          ephemeral: true
        });
      }

      if (!member.bannable) {
        return await interaction.reply({
          content:
            "I cannot ban that member. Check my role position and permissions.",
          ephemeral: true
        });
      }

      await member.ban({ reason });

      return await interaction.reply({
        content: `♡ Banned ${user.tag}.\nReason: ${reason}`,
        ephemeral: true
      });
    }

    // POST PANEL
    if (command === "panel") {
      await interaction.channel.send({
        embeds: [createPanelEmbed()],
        components: createPanelRows()
      });

      return await interaction.reply({
        content: "♡ Jayce Main panel posted!",
        ephemeral: true
      });
    }

    // LIST ACCOUNTS
    if (command === "listallaccounts") {
      const accounts = Object.entries(db.accounts);

      if (accounts.length === 0) {
        return await interaction.reply({
          content: "No registered accounts yet.",
          ephemeral: true
        });
      }

      const lines = accounts.map(([userId, account]) => {
        const ownedKeys = Object.entries(db.keys)
          .filter(([, record]) => record.ownerId === userId)
          .map(([key, record]) =>
            `${key}${record.active ? "" : " (inactive)"}`
          );

        return [
          `Username: ${account.username}`,
          `Discord ID: ${userId}`,
          `Keys: ${ownedKeys.length ? ownedKeys.join(", ") : "None"}`
        ].join("\n");
      });

      const chunks = [];
      let current = "";

      for (const line of lines) {
        const addition = `${line}\n\n`;

        if ((current + addition).length > 1600) {
          if (current) chunks.push(current);
          current = "";
        }

        current += addition;
      }

      if (current) chunks.push(current);

      await interaction.reply({
        content: `♡ Registered accounts: ${accounts.length}\n\n${chunks[0]}`,
        ephemeral: true
      });

      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({
          content: chunk,
          ephemeral: true
        });
      }

      return;
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message = "An error occurred while processing that interaction.";

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: message,
        ephemeral: true
      }).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.followUp({
        content: message,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ========================================
// RENDER HEALTH CHECK
// ========================================

const PORT = process.env.PORT;

if (PORT) {
  http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      return res.end(JSON.stringify({
        status: "online",
        bot: client.isReady()
      }));
    }

    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("Jayce Main bot is running.");
  }).listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Health server listening on port ${PORT}`);
  });
}

// ========================================
// REGISTER COMMANDS AND LOGIN
// ========================================

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})().catch(error => {
  console.error("Startup error:", error);
  process.exitCode = 1;
});
