
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

// ==================================================
// JAYCE MAIN CONFIGURATION
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";
const MAIN_ROLE_ID = "1554321313332469800";
const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const PANEL_COLOR = 0xff9ed2;

const UPDATED_LOADER =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua"))()';

const GET_SCRIPT_TEXT = UPDATED_LOADER;
const MOBILE_MAIN_LOADSTRING = UPDATED_LOADER;

// ==================================================
// EXPRESS SERVER — FOR RENDER
// ==================================================

const app = express();
app.get("/", (_req, res) => {
  res.status(200).send("Jayce Main bot is running 💗");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "online",
    bot: "Jayce Main",
    discord: client.isReady(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server listening on port ${PORT}`);
});

// ==================================================
// DATABASE
// ==================================================

const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "database.json");

let db = {
  keys: {},
  blacklisted: {},
  hwids: {},
  accounts: {},
  access: {},
};

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

loadDatabase();

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
// HELPERS
// ==================================================

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
    .setFooter({ text: "jayce  ♡  soft & secure" })
    .setTimestamp();
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
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function setScriptRoles(member, enabled) {
  const roleIds = [...new Set([
    MAIN_ROLE_ID,
    MOBILE_MAIN_ROLE_ID,
  ])];

  for (const roleId of roleIds) {
    const role = member.guild.roles.cache.get(roleId);

    if (!role) {
      console.warn(`[ROLES] Role ${roleId} was not found.`);
      continue;
    }

    try {
      if (enabled) {
        await member.roles.add(roleId);
      } else {
        await member.roles.remove(roleId);
      }
    } catch (error) {
      console.error(`[ROLES] Could not update ${roleId}:`, error.message);
      throw error;
    }
  }
}

async function sendScriptDM(user, scriptType) {
  const script =
    scriptType === "mobile"
      ? MOBILE_MAIN_LOADSTRING
      : GET_SCRIPT_TEXT;

  const embed = makeEmbed(
    scriptType === "mobile"
      ? "📱 Jayce Mobile Main"
      : "💗 Jayce Main Script",
    "Here is your updated script. Keep it private."
  );

  await user.send({
    embeds: [embed],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send the Jayce Main script panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("View the Jayce Main administration panel"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to announce in")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a Jayce access code")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User receiving the code")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("Send a buyer their Jayce script")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Buyer receiving the script")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("script")
        .setDescription("Which script to send")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View a user's Jayce account")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Account to inspect")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's Jayce script access")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User whose access will be disabled")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant a user Jayce script access")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User receiving access")
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
    .setDescription("List registered Jayce accounts"),
].map(command => command.toJSON());

// ==================================================
// REGISTER COMMANDS
// ==================================================

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
      "[CONFIG] Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID."
    );
    return;
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("[COMMANDS] Slash commands registered.");
}

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMANDS] Registration error:", error);
  }
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async interaction => {
  try {
    // ------------------------------
    // BUTTONS
    // ------------------------------

    if (interaction.isButton()) {
      const userId = interaction.user.id;

      // Registration remains available even if access was disabled.
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

      if (isBlacklisted(userId)) {
        return interaction.reply({
          content: "⛔ Your account is blacklisted.",
          ephemeral: true,
        });
      }

      if (!accessEnabled(userId)) {
        return interaction.reply({
          content: "🔒 Your Jayce script access is disabled. Contact staff.",
          ephemeral: true,
        });
      }

      if (interaction.customId === "jc_key") {
        const member = await getGuildMember(
          interaction.guild,
          userId
        );

        if (!member?.roles.cache.has(MAIN_ROLE_ID)) {
          return interaction.reply({
            content: "You do not have the Jayce Main access role.",
            ephemeral: true,
          });
        }

        try {
          await sendScriptDM(interaction.user, "main");

          return interaction.reply({
            content: "💗 I sent the Main script to your DMs.",
            ephemeral: true,
          });
        } catch {
          return interaction.reply({
            content: "I couldn't DM you. Enable server DMs and try again.",
            ephemeral: true,
          });
        }
      }

      if (interaction.customId === "jc_mobilemain") {
        const member = await getGuildMember(
          interaction.guild,
          userId
        );

        if (!member?.roles.cache.has(MOBILE_MAIN_ROLE_ID)) {
          return interaction.reply({
            content: "You do not have the Mobile Main access role.",
            ephemeral: true,
          });
        }

        try {
          await sendScriptDM(interaction.user, "mobile");

          return interaction.reply({
            content: "📱 I sent the Mobile Main script to your DMs.",
            ephemeral: true,
          });
        } catch {
          return interaction.reply({
            content: "I couldn't DM you. Enable server DMs and try again.",
            ephemeral: true,
          });
        }
      }

      return;
    }

    // ------------------------------
    // REGISTRATION MODAL
    // ------------------------------

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "jc_register_modal"
    ) {
      const username = interaction.fields
        .getTextInputValue("roblox_username")
        .trim();

      if (!username) {
        return interaction.reply({
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

      return interaction.reply({
        embeds: [
          makeEmbed(
            "♡ Registration Complete",
            `Your account has been registered.\n\n**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}`
          ),
        ],
        ephemeral: true,
      });
    }

    // ------------------------------
    // SLASH COMMANDS
    // ------------------------------

    if (!interaction.isChatInputCommand()) return;

    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const { commandName } = interaction;

    // ------------------------------
    // /panel
    // ------------------------------

    if (commandName === "panel") {
      const embed = makeEmbed(
        "˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚",
        [
          "Welcome to **Jayce Main** ♡",
          "",
          "♡ Register your account",
          "♡ Get your Main script",
          "♡ Get the Mobile Main script",
          "",
          "Choose an option below to continue.",
        ].join("\n")
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("jc_register")
          .setLabel("♡ Register")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("jc_key")
          .setLabel("♡ Get Script")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("jc_mobilemain")
          .setLabel("♡ Mobile Main")
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
      });
    }

    // ------------------------------
    // /adminpanel
    // ------------------------------

    if (commandName === "adminpanel") {
      const embed = makeEmbed(
        "♡ Jayce Main Admin Panel",
        [
          "**Account Management**",
          "`/account` — inspect a user's account",
          "`/grantaccess` — grant script access",
          "`/disableaccess` — disable script access",
          "`/generate-key` — generate an access code",
          "",
          "**Script Delivery**",
          "`/jaycescripts` — send Main or Mobile Main",
          "`/panel` — post the customer panel",
          "",
          "**Moderation**",
          "`/blacklist` — blacklist a user",
          "`/unblacklist` — remove a blacklist",
          "`/ban` — ban a server member",
          "",
          "**Other**",
          "`/announce` — post an announcement",
          "`/listallaccounts` — list registered accounts",
        ].join("\n")
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    // ------------------------------
    // /announce
    // ------------------------------

    if (commandName === "announce") {
      const message = interaction.options.getString("message", true);
      const channel =
        interaction.options.getChannel("channel") ||
        interaction.channel;

      if (!channel?.isTextBased() || !channel.send) {
        return interaction.reply({
          content: "That is not a text channel I can send messages to.",
          ephemeral: true,
        });
      }

      await channel.send({
        embeds: [
          makeEmbed("♡ Jayce Main Announcement", message),
        ],
      });

      return interaction.reply({
        content: `Announcement sent to ${channel}.`,
        ephemeral: true,
      });
    }

    // ------------------------------
    // /generate-key
    // ------------------------------

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
              `Your access code is:\n\n\`${code}\`\n\nKeep this code private.`
            ),
          ],
        });

        return interaction.reply({
          content: `Access code generated and sent to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return interaction.reply({
          content: `Code generated for ${user}, but I couldn't DM them.\nCode: \`${code}\``,
          ephemeral: true,
        });
      }
    }

    // ------------------------------
    // /jaycescripts
    // ------------------------------

    if (commandName === "jaycescripts") {
      const user = interaction.options.getUser("user", true);
      const scriptType = interaction.options.getString("script", true);

      if (isBlacklisted(user.id)) {
        return interaction.reply({
          content: "⛔ That user is blacklisted.",
          ephemeral: true,
        });
      }

      if (!accessEnabled(user.id)) {
        return interaction.reply({
          content: "🔒 That user's Jayce access is disabled.",
          ephemeral: true,
        });
      }

      const member = await getGuildMember(interaction.guild, user.id);

      if (!member) {
        return interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
      }

      const requiredRole =
        scriptType === "mobile"
          ? MOBILE_MAIN_ROLE_ID
          : MAIN_ROLE_ID;

      if (!member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: `That user does not have the required ${scriptType === "mobile" ? "Mobile Main" : "Main"} role. Use \`/grantaccess\` first if they should receive access.`,
          ephemeral: true,
        });
      }

      try {
        await sendScriptDM(user, scriptType);

        return interaction.reply({
          content: `♡ Sent the ${scriptType === "mobile" ? "Mobile Main" : "Main"} script to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return interaction.reply({
          content: `I couldn't DM ${user}. They may need to enable server DMs.`,
          ephemeral: true,
        });
      }
    }

    // ------------------------------
    // /account
    // ------------------------------

    if (commandName === "account") {
      const user = interaction.options.getUser("user", true);
      const account = db.accounts[user.id];
      const member = await getGuildMember(interaction.guild, user.id);

      const codes = Object.entries(db.keys)
        .filter(([, data]) => data.userId === user.id)
        .map(([code, data]) =>
          `\`${code}\` — ${data.redeemed ? "Redeemed" : "Not redeemed"}`
        );

      const roleMain = Boolean(member?.roles.ca
