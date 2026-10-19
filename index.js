const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const TICKET_CHANNEL_ID = "1556208545278595142";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const REASON_OPTIONS = [
  {
    label: "main",
    description: "Open a ticket for: main",
    value: "main",
  },
  {
    label: "mobile main",
    description: "Open a ticket for: mobile main",
    value: "mobile main",
  },
  {
    label: "bugs",
    description: "Open a ticket for: bugs",
    value: "bugs",
  },
];

const ticketEmbed = new EmbedBuilder()
  .setColor(0x2b2d31)
  .setTitle("Welcome to # • tickets!")
  .setDescription("This is the start of the # • tickets private channel.");

const reasonMenu = new StringSelectMenuBuilder()
  .setCustomId("ticket_reason")
  .setPlaceholder("Choose a reason...")
  .addOptions(REASON_OPTIONS);

const reasonRow = new ActionRowBuilder().addComponents(reasonMenu);

async function registerSlashCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.log("[CONFIG] Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID");
    return;
  }

  const commands = [
    {
      name: "ticket-panel",
      description: "Send the ticket panel in the ticket channel",
    },
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("[COMMANDS] Slash commands registered");
  } catch (error) {
    console.error("[COMMANDS] Error registering commands:", error);
  }
}

async function sendTicketPanel(channel) {
  if (!channel) return;

  await channel.send({
    embeds: [ticketEmbed],
    components: [reasonRow],
  });

  console.log(`[TICKET] Panel sent in ${channel.name}`);
}

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerSlashCommands();

  const channel = client.channels.cache.get(TICKET_CHANNEL_ID);

  if (!channel) {
    console.log("[TICKET] Ticket channel not found in cache.");
    return;
  }

  try {
    await sendTicketPanel(channel);
  } catch (error) {
    console.error("[TICKET] Failed to send panel:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "ticket-panel") {
      const channel = interaction.channel;

      if (!channel) {
        return interaction.reply({
          content: "This command must be used in a server channel.",
          ephemeral: true,
        });
      }

      await sendTicketPanel(channel);

      return interaction.reply({
        content: "✅ Ticket panel sent.",
        ephemeral: true,
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_reason") {
      const reason = interaction.values[0];
      const user = interaction.user;
      const channel = interaction.channel;

      if (!channel) {
        return interaction.reply({
          content: "This interaction is missing a valid channel.",
          ephemeral: true,
        });
      }

      const ticketMessage = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Ticket: ${reason}`)
        .setDescription(`Opened by: ${user.tag}\nReason: ${reason}\n\nPlease wait for support.`);

      await channel.send({
        embeds: [ticketMessage],
      });

      await interaction.reply({
        content: `✅ Ticket posted in ${channel}.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("[INTERACTION] Error:", error);

    if (interaction && !interaction.replied) {
      await interaction.reply({
        content: "Something went wrong while processing that request.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

if (!TOKEN) {
  console.log("[CONFIG] No DISCORD_TOKEN found. Bot not started.");
} else {
  client.login(TOKEN);
}
