const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================
// CONFIG
// ============================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID =
    process.env.STAFF_ROLE_ID || "1552637829815865414";

const BUYER_ROLE_ID =
    process.env.BUYER_ROLE_ID || "1554321313332469800";

const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
        "Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in Render Environment."
    );
    process.exit(1);
}

// ============================================
// EXPRESS / RENDER HEALTH CHECK
// ============================================

const app = express();

app.get("/", (req, res) => {
    res.status(200).send("Jayce bot is online 💗");
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "online",
        bot: "Jayce",
        time: new Date().toISOString()
    });
});

// Serve scripts only to the extent authorized by your loader setup.
// These endpoints do not independently validate buyer roles or keys.
const scriptsFolder = path.join(__dirname, "scripts");

app.get("/load/:type", (req, res) => {
    const scriptFiles = {
        main: "main.lua",
        mobile: "mobile.lua"
    };

    const fileName = scriptFiles[req.params.type];

    if (!fileName) {
        return res.status(404).send("-- Script not found");
    }

    const filePath = path.join(scriptsFolder, fileName);

    try {
        const script = fs.readFileSync(filePath, "utf8");
        res.type("text/plain").send(script);
    } catch (error) {
        console.error("[SCRIPT ERROR]", error.message);
        res.status(404).send("-- Script missing on server");
    }
});

app.listen(PORT, () => {
    console.log(`[EXPRESS] Listening on port ${PORT}`);
});

// ============================================
// DATABASE
// ============================================

const DATA_DIR =
    process.env.DATA_DIR ||
    (fs.existsSync("/var/data")
        ? "/var/data"
        : path.join(__dirname, "data"));

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "jayce-database.json");

function loadDatabase() {
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

let db = loadDatabase();

function saveDatabase() {
    const temporaryFile = DB_FILE + ".tmp";
    fs.writeFileSync(temporaryFile, JSON.stringify(db, null, 2));
    fs.renameSync(temporaryFile, DB_FILE);
}

// ============================================
// DISCORD CLIENT
// ============================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

function hasRole(interaction, roleId) {
    const roles = interaction.member?.roles;

    if (roles?.cache) {
        return roles.cache.has(roleId);
    }

    return Array.isArray(roles) && roles.includes(roleId);
}

function isStaff(interaction) {
    return hasRole(interaction, STAFF_ROLE_ID);
}

function isBuyer(interaction) {
    return hasRole(interaction, BUYER_ROLE_ID);
}

function isBlacklisted(userId) {
    return Boolean(db.blacklist[userId]);
}

// ============================================
// JAYCE PANEL
// ============================================

function createPanel() {
    const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
        .setDescription(
            "Welcome to Jayce! ♡\n\n" +
            " **Mobile Script**\n" +
            "Get your mobile loader if you have buyer access.\n\n" +
            " **Reset HWID**\n" +
            "Request help with resetting your HWID.\n\n" +
            "💗 Select a button below to continue."
        )
        .setFooter({ text: "jayce  ♡  soft & secure" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("jc_mobilemain")
            .setLabel("Mobile Script")
            .setEmoji(".")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("jc_resethwid")
            .setLabel("Reset HWID")
            .setEmoji(".")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [row]
    };
}

// ============================================
// SLASH COMMANDS
// ============================================

const commands = [
    new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Post the Jayce panel"),

    new SlashCommandBuilder()
        .setName("setpanel")
        .setDescription("Choose and post the panel channel")
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("Channel for the panel")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("adminpanel")
        .setDescription("View Jayce staff commands"),

    new SlashCommandBuilder()
        .setName("channel")
        .setDescription("Configure Jayce channels")
        .addStringOption(option =>
            option.setName("action")
                .setDescription("Channel setting")
                .setRequired(true)
                .addChoices(
                    { name: "Set panel channel", value: "panel" },
                    { name: "Set announcement channel", value: "announcement" },
                    { name: "Show configured channels", value: "show" }
                )
        )
        .addChannelOption(option =>
            option.setName("target")
                .setDescription("Target text channel")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check whether Jayce is online"),

    new SlashCommandBuilder()
        .setName("pm")
        .setDescription("Show payment methods"),

    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Show bot statistics"),

    new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send an announcement")
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("Announcement channel")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Announcement text")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("generate-key")
        .setDescription("Generate a bot tracking key")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Key recipient")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("getkey")
        .setDescription("Get your recorded bot tracking key"),

    new SlashCommandBuilder()
        .setName("getmain")
        .setDescription("Get the main script loader"),

    new SlashCommandBuilder()
        .setName("jaycescripts")
        .setDescription("Get the mobile script loader"),

    new SlashCommandBuilder()
        .setName("lookup")
        .setDescription("Look up an account")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to look up")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("account")
        .setDescription("View your recorded account"),

    new SlashCommandBuilder()
        .setName("grantaccess")
        .setDescription("Record bot access")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("disableaccess")
        .setDescription("Disable recorded bot access")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("revoke")
        .setDescription("Revoke a recorded bot tracking key")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("dmbuyerupdate")
        .setDescription("Send a private buyer update")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Update message")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Blacklist a user")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("User to blacklist")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unblacklist")
        .setDescription("Remove a user from the blacklist")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("User to unblacklist")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a server member")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Member to ban")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Ban reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("listallaccounts")
        .setDescription("List recorded accounts"),

    new SlashCommandBuilder()
        .setName("reset-hwid")
        .setDescription("Request HWID reset assistance")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("forceresethwid")
        .setDescription("Check HWID reset integration status")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Buyer")
                .setRequired(true)
        )
].map(command => command.toJSON());

// ============================================
// REGISTER COMMANDS
// ============================================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );

    console.log(`[COMMANDS] Registered ${commands.length} commands.`);
}

// ============================================
// INTERACTION HANDLER
// ============================================

client.on("interactionCreate", async interaction => {
    try {
        // PANEL BUTTONS
        if (interaction.isButton()) {
            if (
                interaction.customId !== "jc_mobilemain" &&
                interaction.customId !== "jc_resethwid"
            ) {
                return;
            }

            if (!isBuyer(interaction) || isBlacklisted(interaction.user.id)) {
                return interaction.reply({
                    content: "❌ You need buyer access to use this feature.",
                    ephemeral: true
                });
            }

            if (interaction.customId === "jc_mobilemain") {
                return interaction.reply({
                    content:
                        " **Jayce Mobile Script**\n\n" +
                        "```lua\n" +
                        `loadstring(game:HttpGet("${process.env.RENDER_EXTERNAL_URL || "YOUR_RENDER_URL"}/load/mobile"))()` +
                        "\n```",
                    ephemeral: true
                });
            }

            return interaction.reply({
                content:
                    "HWID Reset.",
                ephemeral: true
            });
        }

        if (!interaction.isChatInputCommand()) return;

        await interaction.deferReply({ ephemeral: true });

        const name = interaction.commandName;
        const user = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const reason =
            interaction.options.getString("reason") || "No reason provided.";

        // PUBLIC COMMANDS
        if (name === "ping") {
            return interaction.editReply("💗 Jayce is online!");
        }

        if (name === "pm") {
            return interaction.editReply(
                process.env.PAYMENT_METHODS ||
                "Contact Jayce staff for payment methods."
            );
        }

        if (name === "account") {
            const account = db.accounts[interaction.user.id];

            return interaction.editReply(
                account
                    ? `Access: ${account.access ? "Enabled" : "Disabled"}\nTracking key: ${account.key || "None"}\nBlacklisted: ${isBlacklisted(interaction.user.id) ? "Yes" : "No"}`
                    : "No recorded account found."
            );
        }

        if (name === "getkey") {
            if (!isBuyer(interaction) || isBlacklisted(interaction.user.id)) {
                return interaction.editReply("❌ Buyer access required.");
            }

            const account = db.accounts[interaction.user.id];

            return interaction.editReply(
                account?.key
                    ? `Your bot tracking key: \`${account.key}\``
                    : "No tracking key found. Contact staff."
            );
        }

        if (name === "getmain" || name === "jaycescripts") {
            if (!isBuyer(interaction) || isBlacklisted(interaction.user.id)) {
                return interaction.editReply("❌ Buyer access required.");
            }

            const type = name === "getmain" ? "main" : "mobile";
            const base = process.env.RENDER_EXTERNAL_URL;

            if (!base) {
                return interaction.editReply(
                    "❌ Set RENDER_EXTERNAL_URL in Render Environment to your service URL."
                );
            }

            return interaction.editReply(
                ````lua\nloadstring(game:HttpGet("${base}/load/${type}"))()\n````
            );
        }

        // ALL OTHER COMMANDS REQUIRE STAFF ROLE
        if (!isStaff(interaction)) {
            return interaction.editReply(
                "❌ Only Jayce staff can use this command."
            );
        }

        if (name === "panel") {
            const channel = db.panelChannel
                ? await client.channels.fetch(db.panelChannel).catch(() => null)
                : interaction.channel;

            if (!channel?.isTextBased() || !channel.send) {
                return interaction.editReply(
                    "Set a valid panel channel using `/setpanel`."
                );
            }

            await channel.send(createPanel());
            return interaction.editReply(`💗 Panel posted in <#${channel.id}>.`);
        }

        if (name === "setpanel") {
            const channel = interaction.options.getChannel("channel");

            if (!channel?.isTextBased() || !channel.send) {
                return interaction.editReply("Choose a text channel.");
            }

            db.panelChannel = channel.id;
            saveDatabase();

            await channel.send(createPanel());

            return interaction.editReply(
                `💗 Panel saved and posted in <#${channel.id}>.`
            );
        }

        if (name === "adminpanel") {
            const embed = new EmbedBuilder()
                .setColor(0xFF9ED2)
                .setTitle("💗 Jayce Admin Panel")
                .setDescription(
                    "`/panel` — Post panel\n" +
                    "`/setpanel` — Set panel channel\n" +
                    "`/channel` — Configure channels\n" +
                    "`/announce` — Send announcement\n" +
                    "`/generate-key` — Create tracking key\n" +
                    "`/blacklist` — Blacklist user\n" +
                    "`/unblacklist` — Remove blacklist\n" +
                    "`/ban` — Ban member\n" +
                    "`/grantaccess` — Record access\n" +
                    "`/disableaccess` — Disable recorded access\n" +
                    "`/revoke` — Revoke tracking key\n" +
                    "`/lookup` — Look up account\n" +
                    "`/listallaccounts` — List accounts"
                );

            return interaction.editReply({ embeds: [embed] });
        }

        if (name === "channel") {
            const action = interaction.options.getString("action");
            const target = interaction.options.getChannel("target");

            if (action === "show") {
                return interaction.editReply(
                    `Panel: ${db.panelChannel ? `<#${db.panelChannel}>` : "Not set"}\n` +
                    `Announcements: ${db.announcementChannel ? `<#${db.announcementChannel}>` : "Not set"}`
                );
            }

            if (!target?.isTextBased() || !target.send) {
                return interaction.editReply(
                    "Select a text channel in the `target` option."
                );
            }

            if (action === "panel") {
                db.panelChannel = target.id;
            } else {
                db.announcementChannel = target.id;
            }

            saveDatabase();

            return interaction.editReply(
                `✅ ${action} channel set to <#${target.id}>.`
            );
        }

        if (name === "stats") {
            return interaction.editReply(
                `Accounts: ${Object.keys(db.accounts).length}\n` +
                `Blacklisted users: ${Object.keys(db.blacklist).length}`
            );
        }

        if (name === "announce") {
            const channel = interaction.options.getChannel("channel");

            if (!channel?.isTextBased() || !channel.send) {
                return interaction.editReply("Choose a text channel.");
            }

            await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF9ED2)
                        .setTitle("💗 Jayce Announcement")
                        .setDescription(message)
                        .setFooter({
                            text: `Posted by ${interaction.user.username}`
                        })
                        .setTimestamp()
                ]
            });

            return interaction.editReply("✅ Announcement sent.");
        }

        if (name === "generate-key") {
            const key =
                "JAY
