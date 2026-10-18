
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// ===== JAYCE MAIN CONFIG =====
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE = "1552637829815865414";
const MAIN_ROLE = "1552637429456961657";
const MOBILE_ROLE =
  process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const COLOR = 0xFF9ED2;
const LOADER_URL =
  "https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua";

const MAIN_SCRIPT =
  `loadstring(game:HttpGet("${LOADER_URL}"))()`;

const MOBILE_SCRIPT = MAIN_SCRIPT;

// ===== BOT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===== RENDER KEEP-ALIVE / HEALTH =====
const app = express();

app.get("/", (req, res) => {
  res.status(200).send("♡ Jayce Main is online.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    bot: client.isReady(),
    uptime: Math.floor(process.uptime())
  });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("[WEB] Health server started.");
});

// ===== DATABASE =====
const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

let db = {
  keys: {},
  accounts: {},
  hwids: {},
  access: {},
  blacklisted: {}
};

function saveDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = DB_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(db, null, 2));
    fs.renameSync(temp, DB_FILE);
  } catch (e) {
    console.error("[DATABASE] Save error:", e);
  }
}

function loadDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      db = {
        keys: saved.keys || {},
        accounts: saved.accounts || {},
        hwids: saved.hwids || {},
        access: saved.access || {},
        blacklisted: saved.blacklisted || {}
      };
    }
    saveDB();
    console.log("[DATABASE] Loaded successfully.");
  } catch (e) {
    console.error("[DATABASE] Load error:", e);
  }
}
loadDB();

// ===== HELPERS =====
function embed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "jayce  ♡  soft & secure" })
    .setTimestamp();
}

function staff(interaction) {
  return interaction.member?.roles?.cache?.has(STAFF_ROLE) || false;
}

function blocked(id) {
  return Boolean(db.blacklisted[id]);
}

function allowed(id) {
  return db.access[id] !== false && !blocked(id);
}

function createKey() {
  return crypto.randomBytes(18).toString("hex").toUpperCase();
}

async function findMember(guild, id) {
  if (!guild) return null;
  return guild.members.fetch(id).catch(() => null);
}

async function giveRole(member, type) {
  const roleId = type === "mobile" ? MOBILE_ROLE : MAIN_ROLE;
  const role = await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role) throw new Error(`Role ${roleId} was not found.`);
  await member.roles.add(roleId);
}

async function removeScriptRoles(member) {
  await member.roles.remove([MAIN_ROLE, MOBILE_ROLE]);
}

async function dmScript(user, type) {
  const script = type === "mobile" ? MOBILE_SCRIPT : MAIN_SCRIPT;
  await user.send({
    embeds: [
      embed(
        type === "mobile" ? "📱 Jayce Mobile Main" : "♡ Jayce Main Script",
        "Your script is below. Keep it private. ♡"
      )
    ],
    content: "```lua\n" + script + "\n```"
  });
}

function activeKeyFor(id) {
  return Object.entries(db.keys).find(([, k]) =>
    k.userId === id && !k.revoked
  );
}

async function reply(interaction, options) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options);
  }
  return interaction.reply(options);
}

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Post the Jayce Main customer panel"),

  new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Show staff commands"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot status"),

  new SlashCommandBuilder()
    .setName("pm")
    .setDescription("Show payment-method information"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show database statistics"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a server announcement")
    .addStringOption(o => o.setName("message")
      .setDescription("Announcement text").setRequired(true))
    .addChannelOption(o => o.setName("channel")
      .setDescription("Destination channel").setRequired(false)),

  new SlashCommandBuilder()
    .setName("generate-key")
    .setDescription("Generate an access key for a buyer")
    .addUserOption(o => o.setName("user")
      .setDescription("Buyer").setRequired(true))
    .addStringOption(o => o.setName("script")
      .setDescription("Script type").setRequired(true)
      .addChoices(
        { name: "Main", value: "main" },
        { name: "Mobile Main", value: "mobile" }
      )),

  new SlashCommandBuilder()
    .setName("getkey")
    .setDescription("DM yourself your active key"),

  new SlashCommandBuilder()
    .setName("jaycescripts")
    .setDescription("DM a buyer their script")
    .addUserOption(o => o.setName("user")
      .setDescription("Buyer").setRequired(true))
    .addStringOption(o => o.setName("script")
      .setDescription("Script type").setRequired(true)
      .addChoices(
        { name: "Main", value: "main" },
        { name: "Mobile Main", value: "mobile" }
      )),

  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up a buyer's account")
    .addUserOption(o => o.setName("user")
      .setDescription("Buyer").setRequired(true)),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View account information")
    .addUserOption(o => o.setName("user")
      .setDescription("Account").setRequired(true)),

  new SlashCommandBuilder()
    .setName("grantaccess")
    .setDescription("Grant script access and role")
    .addUserOption(o => o.setName("user")
      .setDescription("Buyer").setRequired(true))
    .addStringOption(o => o.setName("script")
      .setDescription("Script type").setRequired(true)
      .addChoices(
        { name: "Main", value: "main" },
        { name: "Mobile Main", value: "mobile" }
      )),

  new SlashCommandBuilder()
    .setName("disableaccess")
    .setDescription("Disable a user's access")
    .addUserOption(o => o.setName("user")
      .setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke a user's access")
    .addUserOption(o => o.setName("user")
      .setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason")
      .setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("dmbuyerupdate")
    .setDescription("DM a buyer an update")
    .addUserOption(o => o.setName("user")
      .setDescription("Buyer").setRequired(true))
    .addStringOption(o => o.setName("message")
      .setDescription("Update text").setRequired(true)),

  new SlashCommandBuilder()
    .setName("forceresethwid")
    .setDescription("Clear locally stored HWID fields")
    .addUserOption(o => o.setName("user")
      .setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user")
    .addUserOption(o => o.setName("user")
      .setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason")
      .setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user from the blacklist")
    .addUserOption(o => o.setName("user")
      .setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .addUserOption(o => o.setName("user")
      .setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason")
      .setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("listallaccounts")
    .setDescription("List registered accounts")
].map(c => c.toJSON());

// ===== REGISTER COMMANDS =====
async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error(
      "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in Render Environment."
    );
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const registered = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log(`[COMMANDS] Registered ${registered.length} commands.`);
}

// ===== CUSTOMER PANEL BUTTONS =====
function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("jc_register")
        .setLabel("Register")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("jc_key")
        .setLabel("Get Key")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("jc_script")
        .setLabel("Get Script")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("jc_reset")
        .setLabel("Reset HWID")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

// ===== INTERACTIONS =====
client.on("interactionCreate", async interaction => {
  try {
    // ----- Buttons -----
    if (interaction.isButton()) {
      const id = interaction.customId;
      const uid = interaction.user.id;

      if (id === "jc_register") {
        const modal = new ModalBuilder()
          .setCustomId("jc_register_modal")
          .setTitle("Jayce Registration");

        const field = new TextInputBuilder()
          .setCustomId("roblox")
          .setLabel("Roblox username")
          .setPlaceholder("Your Roblox username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32);

        modal.addComponents(
          new ActionRowBuilder().addComponents(field)
        );
        return interaction.showModal(modal);
      }

      if (id === "jc_reset") {
        return reply(interaction, {
          content: "♡ Contact staff to request an HWID reset.",
          ephemeral: true
        });
      }

      if (id === "jc_key") {
        if (!allowed(uid)) {
          return reply(interaction, {
            content: "Your access is disabled or blacklisted.",
            ephemeral: true
          });
        }

        const pair = activeKeyFor(uid);
        if (!pair) {
          return reply(interaction, {
            content: "No active key found. Contact staff.",
            ephemeral: true
          });
        }

        try {
          await interaction.user.send(`♡ Your key: \`${pair[0]}\``);
          return reply(interaction, {
            content: "Your key was sent to your DMs.",
            ephemeral: true
          });
        } catch {
          return reply(interaction, {
            content: "Enable DMs and try again.",
            ephemeral: true
          });
        }
      }

      if (id === "jc_script") {
        if (!allowed(uid)) {
          return reply(interaction, {
            content: "Your access is disabled or blacklisted.",
            ephemeral: true
          });
        }

        const member = await findMember(interaction.guild, uid);
        if (!member) {
          return reply(interaction, {
            content: "Couldn't find you in this server.",
            ephemeral: true
          });
        }

        const type = member.roles.cache.has(MAIN_ROLE)
          ? "main"
          : member.roles.cache.has(MOBILE_ROLE)
            ? "mobile" : null;

        if (!type) {
          return reply(interaction, {
            content: "You need a Main or Mobile Main role.",
            ephemeral: true
          });
        }

        await dmScript(interaction.user, type);
        return reply(interaction, {
          content: "Script sent to your DMs.",
          ephemeral: true
        });
      }
      return;
    }

    // ----- Registration modal -----
    if (interaction.isModalSubmit() &&
        interaction.customId === "jc_register_modal") {
      const username =
        interaction.fields.getTextInputValue("roblox").trim();

      if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
        return reply(interaction, {
          content: "Use 3–32 letters, numbers, or underscores.",
          ephemeral: true
        });
      }

      db.accounts[interaction.user.id] = {
        username,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag
      };
      saveDB();

      return reply(interaction, {
        embeds: [
          embed("🎀 Registration complete",
            `Roblox username: **${username}**`)
        ],
        ephemeral: true
      });
    }

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const uid = interaction.user.id;

    // ----- Public commands -----
    if (name === "ping") {
      return reply(interaction, {
        content: `Pong! 🏓 ${client.ws.ping}ms`,
        ephemeral: true
      });
    }

    if (name === "pm") {
      return reply(interaction, {
        embeds: [
          embed("♡ Jayce's Payment Methods",
            "Contact Jayce staff for current payment instructions. Never share passwords or private account credentials.")
        ],
        ephemeral: true
      });
    }

    if (name === "getkey") {
      if (!allowed(uid)) {
        return reply(interaction, {
          content: "Your access is disabled or blacklisted.",
          ephemeral: true
        });
      }

      const pair = activeKeyFor(uid);
      if (!pair) {
        return reply(interaction, {
          content: "No active key found. Contact staff.",
          ephemeral: true
        });
      }

      await interaction.user.send(`♡ Your key: \`${pair[0]}\``)
        .then(() => reply(interaction, {
          content: "Key sent to your DMs.",
          ephemeral: true
        }))
        .catch(() => reply(interaction, {
          content: "I couldn't DM you. Enable DMs.",
          ephemeral: true
        }));
      return;
    }

    // ----- Staff-only commands -----
    if (!staff(interaction)) {
      return reply(interaction, {
        content: "You don't have permission to use this command.",
        ephemeral: true
      });
    }

    if (name === "panel") {
      return reply(interaction, {
        embeds: [
          embed(
            "˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚",
            "Welcome to Jayce Main! 🎀\n\n" +
            "**Register** — save your Roblox username\n" +
            "**Get Key** — receive your key by DM\n" +
            "**Get Script** — receive the script for your role\n" +
            "**Reset HWID** — request help from staff"
          )
        ],
        components: panelButtons()
      });
    }

    if (name === "adminpanel") {
      return reply(interaction, {
        embeds: [
          embed("♡ Jayce Staff Commands", [
            "`/lookup` — find buyer information",
            "`/account` — view an account",
            "`/generate-key` — create a key",
            "`/grantaccess` — grant a script role",
            "`/disableaccess` — disable access",
            "`/revoke` — revoke access",
            "`/dmbuyerupdate` — DM a buyer",
            "`/forceresethwid` — clear local HWID fields",
            "`/jaycescripts` — DM a script",
            "`/blacklist` and `/unblacklist`",
            "`/announce` — post an announcement",
            "`/ban` — ban a member",
            "`/stats` and `/listallaccounts`"
          ].join("\n"))
        ],
        ephemeral: true
      });
    }

    if (name === "stats") {
      const keys = Object.values(db.keys);
      return reply(interaction, {
        embeds: [
          embed("🔮 Jayce Statistics", [
            `Accounts: **${Object.keys(db.accounts).length}**`,
            `Keys: **${keys.length}**`,
            `Active keys: **${keys.filter(k => !k.revoked).length}**`,
            `Blacklisted: **${Object.keys(db.blacklisted).length}**`
          ].join("\n"))
        ],
        ephemeral: true
      });
    }

    if (name === "announce") {
      const message = interaction.options.getString("message", true);
      const channel =
        interaction.options.getChannel("channel") || interaction.channel;

      if (!channel?.isTextBased() || !channel.send) {
        return reply(interaction, {
          content: "Select a text channel.",
          ephemeral: true
        });
      }

      await channel.send({
        embeds: [embed("📢 Jayce Announcement", message)]
      });
      return reply(interaction, {
        content: `Announcement sent in ${channel}.`,
        ephemeral: true
      });
    }

    if (name === "generate-key") {
      const user = interaction.options.getUser("user", true);
      const type = interaction.options.getString("script", true);

      if (blocked(user.id)) {
        return reply(interaction, {
          content: "Unblacklist this user first.",
          ephemeral: true
        });
      }

      const key = createKey();
      db.keys[key] = {
        userId: user.id,
        script: type,
        createdBy: uid,
        createdAt: new Date().toISOString(),
        revoked: false
      };
      db.access[user.id] = true;
      saveDB();

      try {
        await user.send(
          `♡ Your Jayce ${type === "mobile" ? "Mobile Main" : "Main"} key:\n\`${key}\``
        );
        return reply(interaction, {
          content: `Key created and sent to ${user.tag}.`,
          ephemeral: true
        });
      } catch {
        return reply(interaction, {
          content: `Key created, but DM failed. Key: \`${key}\``,
          ephemeral: true
        });
      }
    }

    if (name === "jaycescripts") {
      const user = interaction.options.getUser("user", true);
      const type = interaction.options.getString("script", true);

      if (!allowed(user.id)) {
        return reply(interaction, {
          content: "That user is blocked or disabled.",
          ephemeral: true
        });
      }

      await dmScript(user, type);
      return reply(interaction, {
        content: `Script sent to ${user.tag}.`,
        ephemeral: true
      });
    }

    if (name === "lookup" || name === "account") {
      const user = interaction.options.getUser("user", true);
      const account = db.accounts[user.id];
      const keys = Object.entries(db.keys)
        .filter(([, k]) => k.userId === user.id)
        .map(([key, k]) =>
          `• \`${key}\` — ${k.script} — ${k.revoked ? "revoked" : "active"}`
        );

      return reply(interaction, {
        embeds: [
          embed("♡ Jayce Account Lookup", [
            `Discord: ${user.tag}`,
            `Discord ID: \`${user.id}\``,
            `Roblox username: **${account?.username || "Not registered"}**`,
            `Registered: ${account?.registeredAt || "No"}`,
            `Access: **${allowed(user.id) ? "Enabled" : "Disabled/blocked"}**`,
            `Local HWID field: **${db.hwids[user.id] ? "Present (hidden)" : "None"}**`,
            "**Keys:**",
            keys.length ? keys.join("\n") : "No keys found."
          ].join("\n"))
        ],
        ephemeral: true
      });
    }

    if (name === "grantaccess") {
      const user = interaction.options.getUser("user", true);
      const type = interaction.options.getString("script", true);

      if (blocked(user.id)) {
        return reply(interaction, {
          content: "Remove the blacklist before granting access.",
          ephemeral: true
        });
      }

      const member = await findMember(interaction.guild, user.id);
      if (!member) {
        return reply(interaction, {
          content: "That user isn't in this server.",
          ephemeral: true
        });
      }

      await giveRole(member, type);
      db.access[user.id] = true;
      saveDB();

      return reply(interaction, {
        content: `Granted ${type} access to ${user.tag}.`,
        ephemeral: true
      });
    }

    if (name === "disableaccess" || name === "revoke") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ||
        "Access disabled by staff.";

      db.access[user.id] = false;
      for (const key of Object.values(db.keys)) {
        if (key.userId === user.id) key.revoked = true;
      }
      saveDB();

      const member = await findMember(interaction.guild, user.id);
      if (member) {
        await removeScriptRoles(member).catch(e =>
          console.error("[ROLES] Removal failed:", e.message)
        );
      }

      if (name === "revoke") {
        await user.send(`Your Jayce access was revoked. Reason: ${reason}`)
          .catch(() => {});
      }

      return reply(interaction, {
        content: `Access revoked/disabled for ${user.tag}.`,
        ephemeral: true
      });
    }

    if (name === "dmbuyerupdate") {
      const user = interaction.options.getUser("user", true);
      const message = interaction.options.getString("message", true);

      try {
        await user.send({
          embeds: [embed("♡ Jayce Buyer Update", message)]
        });
        return reply(interaction, {
          content: `Update sent to ${user.tag}.`,
          ephemeral: true
        });
      } catch {
        return reply(interaction, {
          content: `Couldn't DM ${user.tag}. Their DMs may be closed.`,
          ephemeral: true
        });
      }
    }

    if (name === "forceresethwid") {
      const user = interaction.options.getUser("user", true);

      delete db.hwids[user.id];
      if (db.accounts[user.id]) delete db.accounts[user.id].hwid;

      for (const key of Object.values(db.keys)) {
        if (key.userId === user.id) delete key.hwid;
      }
      saveDB();

      return reply(interaction, {
        content:
          `Cleared HWID fields stored in this bot's database for ${user.tag}. ` +
          "This does not reset HWID data stored by an external authentication provider.",
        ephemeral: true
      });
    }

    if (name === "blacklist") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ||
        "No reason supplied.";

      db.blacklisted[user.id] = {
        reason,
        by: uid,
        at: new Date().toISOString()
      };
      db.access[user.id] = false;

      for (const key of Object.values(db.keys)) {
        if (key.userId === user.id) key.revoked = true;
      }
      saveDB();

      const member = await findMember(interaction.guild, user.id);
      if (member) {
        await removeScriptRoles(member).catch(() => {});
      }

      return reply(interaction, {
        content: `Blacklisted ${user.tag}. Reason: ${reason}`,
        ephemeral: true
      });
    }

    if (name === "unblacklist") {
      const user = interaction.options.getUser("user", true);
      delete db.blacklisted[user.id];
      db.access[user.id] = true;
      saveDB();

      return reply(interaction, {
        content: `${user.tag} was removed from the blacklist. Re-grant roles if needed.`,
        ephemeral: true
      });
    }

    if (name === "ban") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ||
        `Banned by ${interaction.user.tag}`;

      const member = await findMember(interaction.guild, user.id);
      if (!member) {
        return reply(interaction, {
          content: "That member isn't in this server.",
          ephemeral: true
        });
      }

      await member.ban({ reason });
      return reply(interaction, {
        content: `Banned ${user.tag}.`,
        ephemeral: true
      });
    }

    if (name === "listallaccounts") {
      const entries = Object.entries(db.accounts).slice(0, 25);
      const list = entries.length
        ? entries.map(([id, a]) =>
            `• <@${id}> — **${a.username || "unknown"}**`
          ).join("\n")
        : "No registered accounts.";

      return reply(interaction, {
        embeds: [embed("♡ Registered Accounts", list)],
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("[INTERACTION ERROR]", error);

    try {
      await reply(interaction, {
        content: "Something went wrong. Check the Render logs.",
        ephemeral: true
      });
    } catch {}
  }
});

// ===== STARTUP =====
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("[COMMANDS] Registration failed:", error);
  }
});

if (!TOKEN) {
  console.error("[CONFIG] DISCORD_TOKEN is missing.");
} else {
  client.login(TOKEN).catch(error => {
    console.error("[BOT] Login failed:", error);
    process.exitCode = 1;
  });
}
