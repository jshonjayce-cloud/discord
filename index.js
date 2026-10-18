
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
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ==================== CONFIG ====================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID =
  process.env.ADMIN_ROLE_ID || "1552637829815865414";

const GET_SCRIPT_ROLE_ID =
  process.env.ACCESS_ROLE_ID || "1552637429456961657";

const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

// Your supplied loader
const MOBILE_MAIN_LOADSTRING =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/576df60d62347e98101fde14e20dfc98.lua"))()';

// Main script loader
const GET_SCRIPT_TEXT =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/576df60d62347e98101fde14e20dfc98.lua"))()';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID environment variables."
  );
  process.exit(1);
}

// ==================== DATABASE ====================

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDatabase() {
  return {
    keys: [],
    blacklisted: [],
    hwids: {},
    accounts: {},
  };
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return defaultDatabase();
    }

    const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

    return {
      ...defaultDatabase(),
      ...parsed,
    };
  } catch (error) {
    console.error("Database load error:", error);
    return defaultDatabase();
  }
}

let db = loadDatabase();

function saveDatabase() {
  const tempPath = `${DB_PATH}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));
  fs.renameSync(tempPath, DB_PATH);
}

// ==================== DISCORD CLIENT ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ==================== HELPERS ====================

function isStaff(member) {
  return Boolean(member?.roles?.cache?.has(ADMIN_ROLE_ID));
}

function hasRole(member, roleId) {
  return Boolean(member?.roles?.cache?.has(roleId));
}

async function replyPrivate(interaction, content) {
  const payload = { content, ephemeral: true };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function makePanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription(
      [
        "♡ welcome to the jayce main panel!",
        "",
        "♡ **Register** — create your panel account",
        "♡ **Get Script** — receive the main loader",
        "♡ **Mobile Main** — receive the mobile loader",
        "♡ **Reset HWID** — request a hardware-ID reset",
        "",
        "Choose an option below. ♡",
      ].join("\n")
    )
    .setFooter({ text: "jayce  ♡  soft & secure" });
}

function makePanelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_register")
      .setLabel("♡ Register")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("jc_main")
      .setLabel("♡ Get Script")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("jc_mobilemain")
      .setLabel("♡ Mobile Main")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_resethwid")
      .setLabel("♡ Reset HWID")
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

function makeKey() {
  return `JAYCE-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
}

function findAccountByUsername(username) {
  const wanted = username.toLowerCase();

  return Object.entries(db.accounts).find(
    ([, account]) =>
      account.username?.toLowerCase() === wanted
  );
}

// ==================== SLASH COMMANDS ====================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Jayce Main panel"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate an access key")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User the key belongs to")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset-hwid")
    .setDescription("Reset a user's locally stored HWID")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to reset")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to blacklist")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the blacklist")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user's blacklist")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to unblacklist")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to ban")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered Jayce panel accounts"),
].map(command => command.toJSON());

// ==================== REGISTER COMMANDS ====================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Jayce Main slash commands registered.");
}

// ==================== SLASH COMMAND HANDLER ====================

client.on("interactionCreate", async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (!isStaff(interaction.member)) {
        return replyPrivate(
          interaction,
          "♡ You don't have permission to use this command."
        );
      }

      const { commandName } = interaction;

      if (commandName === "panel") {
        return interaction.reply({
          embeds: [makePanelEmbed()],
          components: makePanelRows(),
        });
      }

      if (commandName === "announce") {
        const message = interaction.options.getString("message", true);

        const embed = new EmbedBuilder()
          .setColor(0xFF9ED2)
          .setTitle("♡ jayce announcement")
          .setDescription(message)
          .setFooter({ text: "jayce  ♡  soft & secure" })
          .setTimestamp();

        await interaction.reply({
          content: "♡ Announcement sent.",
          ephemeral: true,
        });

        return interaction.channel.send({ embeds: [embed] });
      }

      if (commandName === "generate-key") {
        const user = interaction.options.getUser("user", true);

        const key = makeKey();

        db.keys.push({
          key,
          userId: user.id,
          createdAt: new Date().toISOString(),
          active: true,
        });

        saveDatabase();

        await interaction.reply({
          content: `♡ Key generated for ${user.tag}.`,
          ephemeral: true,
        });

        try {
          await user.send(
            `♡ Your Jayce Main key:\n\`${key}\`\n\nKeep it private.`
          );
        } catch {
          await interaction.followUp({
            content: "♡ I couldn't DM that user. Their DMs may be closed.",
            ephemeral: true,
          });
        }

        return;
      }

      if (commandName === "reset-hwid") {
        const user = interaction.options.getUser("user", true);

        delete db.hwids[user.id];
        saveDatabase();

        return interaction.reply({
          content:
            `♡ Cleared the locally stored HWID entry for ${user.tag}. ` +
            "This does not reset HWID data on an external loader service.",
          ephemeral: true,
        });
      }

      if (commandName === "blacklist") {
        const user = interaction.options.getUser("user", true);
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        if (!db.blacklisted.some(entry => entry.userId === user.id)) {
          db.blacklisted.push({
            userId: user.id,
            reason,
            createdAt: new Date().toISOString(),
          });
        }

        saveDatabase();

        return interaction.reply({
          content: `♡ ${user.tag} has been blacklisted.\nReason: ${reason}`,
          ephemeral: true,
        });
      }

      if (commandName === "unblacklist") {
        const user = interaction.options.getUser("user", true);

        db.blacklisted = db.blacklisted.filter(
          entry => entry.userId !== user.id
        );

        saveDatabase();

        return interaction.reply({
          content: `♡ ${user.tag} has been removed from the blacklist.`,
          ephemeral: true,
        });
      }

      if (commandName === "ban") {
        const user = interaction.options.getUser("user", true);
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        const member = await interaction.guild.members.fetch(user.id);

        await member.ban({ reason });

        return interaction.reply({
          content: `♡ Banned ${user.tag}.\nReason: ${reason}`,
          ephemeral: true,
        });
      }

      if (commandName === "listallaccounts") {
        const accounts = Object.entries(db.accounts);

        if (accounts.length === 0) {
          return interaction.reply({
            content: "♡ There are no registered accounts yet.",
            ephemeral: true,
          });
        }

        const lines = accounts.map(([userId, account]) =>
          `• ${account.username} — Discord ID: ${userId}`
        );

        const output = lines.join("\n");

        // Discord messages have a maximum length.
        return interaction.reply({
          content: `♡ **Registered accounts**\n${output.slice(0, 1800)}`,
          ephemeral: true,
        });
      }
    }

    // Registration modal
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "jc_register_modal"
    ) {
      const username = interaction.fields
        .getTextInputValue("jc_username")
        .trim();

      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
        return replyPrivate(
          interaction,
          "♡ Username must be 3–24 characters and use only letters, numbers, dots, underscores, or hyphens."
        );
      }

      if (db.blacklisted.some(entry => entry.userId === interaction.user.id)) {
        return replyPrivate(
          interaction,
          "♡ Your account is blacklisted. Please contact staff."
        );
      }

      const existingUser = db.accounts[interaction.user.id];

      if (existingUser) {
        return replyPrivate(
          interaction,
          `♡ You already registered as **${existingUser.username}**.`
        );
      }

      if (findAccountByUsername(username)) {
        return replyPrivate(
          interaction,
          "♡ That username is already registered. Please choose another."
        );
      }

      db.accounts[interaction.user.id] = {
        username,
        createdAt: new Date().toISOString(),
      };

      saveDatabase();

      return replyPrivate(
        interaction,
        `♡ Registration complete!\nUsername: **${username}**`
      );
    }

    // Panel buttons
    if (interaction.isButton()) {
      const userId = interaction.user.id;

      if (db.blacklisted.some(entry => entry.userId === userId)) {
        return replyPrivate(
          interaction,
          "♡ You are blacklisted from using this panel."
        );
      }

      if (interaction.customId === "jc_register") {
        const modal = new ModalBuilder()
          .setCustomId("jc_register_modal")
          .setTitle("♡ Register for Jayce Main");

        const usernameInput = new TextInputBuilder()
          .setCustomId("jc_username")
          .setLabel("Choose a username")
          .setPlaceholder("Your Jayce username")
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(24)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput)
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "jc_main") {
        if (!hasRole(interaction.member, GET_SCRIPT_ROLE_ID)) {
          return replyPrivate(
            interaction,
            "♡ You don't have the role required to receive the main loader."
          );
        }

        try {
          await interaction.user.send(
            [
              "♡ **Jayce Main Loader**",
              "",
              "```lua",
              GET_SCRIPT_TEXT,
              "```",
            ].join("\n")
          );

          return replyPrivate(
            interaction,
            "♡ I sent the main loader to your DMs!"
          );
        } catch {
          return replyPrivate(
            interaction,
            "♡ I couldn't DM you. Enable DMs from server members and try again."
          );
        }
      }

      if (interaction.customId === "jc_mobilemain") {
        if (!hasRole(interaction.member, MOBILE_MAIN_ROLE_ID)) {
          return replyPrivate(
            interaction,
            "♡ You don't have the role required to receive Mobile Main."
          );
        }

        try {
          await interaction.user.send(
            [
              "♡ **Jayce Mobile Main Loader**",
              "",
              "```lua",
              MOBILE_MAIN_LOADSTRING,
              "```",
            ].join("\n")
          );

          return replyPrivate(
            interaction,
            "♡ I sent the Mobile Main loadstring to your DMs!"
          );
        } catch {
          return replyPrivate(
            interaction,
            "♡ I couldn't DM you. Enable DMs from server members and try again."
          );
        }
      }

      if (interaction.customId === "jc_resethwid") {
        delete db.hwids[userId];
        saveDatabase();

        return replyPrivate(
          interaction,
          "♡ Your locally stored HWID entry has been cleared. This does not reset HWID data on the external loader service."
        );
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      try {
        await replyPrivate(
          interaction,
          "♡ Something went wrong. Please try again or contact staff."
        );
      } catch {
        // The interaction may already have expired.
      }
    }
  }
});

// ==================== RENDER HEALTH CHECK ====================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Jayce Main bot is running ♡");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client.user?.tag || "starting",
    uptime: Math.floor(process.uptime()),
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on port ${PORT}`);
});

// ==================== START BOT ====================

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

async function start() {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

start();
    
