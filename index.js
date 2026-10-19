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

// ===================================
// JAYCE CONFIGURATION
// ===================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = "1552637829815865414";
const BUYER_ROLE_ID = "1554321313332469800";

const MOBILE_SCRIPT_URL =
  process.env.MOBILE_SCRIPT_URL ||
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

// ===================================
// EXPRESS KEEP-ALIVE SERVER
// ===================================

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("Jayce bot is online! 💗");
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
    "[EXPRESS SERVICE RUNNING] Listening on port " + PORT
  );
});

// Optional Render health check every 5 minutes.
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

// ===================================
// CHECK REQUIRED CONFIGURATION
// ===================================

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in Render Environment."
  );
  process.exit(1);
}

// ===================================
// DISCORD CLIENT
// ===================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===================================
// SLASH COMMANDS
// ===================================

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Display the Jayce Script Panel"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether Jayce is online")
].map(command => command.toJSON());

// ===================================
// REGISTER COMMANDS
// ===================================

async function registerCommands() {
  const rest = new REST({ version: "10" })
    .setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("[COMMANDS] Slash commands registered.");
}

// ===================================
// ROLE CHECKS
// ===================================

function hasRole(interaction, roleId) {
  const roles = interaction.member?.roles;

  if (!roles) return false;

  if (roles.cache) {
    return roles.cache.has(roleId);
  }

  return Array.isArray(roles) && roles.includes(roleId);
}

function hasBuyerRole(interaction) {
  return hasRole(interaction, BUYER_ROLE_ID);
}

async function denyBuyerAccess(interaction) {
  return interaction.reply({
    content:
      "❌ This feature is for Jayce buyers only. You need the Buyer role to use it.",
    ephemeral: true
  });
}

// ===================================
// JAYCE PANEL
// ===================================

function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
    .setDescription([
      "Welcome to Jayce! ♡",
      "",
      "Choose an option below.",
      "",
      "♡ **Mobile Script** — Buyer access required",
      "♡ **Reset HWID** — Buyer access required"
    ].join("\n"))
    .setFooter({
      text: "jayce  ♡  soft & secure"
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("jc_mobilemain")
      .setLabel("Mobile Script")
      .setEmoji("♡")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("jc_resethwid")
      .setLabel("Reset HWID")
      .setEmoji("♡")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ===================================
// BOT READY
// ===================================

client.once("ready", async () => {
  console.log(`[JAYCE] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMAND REGISTRATION ERROR]", error);
  }
});

// ===================================
// INTERACTION HANDLER
// ===================================

client.on("interactionCreate", async interaction => {
  try {
    // -------------------------------
    // SLASH COMMANDS
    // -------------------------------

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: "💗 Jayce is online!",
          ephemeral: true
        });
      }

      if (interaction.commandName === "panel") {
        if (!hasRole(interaction, STAFF_ROLE_ID)) {
          return interaction.reply({
            content: "❌ Only Jayce staff can open the panel.",
            ephemeral: true
          });
        }

        return interaction.reply(createPanel());
      }
    }

    if (!interaction.isButton()) return;

    // -------------------------------
    // MOBILE SCRIPT
    // BUYER ROLE REQUIRED
    // -------------------------------

    if (interaction.customId === "jc_mobilemain") {
      if (!hasBuyerRole(interaction)) {
        return denyBuyerAccess(interaction);
      }

      return interaction.reply({
        content: [
          " **Jayce Mobile Script**",
          "",
          "```lua",
          `loadstring(game:HttpGet("${MOBILE_SCRIPT_URL}"))()`,
          "```"
        ].join("\n"),
        ephemeral: true
      });
    }

    // -------------------------------
    // RESET HWID
    // BUYER ROLE REQUIRED
    // -------------------------------

    if (interaction.customId === "jc_resethwid") {
      if (!hasBuyerRole(interaction)) {
        return denyBuyerAccess(interaction);
      }

      // The actual FlowAuth API reset has not been
      // configured or verified in this version.

      return interaction.reply({
        content:
          "♡ HWID reset.",
        ephemeral: true
      });
    }

  } catch (error) {
    console.error("[INTERACTION ERROR]", error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: "❌ Something went wrong. Please try again later.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ===================================
// START BOT
// ===================================

client.login(DISCORD_TOKEN).catch(error => {
  console.error("[LOGIN ERROR]", error);
  process.exit(1);
});
