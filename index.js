
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

// ================================
// JAYCE BOT CONFIGURATION
// ================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";

// Both scripts use the same access role.
const MAIN_ROLE_ID = "1554321313332469800";
const MOBILE_ROLE_ID = "1554321313332469800";

// Add these in Render Environment Variables.
const MAIN_SCRIPT_URL = process.env.MAIN_SCRIPT_URL;
const MOBILE_SCRIPT_URL = process.env.MOBILE_SCRIPT_URL;

// ================================
// EXPRESS KEEP-ALIVE SERVER
// ================================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
  console.log(
    "[EXPRESS SERVICE RUNNING] Listening on incoming gateway port " + PORT
  );
});

// Optional health checks against your Render URL.
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(async () => {
    try {
      const response = await fetch(
        `${process.env.RENDER_EXTERNAL_URL}/health`
      );

      console.log("[KEEP ALIVE] Health check:", response.status);
    } catch (error) {
      console.error("[KEEP ALIVE ERROR]", error.message);
    }
  }, KEEP_ALIVE_INTERVAL);
}

// ================================
// DISCORD CLIENT
// ================================

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in Render environment variables."
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================================
// SLASH COMMANDS
// ================================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Display the Jayce Script Panel"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether Jayce is online")
].map(command => command.toJSON());

// ================================
// REGISTER COMMANDS
// ================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("[COMMANDS] Slash commands registered.");
}

// ================================
// PERMISSION HELPERS
// ================================

function hasRole(interaction, roleId) {
  const roles = interaction.member?.roles;

  if (!roles) return false;

  // Guild interactions normally provide cached role IDs.
  if (roles.cache) {
    return roles.cache.has(roleId);
  }

  return Array.isArray(roles) && roles.includes(roleId);
}

async function denyAccess(interaction) {
  await interaction.reply({
    content: "❌ You don't have the required role to use this button.",
    ephemeral: true
  });
}

// ================================
// JAYCE SCRIPT PANEL
// ================================

function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription(
      [
        "Welcome to Jayce! ♡",
        "",
        "Choose an option below.",
        "",
        "📱 **Main Script** — Main version",
        "📲 **Mobile Script** — Mobile version",
        "🔄 **Reset HWID** — Reset confirmation"
      ].join("\n")
    )
    .setFooter({
      text: "jayce  ♡  soft & secure"
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_main")
      .setLabel("Main Script")
      .setEmoji("💗")
      .setStyle(ButtonStyle.Primary),

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

  return { embeds: [embed], components: [row] };
}

// ================================
// READY EVENT
// ================================

client.once("ready", async () => {
  console.log(`[JAYCE] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMAND REGISTRATION ERROR]", error);
  }
});

// ================================
// INTERACTION HANDLER
// ================================

client.on("interactionCreate", async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: "💗 Jayce is online!",
          ephemeral: true
        });
      }

      if (interaction.commandName === "panel") {
        if (!hasRole(interaction, STAFF_ROLE_ID)) {
          return denyAccess(interaction);
        }

        return interaction.reply({
          ...createPanel()
        });
      }
    }

    if (!interaction.isButton()) return;

    // Main Script
    if (interaction.customId === "jc_main") {
      if (!hasRole(interaction, MAIN_ROLE_ID)) {
        return denyAccess(interaction);
      }

      if (!MAIN_SCRIPT_URL) {
        return interaction.reply({
          content:
            "⚠️ The Main Script URL has not been configured by the bot administrator.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `💗 **Jayce Main Script**\n${MAIN_SCRIPT_URL}`,
        ephemeral: true
      });
    }

    // Mobile Script
    if (interaction.customId === "jc_mobilemain") {
      if (!hasRole(interaction, MOBILE_ROLE_ID)) {
        return denyAccess(interaction);
      }

      if (!MOBILE_SCRIPT_URL) {
        return interaction.reply({
          content:
            "⚠️ The Mobile Script URL has not been configured by the bot administrator.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `📱 **Jayce Mobile Script**\n${MOBILE_SCRIPT_URL}`,
        ephemeral: true
      });
    }

    // Reset HWID
    if (interaction.customId === "jc_resethwid") {
      if (
        !hasRole(interaction, MAIN_ROLE_ID) &&
        !hasRole(interaction, MOBILE_ROLE_ID) &&
        !hasRole(interaction, STAFF_ROLE_ID)
      ) {
        return denyAccess(interaction);
      }

      return interaction.reply({
        content:
          "Your FlowAuth Hwid has been reset and will bind next time you execute",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("[INTERACTION ERROR]", error);

    if (interaction.isRepliable() && !interaction.replied &&
        !interaction.deferred) {
      await interaction.reply({
        content: "❌ Something went wrong. Please try again later.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ================================
// START BOT
// ================================

client.login(DISCORD_TOKEN).catch(error => {
  console.error("[LOGIN ERROR]", error);
  process.exit(1);
});
    
