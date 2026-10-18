const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.get("/", (_req, res) => res.send("🎃 Jayce Halloween Bot is online!"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server listening on ${PORT}`));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";
const MAIN_ROLE_ID = "1552637429456961657";
const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const MAIN_SCRIPT_URL = process.env.MAIN_SCRIPT_URL || "";
const MOBILE_SCRIPT_URL = process.env.MOBILE_SCRIPT_URL || "";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID environment variable.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Could not read database:", error.message);
  }

  return {
    accounts: {},
    keys: {},
    blacklist: [],
    stats: {
      registrations: 0,
      scriptRequests: 0,
      mobileRequests: 0
    }
  };
}

const db = loadDB();

db.accounts ||= {};
db.keys ||= {};
db.blacklist ||= [];
db.stats ||= {
  registrations: 0,
  scriptRequests: 0,
  mobileRequests: 0
};

function saveDB() {
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const halloween = 0xff7518;

function isStaff(member) {
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member?.roles?.cache?.has(STAFF_ROLE_ID)
  );
}

function hasRole(member, roleId) {
  return Boolean(member?.roles?.cache?.has(roleId));
}

function halloweenEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(halloween)
    .setTitle(`🎃 ${title} 🎃`)
    .setDescription(description)
    .setFooter({ text: "🦇 Jayce Main • Halloween Edition" })
    .setTimestamp();
}

function panelEmbed() {
  return halloweenEmbed(
    "JAYCE MAIN LOADER",
    [
      "🕸️ **Welcome to the haunted loader!**",
      "",
      "🎃 **Register** — Create your account.",
      "🧡 **Get Script** — Access the main loader.",
      "📱 **Mobile Main** — Access the mobile loader.",
      "📊 **Get Stats** — View your account and usage.",
      "",
      "*Choose a button below to continue.*"
    ].join("\n")
  );
}

function panelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_register")
      .setLabel("Register")
      .setEmoji("🎃")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("jc_key")
      .setLabel("Get Script")
      .setEmoji("🧡")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("jc_mobilemain")
      .setLabel("Mobile Main")
      .setEmoji("📱")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("jc_stats")
      .setLabel("Get Stats")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1];
}

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Jayce Halloween customer panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Post the customer panel (staff only)"),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View your account information"),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a registration key (staff only)")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to generate a key for")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant loader access (staff only)")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to grant access to")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("type")
        .setDescription("Access type")
        .setRequired(true)
        .addChoices(
          { name: "Main", value: "main" },
          { name: "Mobile", value: "mobile" },
          { name: "Both", value: "both" }
        )
    ),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's loader access (staff only)")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered accounts (staff only)")
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );

  console.log("✅ Slash commands registered.");
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`🎃 Logged in as ${readyClient.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      const member = interaction.member;

      if (commandName === "panel" || commandName === "adminpanel") {
        if (commandName === "adminpanel" && !isStaff(member)) {
          return interaction.reply({
            content: "🎃 Staff only.",
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [panelEmbed()],
          components: panelRows()
        });
      }

      if (commandName === "account") {
        const account = db.accounts[interaction.user.id];

        if (!account) {
          return interaction.reply({
            content: "👻 You are not registered yet. Use the Register button on the panel.",
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [
            halloweenEmbed("YOUR ACCOUNT", [
              `👤 **User:** ${interaction.user.tag}`,
              `🗓️ **Registered:** <t:${Math.floor(account.createdAt / 1000)}:D>`,
              `🧡 **Main access:** ${account.main ? "Enabled" : "Disabled"}`,
              `📱 **Mobile access:** ${account.mobile ? "Enabled" : "Disabled"}`,
              `🔐 **Status:** ${account.disabled ? "Disabled" : "Active"}`
            ].join("\n"))
          ],
          ephemeral: true
        });
      }

      if (commandName === "generate-key") {
        if (!isStaff(member)) {
          return interaction.reply({
            content: "🎃 Staff only.",
            ephemeral: true
          });
        }

        const target = interaction.options.getUser("user");
        const key = `JAYCE-${require("crypto").randomBytes(5).toString("hex").toUpperCase()}`;

        db.keys[key] = {
          userId: target.id,
          createdAt: Date.now(),
          used: false
        };

        saveDB();

        try {
          await target.send({
            embeds: [
              halloweenEmbed(
                "YOUR REGISTRATION KEY",
                `Your key is:\n\`${key}\`\n\nUse the Register button on the Jayce Main panel.`
              )
            ]
          });
        } catch {
          return interaction.reply({
            content: `⚠️ I couldn't DM ${target.tag}. Their key is: \`${key}\``,
            ephemeral: true
          });
        }

        return interaction.reply({
          content: `🎃 Registration key sent to ${target.tag}.`,
          ephemeral: true
        });
      }

      if (commandName === "grantaccess") {
        if (!isStaff(member)) {
          return interaction.reply({
            content: "🎃 Staff only.",
            ephemeral: true
          });
        }

        const target = interaction.options.getUser("user");
        const type = interaction.options.getString("type");

        db.accounts[target.id] ||= {
          createdAt: Date.now(),
          main: false,
          mobile: false,
          disabled: false
        };

        const account = db.accounts[target.id];
        account.disabled = false;

        if (type === "main" || type === "both") account.main = true;
        if (type === "mobile" || type === "both") account.mobile = true;

        saveDB();

        return interaction.reply({
          content: `🎃 Granted **${type}** access to ${target.tag}.`,
          ephemeral: true
        });
      }

      if (commandName === "disableaccess") {
        if (!isStaff(member)) {
          return interaction.reply({
            content: "🎃 Staff only.",
            ephemeral: true
          });
        }

        const target = interaction.options.getUser("user");
        if (db.accounts[target.id]) {
          db.accounts[target.id].disabled = true;
          saveDB();
        }

        return interaction.reply({
          content: `🦇 Access disabled for ${target.tag}.`,
          ephemeral: true
        });
      }

      if (commandName === "listallaccounts") {
        if (!isStaff(member)) {
          return interaction.reply({
            content: "🎃 Staff only.",
            ephemeral: true
          });
        }

        const entries = Object.entries(db.accounts);
        const description = entries.length
          ? entries.slice(0, 25).map(([id, account]) =>
              `• <@${id}> — ${account.disabled ? "Disabled" : "Active"} | Main: ${Boolean(account.main)} | Mobile: ${Boolean(account.mobile)}`
            ).join("\n")
          : "No accounts have been registered.";

        return interaction.reply({
          embeds: [halloweenEmbed("REGISTERED ACCOUNTS", description)],
          ephemeral: true
        });
      }
    }

    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const account = db.accounts[userId];

    if (interaction.customId === "jc_register") {
      const alreadyRegistered = Boolean(account);

      if (alreadyRegistered) {
        return interaction.reply({
          content: "🎃 You're already registered! Use Get Stats to view your account.",
          ephemeral: true
        });
      }

      const suppliedKey = Object.entries(db.keys).find(
        ([, keyData]) => keyData.userId === userId && !keyData.used
      );

      if (!suppliedKey) {
        return interaction.reply({
          content: "👻 You need a registration key first. Ask staff to use `/generate-key` for you.",
          ephemeral: true
        });
      }

      suppliedKey[1].used = true;
      db.accounts[userId] = {
        createdAt: Date.now(),
        main: hasRole(interaction.member, MAIN_ROLE_ID),
        mobile: hasRole(interaction.member, MOBILE_MAIN_ROLE_ID),
        disabled: false
      };

      db.stats.registrations += 1;
      saveDB();

      return interaction.reply({
        content: "🎃 Registration complete! Press **Get Stats** to view your account.",
        ephemeral: true
      });
    }

    if (interaction.customId === "jc_stats") {
      const currentAccount = db.accounts[userId];

      return interaction.reply({
        embeds: [
          halloweenEmbed("YOUR STATS", [
            `👤 **Discord:** ${interaction.user.tag}`,
            `🪪 **Registered:** ${currentAccount ? "Yes" : "No"}`,
            `🧡 **Main access:** ${currentAccount?.main ? "Enabled" : "Disabled"}`,
            `📱 **Mobile access:** ${currentAccount?.mobile ? "Enabled" : "Disabled"}`,
            `🔐 **Account status:** ${!currentAccount ? "Not registered" : currentAccount.disabled ? "Disabled" : "Active"}`,
            "",
            `🎃 **Total registrations:** ${db.stats.registrations}`,
            `🧡 **Main requests:** ${db.stats.scriptRequests}`,
            `📱 **Mobile requests:** ${db.stats.mobileRequests}`
          ].join("\n"))
        ],
        ephemeral: true
      });
    }

    if (interaction.customId === "jc_key") {
      if (!account || account.disabled) {
        return interaction.reply({
          content: "👻 You need an active registered account to use this button. Ask staff for help.",
          ephemeral: true
        });
      }

      if (!account.main && !hasRole(interaction.member, MAIN_ROLE_ID)) {
        return interaction.reply({
          content: "🧡 You don't have Main access.",
          ephemeral: true
        });
      }

      if (!MAIN_SCRIPT_URL) {
        return interaction.reply({
          content: "⚠️ Main script URL isn't configured. Add MAIN_SCRIPT_URL in Render environment variables.",
          ephemeral: true
        });
      }

      db.stats.scriptRequests += 1;
      saveDB();

      return interaction.reply({
        content: `🎃 **Your Main loader:**\n${MAIN_SCRIPT_URL}`,
        ephemeral: true
      });
    }

    if (interaction.customId === "jc_mobilemain") {
      if (!account || account.disabled) {
        return interaction.reply({
          content: "👻 You need an active registered account to use this button. Ask staff for help.",
          ephemeral: true
        });
      }

      if (!account.mobile && !hasRole(interaction.member, MOBILE_MAIN_ROLE_ID)) {
        return interaction.reply({
          content: "📱 You don't have Mobile Main access.",
          ephemeral: true
        });
      }

      if (!MOBILE_SCRIPT_URL) {
        return interaction.reply({
          content: "⚠️ Mobile script URL isn't configured. Add MOBILE_SCRIPT_URL in Render environment variables.",
          ephemeral: true
        });
      }

      db.stats.mobileRequests += 1;
      saveDB();

      return interaction.reply({
        content: `📱 **Your Mobile loader:**\n${MOBILE_SCRIPT_URL}`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message = {
      content: "🎃 Something went wrong. Please try again or contact staff.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
