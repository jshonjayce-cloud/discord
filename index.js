
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLE_ID = "1552637829815865414";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Set DISCORD_TOKEN, CLIENT_ID and GUILD_ID in your environment."
  );
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { keys: {}, blacklisted: {}, hwids: {} };
  }
}

const db = loadDB();
db.keys ||= {};
db.blacklisted ||= {};
db.hwids ||= {};

function saveDB() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function makeKey() {
  return "JAYCE-" +
    crypto.randomBytes(4).toString("hex").toUpperCase() + "-" +
    crypto.randomBytes(4).toString("hex").toUpperCase();
}

function hasAccess(interaction) {
  return interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID) ?? false;
}

const commands = [
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel to announce in")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement message")
        .setRequired(true)
        .setMaxLength(2000)),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate a license key")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Optional key owner")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("reset-hwid")
    .setDescription("Reset a license key's HWID")
    .addStringOption(o =>
      o.setName("key")
        .setDescription("License key")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user or license key")
    .addStringOption(o =>
      o.setName("target")
        .setDescription("Discord user ID or license key")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)
        .setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member to ban")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for ban")
        .setRequired(false)
        .setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a blacklist entry")
    .addStringOption(o =>
      o.setName("target")
        .setDescription("Discord user ID or license key")
        .setRequired(true))
].map(c => c.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Guild slash commands registered.");
}

client.once("ready", () => {
  console.log(`Jayce bot online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "Use this command inside the server.",
      ephemeral: true
    });
  }

  if (!hasAccess(interaction)) {
    return interaction.reply({
      content: "❌ You do not have the required staff role.",
      ephemeral: true
    });
  }

  try {
    const command = interaction.commandName;

    if (command === "announce") {
      const channel = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message");

      if (!channel?.isTextBased() || !channel.send) {
        return interaction.reply({
          content: "Select a text channel.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("📢 Announcement")
        .setDescription(message)
        .setFooter({
          text: `Jayce • Posted by ${interaction.user.username}`
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      return interaction.reply({
        content: `✅ Announcement sent to ${channel}.`,
        ephemeral: true
      });
    }

    if (command === "generate-key") {
      const owner = interaction.options.getUser("user");
      let key = makeKey();

      while (db.keys[key]) key = makeKey();

      db.keys[key] = {
        ownerId: owner?.id || null,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        active: true,
        hwid: null
      };

      saveDB();

      return interaction.reply({
        content:
          `✅ **Key generated**\n` +
          `Key: \`${key}\`\n` +
          `Owner: ${owner ? `<@${owner.id}>` : "Unassigned"}`,
        ephemeral: true
      });
    }

    if (command === "reset-hwid") {
      const key = interaction.options.getString("key").trim();

      if (!db.keys[key]) {
        return interaction.reply({
          content: "❌ License key not found.",
          ephemeral: true
        });
      }

      delete db.hwids[key];
      db.keys[key].hwid = null;
      db.keys[key].hwidResetAt = new Date().toISOString();

      saveDB();

      return interaction.reply({
        content: `✅ HWID reset for \`${key}\`.`,
        ephemeral: true
      });
    }

    if (command === "blacklist") {
      const target = interaction.options.getString("target").trim();
      const reason = interaction.options.getString("reason");

      db.blacklisted[target] = {
        reason,
        moderatorId: interaction.user.id,
        createdAt: new Date().toISOString()
      };

      if (db.keys[target]) {
        db.keys[target].active = false;
      }

      saveDB();

      return interaction.reply({
        content: `⛔ Blacklisted \`${target}\`.\nReason: ${reason}`,
        ephemeral: true
      });
    }

    if (command === "ban") {
      const user = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") || "No reason specified";

      const member = await interaction.guild.members.fetch(user.id);

      if (!member.bannable) {
        return interaction.reply({
          content:
            "❌ I cannot ban this member. Check my Ban Members permission and role hierarchy.",
          ephemeral: true
        });
      }

      await member.ban({
        reason: `${reason} | Moderator: ${interaction.user.tag}`
      });

      return interaction.reply({
        content: `🔨 Banned ${user.tag}.\nReason: ${reason}`,
        ephemeral: true
      });
    }

    if (command === "unblacklist") {
      const target = interaction.options.getString("target").trim();

      if (!db.blacklisted[target]) {
        return interaction.reply({
          content: "That target is not blacklisted.",
          ephemeral: true
        });
      }

      delete db.blacklisted[target];

      if (db.keys[target]) {
        db.keys[target].active = true;
      }

      saveDB();

      return interaction.reply({
        content: `✅ Removed \`${target}\` from the blacklist.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error(`/${interaction.commandName} failed:`, error);

    const reply = {
      content: "An error occurred. Check the Render logs.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})().catch(error => {
  console.error("Startup error:", error);
  process.exitCode = 1;
});
