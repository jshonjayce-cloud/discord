
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

const ADMIN_ROLE_ID = "1552637829815865414";
const GET_SCRIPT_ROLE_ID = "1554321313332469800";

const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const MOBILE_MAIN_LOADSTRING =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/576df60d62347e98101fde14e20dfc98.lua"))()';

const GET_SCRIPT_TEXT = MOBILE_MAIN_LOADSTRING;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID environment variables."
  );
  process.exit(1);
}

// ==================== DATABASE ====================

const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");

const DB_PATH = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDatabase() {
  return {
    keys: [],
    blacklisted: [],
    hwids: {},
    accounts: {},
    access: {},
  };
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return defaultDatabase();
    }

    return {
      ...defaultDatabase(),
      ...JSON.parse(fs.readFileSync(DB_PATH, "utf8")),
    };
  } catch (error) {
    console.error("Database load error:", error.message);
    return defaultDatabase();
  }
}

let db = loadDatabase();

if (!db.access || typeof db.access !== "object") {
  db.access = {};
}

function saveDatabase() {
  const tempPath = `${DB_PATH}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(db, null, 2),
    { mode: 0o600 }
  );

  fs.renameSync(tempPath, DB_PATH);
}

// ==================== CLIENT ====================

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

function accessEnabled(userId) {
  return db.access[userId] !== false;
}

async function replyPrivate(interaction, content) {
  const payload = {
    content,
    ephemeral: true,
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function makeKey() {
  return `JAYCE-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
}

// ==================== PANEL ====================

function makePanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription([
      "♡ welcome to the jayce main panel!",
      "",
      "♡ **Register** — register your panel account",
      "♡ **Get Script** — receive the main loader",
      "♡ **Mobile Main** — receive the mobile loader",
      "",
      "Choose an option below. ♡",
    ].join("\n"))
    .setFooter({ text: "jayce  ♡  soft & secure" });
}

function makePanelRows() {
  return [
    new ActionRowBuilder().addComponents(
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
    ),
  ];
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
    .setDescription("Generate a Jayce access code")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User the code belongs to")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("Send a buyer their script")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Buyer receiving the script")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("script")
        .setDescription("Script to deliver")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile Main", value: "mobile" }
        )
    ),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Open the Jayce staff administration panel"),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Check a user's account and access")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Account to inspect")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's script access")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant a user script access")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to grant access")
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
        .setDescription("Reason for the ban")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered panel accounts"),
].map(command => command.toJSON());

// ==================== REGISTER COMMANDS ====================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Jayce Main commands registered.");
}

// ==================== ROLE MANAGEMENT ====================

async function fetchGuildMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

async function setScriptRoles(member, shouldHaveRoles) {
  const roleIds = [
    ...new Set([
      GET_SCRIPT_ROLE_ID,
      MOBILE_MAIN_ROLE_ID,
    ]),
  ];

  for (const roleId of roleIds) {
    const hasTheRole = member.roles.cache.has(roleId);

    if (shouldHaveRoles && !hasTheRole) {
      await member.roles.add(
        roleId,
        "Jayce access granted by staff"
      );
    }

    if (!shouldHaveRoles && hasTheRole) {
      await member.roles.remove(
        roleId,
        "Jayce access disabled by staff"
      );
    }
  }
}

// ==================== INTERACTIONS ====================

client.on("interactionCreate", async interaction => {
  try {
    // ---------- SLASH COMMANDS ----------

    if (interaction.isChatInputCommand()) {
      if (!isStaff(interaction.member)) {
        return replyPrivate(
          interaction,
          "♡ You don't have permission to use this command."
        );
      }

      const name = interaction.commandName;

      // POST PANEL
      if (name === "panel") {
        return interaction.reply({
          embeds: [makePanelEmbed()],
          components: makePanelRows(),
        });
      }

      // ANNOUNCEMENTS
      if (name === "announce") {
        const message =
          interaction.options.getString("message", true);

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

        return interaction.channel.send({
          embeds: [embed],
        });
      }

      // GENERATE INTERNAL JAYCE CODE
      if (name === "generate-key") {
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
          content: `♡ Jayce code generated for ${user.tag}.`,
          ephemeral: true,
        });

        try {
          await user.send(
            `♡ Your Jayce access code:\n\`${key}\``
          );
        } catch {
          await interaction.followUp({
            content: "♡ I couldn't DM that user.",
            ephemeral: true,
          });
        }

        return;
      }

      // SEND A BUYER THEIR SELECTED SCRIPT
      if (name === "jaycescripts") {
        const user = interaction.options.getUser("user", true);
        const script = interaction.options.getString("script", true);

        if (!accessEnabled(user.id)) {
          return replyPrivate(
            interaction,
            "♡ This user's access is disabled. Use /grantaccess first."
          );
        }

        if (db.blacklisted.some(item => item.userId === user.id)) {
          return replyPrivate(
            interaction,
            "♡ This user is blacklisted and cannot receive a script."
          );
        }

        const member = await fetchGuildMember(
          interaction.guild,
          user.id
        );

        if (!member) {
          return replyPrivate(
            interaction,
            "♡ That user must be in this server."
          );
        }

        const roleId =
          script === "mobile"
            ? MOBILE_MAIN_ROLE_ID
            : GET_SCRIPT_ROLE_ID;

        if (!hasRole(member, roleId)) {
          return replyPrivate(
            interaction,
            "♡ The buyer doesn't have the required role for that script."
          );
        }

        const scriptText =
          script === "mobile"
            ? MOBILE_MAIN_LOADSTRING
            : GET_SCRIPT_TEXT;

        try {
          await user.send([
            script === "mobile"
              ? "♡ **Jayce Mobile Main**"
              : "♡ **Jayce Main**",
            "",
            "Here is your requested loader:",
            "",
            "```lua",
            scriptText,
            "```",
            "",
            "♡ jayce  ♡  soft & secure",
          ].join("\n"));

          return replyPrivate(
            interaction,
            `♡ Successfully sent ${script === "mobile" ? "Mobile Main" : "Main"} to ${user.tag}.`
          );
        } catch {
          return replyPrivate(
            interaction,
            "♡ Couldn't DM the buyer. Ask them to enable DMs from server members."
          );
        }
      }

      // ADMIN PANEL
      if (name === "adminpanel") {
        const embed = new EmbedBuilder()
          .setColor(0xFF9ED2)
          .setTitle("˚₊· ͟͟͞͞➳❥ jayce admin panel")
          .setDescription([
            "♡ **Account Management**",
            "",
            "• `/account` — inspect a user",
            "• `/grantaccess` — grant script roles",
            "• `/disableaccess` — revoke script access",
            "• `/jaycescripts` — deliver a script",
            "• `/generate-key` — generate a Jayce code",
            "• `/blacklist` — block a user",
            "• `/unblacklist` — remove a blacklist",
            "• `/listallaccounts` — list registrations",
            "",
            "♡ All staff commands are restricted to the configured staff role.",
          ].join("\n"))
          .setFooter({ text: "jayce  ♡  staff tools" });

        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }

      // ACCOUNT LOOKUP
      if (name === "account") {
        const user = interaction.options.getUser("user", true);
        const account = db.accounts[user.id];
        const member = await fetchGuildMember(
          interaction.guild,
          user.id
        );

        const activeKeys = db.keys.filter(
          item => item.userId === user.id && item.active
        ).length;

        const embed = new EmbedBuilder()
          .setColor(0xFF9ED2)
          .setTitle("♡ Jayce Account")
          .setThumbnail(user.displayAvatarURL())
          .setDescription([
            `**User:** ${user.tag}`,
            `**Discord ID:** ${user.id}`,
            `**Registered:** ${account ? "Yes" : "No"}`,
            `**Username:** ${account?.username || "Not registered"}`,
            `**Active Jayce codes:** ${activeKeys}`,
            `**Bot access:** ${accessEnabled(user.id) ? "Enabled" : "Disabled"}`,
            `**Blacklisted:** ${db.blacklisted.some(item => item.userId === user.id) ? "Yes" : "No"}`,
            `**Main role:** ${member && hasRole(member, GET_SCRIPT_ROLE_ID) ? "Yes" : "No"}`,
            `**Mobile role:** ${member && hasRole(member, MOBILE_MAIN_ROLE_ID) ? "Yes" : "No"}`,
          ].join("\n"))
          .setFooter({ text: "jayce  ♡  account lookup" });

        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }

      // DISABLE ACCESS
      if (name === "disableaccess") {
        const user = interaction.options.getUser("user", true);

        if (user.id === interaction.user.id) {
          return replyPrivate(
            interaction,
            "♡ You cannot disable your own access with this command."
          );
        }

        const member = await fetchGuildMember(
          interaction.guild,
          user.id
        );

        if (!member) {
          return replyPrivate(
            interaction,
            "♡ That user isn't a member of this server."
          );
        }

        // Save the access restriction first.
        db.access[user.id] = false;
        saveDatabase();

        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error("Role removal error:", error.message);

          return replyPrivate(
            interaction,
            "♡ Bot access has been disabled, but Discord couldn't remove one or more roles. Check Manage Roles permission and role hierarchy."
          );
        }

        return replyPrivate(
          interaction,
          `♡ Disabled script access for ${user.tag} and removed the configured script roles.`
        );
      }

      // GRANT ACCESS
      if (name === "grantaccess") {
        const user = interaction.options.getUser("user", true);

        if (db.blacklisted.some(item => item.userId === user.id)) {
          return replyPrivate(
            interaction,
            "♡ This user is blacklisted. Remove the blacklist first."
          );
        }

        const member = await fetchGuildMember(
          interaction.guild,
          user.id
        );

        if (!member) {
          return replyPrivate(
            interaction,
            "♡ That user isn't a member of this server."
          );
        }

        try {
          await setScriptRoles(member, true);

          db.access[user.id] = true;
          saveDatabase();

          return replyPrivate(
            interaction,
            `♡ Granted script access to ${user.tag} and assigned the configured script roles.`
          );
        } catch (error) {
          console.error("Role grant error:", error.message);

          return replyPrivate(
            interaction,
            "♡ Couldn't assign the roles. Check Manage Roles permission and make sure the bot's highest role is above the script roles."
          );
        }
      }

      // BLACKLIST
      if (name === "blacklist") {
        const user = interaction.options.getUser("user", true);
        const reason =
          interaction.options.getString("reason") ||
          "No reason provided";

        if (!db.blacklisted.some(item => item.userId === user.id)) {
          db.blacklisted.push({
            userId: user.id,
            reason,
            createdAt: new Date().toISOString(),
          });
        }

        saveDatabase();

        return replyPrivate(
          interaction,
          `♡ ${user.tag} has been blacklisted.\nReason: ${reason}`
        );
      }

      // UNBLACKLIST
      if (name === "unblacklist") {
        const user = interaction.options.getUser("user", true);

        db.blacklisted = db.blacklisted.filter(
          item => item.userId !== user.id
        );

        saveDatabase();

        return replyPrivate(
          interaction,
          `♡ ${user.tag} has been removed from the blacklist.`
        );
      }

      // BAN
      if (name === "ban") {
        const user = interaction.options.getUser("user", true);
        const reason =
          interaction.options.getString("reason") ||
          "No reason provided";

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member) {
          return replyPrivate(
            interaction,
            "♡ That user isn't a member of this server."
          );
        }

        await member.ban({ reason });

        return replyPrivate(
          interaction,
          `♡ Banned ${user.tag}.\nReason: ${reason}`
        );
      }

      // REGISTERED ACCOUNTS
      if (name === "listallaccounts") {
        const accounts = Object.entries(db.accounts);

        if (!accounts.length) {
          return replyPrivate(
            interaction,
            "♡ No registered accounts yet."
          );
        }

        const lines = accounts.map(([id, account]) =>
          `• ${account.username} — Discord ID: ${id}`
        );

        return replyPrivate(
          interaction,
          `♡ **Registered accounts**\n${lines.join("\n").slice(0, 1800)}`
        );
      }
    }

    // ---------- REGISTRATION MODAL ----------

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
          "♡ Username must be 3–24 characters using letters, numbers, dots, underscores, or hyphens."
        );
      }

      if (db.blacklisted.some(
        item => item.userId === interaction.user.id
      )) {
        return replyPrivate(
          interaction,
          "♡ Your account is blacklisted."
        );
      }

      if (db.accounts[interaction.user.id]) {
        return replyPrivate(
          interaction,
          `♡ You already registered as **${db.accounts[interaction.user.id].username}**.`
        );
      }

      const usernameExists = Object.values(db.accounts).some(
        account =>
          account.username.toLowerCase() === username.toLowerCase()
      );

      if (usernameExists) {
        return replyPrivate(
          interaction,
          "♡ That username is already registered."
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

    // ---------- PANEL BUTTONS ----------

    if (interaction.isButton()) {
      const userId = interaction.user.id;

      if (db.blacklisted.some(item => item.userId === userId)) {
        return replyPrivate(
          interaction,
          "♡ You are blacklisted from using this panel."
        );
      }

      if (!accessEnabled(userId)) {
        return replyPrivate(
          interaction,
          "♡ Your script access is disabled. Please contact staff."
        );
      }

      // REGISTER
      if (interaction.customId === "jc_register") {
        const modal = new ModalBuilder()
          .setCustomId("jc_register_modal")
          .setTitle("♡ Register for Jayce Main");

        const username = new TextInputBuilder()
          .setCustomId("jc_username")
          .setLabel("Choose a username")
          .setPlaceholder("Your Jayce username")
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(24)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(username)
        );

        return interaction.showModal(modal);
      }

      // GET SCRIPT
      if (interaction.customId === "jc_main") {
        if (!hasRole(interaction.member, GET_SCRIPT_ROLE_ID)) {
          return replyPrivate(
            interaction,
            "♡ You need the required Get Script role to use this button."
          );
        }

        try {
          await interaction.user.send([
            "♡ **Jayce Main Loader**",
            "",
            "```lua",
            GET_SCRIPT_TEXT,
            "```",
          ].join("\n"));

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

      // MOBILE MAIN
      if (interaction.customId === "jc_mobilemain") {
        if (!hasRole(interaction.member, MOBILE_MAIN_ROLE_ID)) {
          return replyPrivate(
            interaction,
            "♡ You don't have the role required to receive Mobile Main."
          );
        }

        try {
          await interaction.user.send([
            "♡ **Jayce Mobile Main Loader**",
            "",
            "```lua",
            MOBILE_MAIN_LOADSTRING,
            "```",
          ].join("\n"));

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
    }
  } catch (error) {
    console.error("Interaction error:", error.message);

    if (interaction.isRepliable()) {
      try {
        await replyPrivate(
          interaction,
          "♡ Something went wrong. Please contact staff."
        );
      } catch {
        // The interaction may have expired.
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

// ==================== START ====================

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

async function start() {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error("Startup error:", error.message);
    process.exit(1);
  }
}

start();
