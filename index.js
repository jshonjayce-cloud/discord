const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ==========================================
// JAYCE CONFIG
// ==========================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";
const BUYER_ROLE_ID = "1554321313332469800";

const MOBILE_SCRIPT_URL =
  process.env.MOBILE_SCRIPT_URL ||
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

const PAYMENT_METHODS =
  process.env.PAYMENT_METHODS || "Contact Jayce staff for payment methods.";

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

// ==========================================
// DATABASE
// ==========================================

// Use a Render persistent disk mounted at /var/data
// to keep this database across deployments/restarts.
// Otherwise the local database may be lost on redeploy.

const DATA_DIR = process.env.DATA_DIR || (
  fs.existsSync("/var/data") ? "/var/data" : path.join(__dirname, "data")
);

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "jayce-database.json");

function loadDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    return {
      blacklist: data.blacklist || {},
      accounts: data.accounts || {},
      panelChannel: data.panelChannel || null,
      announcementChannel: data.announcementChannel || null
    };
  } catch {
    return {
      blacklist: {},
      accounts: {},
      panelChannel: null,
      announcementChannel: null
    };
  }
}

let db = loadDB();

function saveDB() {
  const tempFile = DB_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// ==========================================
// EXPRESS KEEP-ALIVE
// ==========================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("Jayce bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: "Jayce",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log("[EXPRESS SERVICE RUNNING] Port " + PORT);
});

if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(async () => {
    try {
      const response = await fetch(
        `${process.env.RENDER_EXTERNAL_URL}/health`
      );
      console.log("[KEEP ALIVE]", response.status);
    } catch (error) {
      console.error("[KEEP ALIVE ERROR]", error.message);
    }
  }, 5 * 60 * 1000);
}

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function isStaff(interaction) {
  const roles = interaction.member?.roles;

  if (roles?.cache) {
    return roles.cache.has(STAFF_ROLE_ID);
  }

  return Array.isArray(roles) && roles.includes(STAFF_ROLE_ID);
}

function isBuyer(interaction) {
  const roles = interaction.member?.roles;

  if (roles?.cache) {
    return roles.cache.has(BUYER_ROLE_ID);
  }

  return Array.isArray(roles) && roles.includes(BUYER_ROLE_ID);
}

function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription(
      "Welcome to Jayce! ♡\n\n" +
      "📱 **Mobile Script** — Buyer role required\n" +
      "🔄 **Reset HWID** — Buyer role required"
    )
    .setFooter({ text: "jayce  ♡  soft & secure" })
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_mobilemain")
      .setLabel("Mobile Script")
      .setEmoji("📱")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("jc_resethwid")
      .setLabel("Reset HWID")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [buttons] };
}

// ==========================================
// SLASH COMMAND DEFINITIONS
// ==========================================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Display the Jayce script panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Display the Jayce admin panel"),

  new SlashCommandBuilder()
    .setName("setpanel")
    .setDescription("Choose a channel for the Jayce panel")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel where the panel will be posted")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Configure Jayce bot channels")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Choose an action")
        .setRequired(true)
        .addChoices(
          { name: "Set announcement channel", value: "announcement" },
          { name: "Set panel channel", value: "panel" },
          { name: "Show current channels", value: "show" }
        )
    )
    .addChannelOption(o =>
      o.setName("target")
        .setDescription("Channel to configure")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot status"),

  new SlashCommandBuilder()
    .setName("pm")
    .setDescription("Show payment methods"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show Jayce bot statistics"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a server announcement")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Announcement channel")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a Jayce tracking key")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer receiving the key")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("getkey")
    .setDescription("Retrieve your assigned Jayce tracking key"),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("Show the Mobile Script loader"),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up a Jayce account")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Account owner")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View your Jayce account"),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Record buyer access")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable recorded buyer access")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke a buyer tracking key")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("dmbuyerupdate")
    .setDescription("Send an update to a buyer")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Update to send")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forceresethwid")
    .setDescription("Request a FlowAuth HWID reset")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset-hwid")
    .setDescription("Request a FlowAuth HWID reset")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Buyer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a Discord user")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to blacklist")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for the blacklist")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user from the blacklist")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to unblacklist")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from this server")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member to ban")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List recorded Jayce accounts")
].map(command => command.toJSON());

// ==========================================
// REGISTER COMMANDS
// ==========================================

async function registerCommands() {
  const rest = new REST({ version: "10" })
    .setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log(`[COMMANDS] Registered ${commands.length} commands.`);
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
  try {
    // Buttons
    if (interaction.isButton()) {
      if (
        interaction.customId === "jc_mobilemain" ||
        interaction.customId === "jc_resethwid"
      ) {
        if (!isBuyer(interaction)) {
          return interaction.reply({
            content: "❌ Jayce buyers only. You need the Buyer role.",
            ephemeral: true
          });
        }

        if (interaction.customId === "jc_mobilemain") {
          return interaction.reply({
            content:
              "📱 **Jayce Mobile Script**\n\n" +
              "```lua\n" +
              `loadstring(game:HttpGet("${MOBILE_SCRIPT_URL}"))()` +
              "\n```",
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "⚠️ FlowAuth's reset API is not connected yet. " +
            "No HWID reset has been performed. Please contact staff.",
          ephemeral: true
        });
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // ACKNOWLEDGE EVERY SLASH COMMAND QUICKLY.
    // This prevents most "application did not respond" errors.
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.commandName;
    const user = interaction.options.getUser("user");
    const message = interaction.options.getString("message");
    const reason =
      interaction.options.getString("reason") || "No reason provided.";

    const requireStaff = () => {
      if (!isStaff(interaction)) {
        throw new Error("STAFF_ONLY");
      }
    };

    // Public command
    if (name === "ping") {
      return interaction.editReply("💗 Jayce is online!");
    }

    // Staff panel command
    if (name === "panel") {
      requireStaff();

      const target = db.panelChannel
        ? await client.channels.fetch(db.panelChannel).catch(() => null)
        : interaction.channel;

      if (!target || !target.isTextBased()) {
        return interaction.editReply(
          "Set a valid panel channel first using `/setpanel`."
        );
      }

      await target.send(createPanel());
      return interaction.editReply(`💗 Panel posted in <#${target.id}>.`);
    }

    if (name === "setpanel") {
      requireStaff();

      const target = interaction.options.getChannel("channel");

      if (!target.isTextBased()) {
        return interaction.editReply("❌ Choose a text-based channel.");
      }

      db.panelChannel = target.id;
      saveDB();

      await target.send(createPanel());

      return interaction.editReply(
        `💗 Panel channel saved and panel posted in <#${target.id}>.`
      );
    }

    if (name === "adminpanel") {
      requireStaff();

      const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("💗 Jayce Admin Panel")
        .setDescription([
          "`/setpanel` — Set and post the buyer panel",
          "`/channel` — Configure channels",
          "`/announce` — Send an announcement",
          "`/generate-key` — Generate a tracking key",
          "`/blacklist` — Block a user from bot features",
          "`/unblacklist` — Remove a blacklist entry",
          "`/ban` — Ban a server member",
          "`/grantaccess` — Record buyer access",
          "`/disableaccess` — Disable recorded access",
          "`/revoke` — Revoke a tracking key",
          "`/lookup` — View an account",
          "`/listallaccounts` — List accounts",
          "`/stats` — View statistics"
        ].join("\n"))
        .setFooter({ text: "Jayce staff tools" });

      return interaction.editReply({ embeds: [embed] });
    }

    if (name === "channel") {
      requireStaff();

      const action = interaction.options.getString("action");
      const target = interaction.options.getChannel("target");

      if (action === "show") {
        return interaction.editReply(
          `Panel channel: ${db.panelChannel ? `<#${db.panelChannel}>` : "Not set"}\n` +
          `Announcement channel: ${db.announcementChannel ? `<#${db.announcementChannel}>` : "Not set"}`
        );
      }

      if (!target || !target.isTextBased()) {
        return interaction.editReply(
          "❌ Select a valid text channel using the `target` option."
        );
      }

      if (action === "panel") {
        db.panelChannel = target.id;
      } else {
        db.announcementChannel = target.id;
      }

      saveDB();

      return interaction.editReply(
        `💗 ${action === "panel" ? "Panel" : "Announcement"} channel saved: <#${target.id}>`
      );
    }

    if (name === "pm") {
      return interaction.editReply(PAYMENT_METHODS);
    }

    if (name === "jaycescripts") {
      if (!isBuyer(interaction)) {
        return interaction.editReply("❌ This command is for buyers only.");
      }

      return interaction.editReply(
        `📱 Mobile loader:\n\`\`\`lua\nloadstring(game:HttpGet("${MOBILE_SCRIPT_URL}"))()\n\`\`\``
      );
    }

    if (name === "account") {
      const account = db.accounts[interaction.user.id];

      return interaction.editReply(
        account
          ? `**Your Jayce account**\nAccess: ${account.access ? "Enabled" : "Disabled"}\nKey: ${account.key || "No key assigned"}\nBlacklisted: ${db.blacklist[interaction.user.id] ? "Yes" : "No"}`
          : "No Jayce account is recorded for you yet."
      );
    }

    // Remaining commands are staff-only.
    requireStaff();

    if (name === "stats") {
      return interaction.editReply(
        `**Jayce Statistics**\nAccounts: ${Object.keys(db.accounts).length}\nBlacklisted users: ${Object.keys(db.blacklist).length}\nBuyer role: ${BUYER_ROLE_ID}`
      );
    }

    if (name === "announce") {
      const channel = interaction.options.getChannel("channel");

      if (!channel.isTextBased()) {
        return interaction.editReply("❌ Choose a text channel.");
      }

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF9ED2)
            .setTitle("💗 Jayce Announcement")
            .setDescription(message)
            .setFooter({ text: `Posted by ${interaction.user.username}` })
            .setTimestamp()
        ]
      });

      return interaction.editReply("✅ Announcement sent.");
    }

    if (name === "generate-key") {
      const key = "JAYCE-" +
        crypto.randomBytes(12).toString("hex").toUpperCase();

      db.accounts[user.id] = {
        ...(db.accounts[user.id] || {}),
        key,
        access: true,
        createdAt: new Date().toISOString(),
        createdBy: interaction.user.id
      };

      saveDB();

      await user.send(
        `💗 Your Jayce tracking key is:\n\`${key}\``
      ).catch(() => null);

      return interaction.editReply(
        `✅ Tracking key created for ${user}.\n\`${key}\`\n\n` +
        "Note: this is a key stored by this bot; it is not automatically a FlowAuth key."
      );
    }

    if (name === "getkey") {
      const account = db.accounts[interaction.user.id];

      return interaction.editReply(
        account?.key
          ? `Your Jayce tracking key is:\n\`${account.key}\``
          : "No tracking key is assigned to your account. Contact staff."
      );
    }

    if (name === "lookup") {
      const account = db.accounts[user.id];

      return interaction.editReply(
        `**Account lookup: ${user.tag}**\n` +
        `Discord ID: ${user.id}\n` +
        `Recorded account: ${account ? "Yes" : "No"}\n` +
        `Access: ${account?.access ? "Enabled" : "Disabled"}\n` +
        `Key: ${account?.key || "None"}\n` +
        `Blacklisted: ${db.blacklist[user.id] ? "Yes" : "No"}`
      );
    }

    if (name === "grantaccess") {
      db.accounts[user.id] = {
        ...(db.accounts[user.id] || {}),
        access: true,
        updatedAt: new Date().toISOString()
      };

      saveDB();

      return interaction.editReply(
        `✅ Recorded access as enabled for ${user}. This does not automatically grant a Discord role or change FlowAuth permissions.`
      );
    }

    if (name === "disableaccess") {
      if (db.accounts[user.id]) {
        db.accounts[user.id].access = false;
        db.accounts[user.id].updatedAt = new Date().toISOString();
      }

      saveDB();

      return interaction.editReply(
        `✅ Recorded access disabled for ${user}. This does not remove their Discord role or disable their FlowAuth key.`
      );
    }

    if (name === "revoke") {
      if (db.accounts[user.id]) {
        db.accounts[user.id].access = false;
        db.accounts[user.id].key = null;
        db.accounts[user.id].updatedAt = new Date().toISOString();
      }

      saveDB();

      return interaction.editReply(
        `✅ Bot tracking key revoked for ${user}. This does not revoke a FlowAuth key.`
      );
    }

    if (name === "dmbuyerupdate") {
      await user.send(`💗 **Jayce Buyer Update**\n\n${message}`);

      return interaction.editReply(`✅ Update sent to ${user}.`);
    }

    if (name === "blacklist") {
      db.blacklist[user.id] = {
        reason,
        by: interaction.user.id,
        at: new Date().toISOString()
      };

      saveDB();

      return interaction.editReply(
        `⛔ ${user} has been added to the bot blacklist.\nReason: ${reason}`
      );
    }

    if (name === "unblacklist") {
      delete db.blacklist[user.id];
      saveDB();

      return interaction.editReply(`✅ ${user} removed from the bot blacklist.`);
    }

    if (name === "ban") {
      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (!member) {
        return interaction.editReply(
          "❌ That user is not a member of this server."
        );
      }

      await member.ban({ reason });

      return interaction.editReply(`🔨 ${user.tag} was banned.\nReason: ${reason}`);
    }

    if (name 
