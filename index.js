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
    TextInputStyle
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// JAYCE MAIN — COMPLETE DISCORD BOT + RENDER WEB SERVICE
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID =
    process.env.STAFF_ROLE_ID || "1552637829815865414";

const MAIN_ROLE_ID =
    process.env.MAIN_ROLE_ID || "1552637429456961657";

const MOBILE_MAIN_ROLE_ID =
    process.env.MOBILE_MAIN_ROLE_ID || "1554321313332469800";

const PORT = Number(process.env.PORT) || 3000;

const BASE_URL = (
    process.env.RENDER_EXTERNAL_URL || ""
).replace(/\/+$/, "");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
        "[CONFIG ERROR] Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in Render environment variables."
    );
    process.exit(1);
}

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// ============================================================
// DATABASE
// ============================================================

const persistentDirectory = "/var/data";

const databaseDirectory = fs.existsSync(persistentDirectory)
    ? persistentDirectory
    : path.join(__dirname, "data");

const DATABASE_FILE = path.join(
    databaseDirectory,
    "jayce-database.json"
);

fs.mkdirSync(databaseDirectory, { recursive: true });

function defaultDatabase() {
    return {
        keys: {},
        accounts: {},
        hwids: {},
        access: {},
        blacklisted: {},
        bans: {},
        settings: {}
    };
}

function loadDatabase() {
    try {
        if (!fs.existsSync(DATABASE_FILE)) {
            return defaultDatabase();
        }

        const data = JSON.parse(
            fs.readFileSync(DATABASE_FILE, "utf8")
        );

        return {
            ...defaultDatabase(),
            ...data
        };
    } catch (error) {
        console.error(
            "[DATABASE ERROR]",
            error.message
        );

        return defaultDatabase();
    }
}

let db = loadDatabase();

function saveDatabase() {
    const temporaryFile = DATABASE_FILE + ".tmp";

    fs.writeFileSync(
        temporaryFile,
        JSON.stringify(db, null, 2),
        "utf8"
    );

    fs.renameSync(temporaryFile, DATABASE_FILE);
}

function createKey() {
    return (
        "JAYCE-" +
        crypto.randomBytes(4).toString("hex").toUpperCase() +
        "-" +
        crypto.randomBytes(4).toString("hex").toUpperCase()
    );
}

function getAccount(userId) {
    if (!db.accounts[userId]) {
        db.accounts[userId] = {
            userId,
            createdAt: Date.now(),
            key: null,
            hwid: null,
            active: false,
            expiresAt: null
        };
    }

    return db.accounts[userId];
}

function isStaff(member) {
    return Boolean(
        member &&
        member.roles &&
        member.roles.cache.has(STAFF_ROLE_ID)
    );
}

function hasRole(member, roleId) {
    return Boolean(
        member &&
        member.roles &&
        member.roles.cache.has(roleId)
    );
}

function isBlacklisted(userId) {
    return Boolean(db.blacklisted[userId]);
}

function isAccessActive(userId) {
    const account = db.accounts[userId];

    if (!account || !account.active) {
        return false;
    }

    if (
        account.expiresAt &&
        Date.now() >= account.expiresAt
    ) {
        account.active = false;

        if (db.access[userId]) {
            db.access[userId].active = false;
        }

        saveDatabase();
        return false;
    }

    return true;
}

function makeEmbed(
    title,
    description,
    color = 0xFF9ED2
) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

async function replyError(interaction, message) {
    const payload = {
        content: "❌ " + message,
        ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
            content: payload.content
        });
    }

    return interaction.reply(payload);
}

async function replySuccess(interaction, message) {
    const payload = {
        content: "✅ " + message,
        ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
            content: payload.content
        });
    }

    return interaction.reply(payload);
}

// ============================================================
// SCRIPT FILES
// Put main.lua and mobile.lua inside the scripts folder.
// ============================================================

const SCRIPTS_DIRECTORY = path.join(
    __dirname,
    "scripts"
);

fs.mkdirSync(SCRIPTS_DIRECTORY, { recursive: true });

function getScript(fileName) {
    try {
        const filePath = path.join(
            SCRIPTS_DIRECTORY,
            fileName
        );

        if (!fs.existsSync(filePath)) {
            console.error(
                "[SCRIPTS ERROR] Missing file: " + fileName
            );

            return null;
        }

        return fs.readFileSync(filePath, "utf8");
    } catch (error) {
        console.error(
            "[SCRIPTS ERROR]",
            error.message
        );

        return null;
    }
}

// ============================================================
// EXPRESS / RENDER WEB SERVICE
// ============================================================

app.get("/", (req, res) => {
    res.status(200).json({
        name: "Jayce Main",
        status: "online",
        service: "Discord Bot",
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        botReady: client.isReady(),
        uptimeSeconds: Math.floor(process.uptime())
    });
});

// Note: These endpoints serve the script files to anyone
// who knows their URLs. Do not store secrets in those files.

app.get("/load/:type", (req, res) => {
    const allowedTypes = {
        main: "main.lua",
        mobile: "mobile.lua"
    };

    const fileName = allowedTypes[req.params.type];

    if (!fileName) {
        return res.status(404).type("text/plain").send(
            "-- Unknown script type."
        );
    }

    const script = getScript(fileName);

    if (script === null) {
        return res.status(404).type("text/plain").send(
            "-- Script file not found. Check your scripts folder."
        );
    }

    res.setHeader(
        "Content-Type",
        "text/plain; charset=utf-8"
    );

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(script);
});

const server = app.listen(PORT, () => {
    console.log(
        "[EXPRESS SERVICE RUNNING] Listening on port " + PORT
    );
});

server.on("error", error => {
    console.error("[EXPRESS SERVER ERROR]", error);
});

// ============================================================
// SLASH COMMAND DEFINITIONS
// ============================================================

const commands = [
    new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Display the Jayce Main user panel."),

    new SlashCommandBuilder()
        .setName("adminpanel")
        .setDescription("Display the Jayce Main staff panel."),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot latency and status."),

    new SlashCommandBuilder()
        .setName("pm")
        .setDescription("Show Jayce payment methods."),

    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("View bot and database statistics."),

    new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send an announcement.")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Announcement message")
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
        .setDescription("Generate a Jayce tracking key.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Account owner")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("getkey")
        .setDescription("View your registered key."),

    new SlashCommandBuilder()
        .setName("getmain")
        .setDescription("Get the main script loader."),

    new SlashCommandBuilder()
        .setName("jaycescripts")
        .setDescription("Get a Jayce script loader.")
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription("Choose a script")
                .setRequired(true)
                .addChoices(
                    { name: "Main", value: "main" },
                    { name: "Mobile", value: "mobile" }
                )
        ),

    new SlashCommandBuilder()
        .setName("lookup")
        .setDescription("Look up a server member.")
        .addStringOption(option =>
            option
                .setName("query")
                .setDescription("User ID, username, or display name")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("account")
        .setDescription("View an account's local database status.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Account to view")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("grantaccess")
        .setDescription("Grant local database access.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User receiving access")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("days")
                .setDescription("Duration in days; 0 means no expiry")
                .setMinValue(0)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("disableaccess")
        .setDescription("Disable local database access.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to disable")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("revoke")
        .setDescription("Revoke a user's local key and access.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to revoke")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("dmbuyerupdate")
        .setDescription("DM a buyer update.")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Update message")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("forceresethwid")
        .setDescription("Clear a user's stored HWID value.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User whose stored HWID to clear")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Blacklist a user in the local database.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to blacklist")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason for blacklist")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unblacklist")
        .setDescription("Remove a local blacklist entry.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to unblacklist")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a member from this Discord server.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member to ban")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason for ban")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("listallaccounts")
        .setDescription("List locally registered accounts.")
];

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(
            CLIENT_ID,
            GUILD_ID
        ),
        {
            body: commands.map(command => command.toJSON())
        }
    );

    console.log(
        "[COMMANDS] Registered " +
        commands.length +
        " guild commands."
    );
}

// ============================================================
// USER PANEL
// ============================================================

function userPanel() {
    const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚")
        .setDescription([
            "Welcome to **Jayce Main** ♡",
            "",
            "Choose an option below.",
            "",
            "♡ Register — create your local account",
            "♡ Get Key — view your registered key",
            "♡ Main Script — access the main loader",
            "♡ Mobile Script — access the mobile loader",
            "♡ Reset HWID — request a stored HWID reset"
        ].join("\n"))
        .setFooter({
            text: "jayce  ♡  soft & secure"
        })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("jc_register")
            .setLabel("♡ Register")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("jc_key")
            .setLabel("♡ Get Key")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("jc_main")
            .setLabel("♡ Main Script")
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("jc_mobilemain")
            .setLabel("♡ Mobile Script")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("jc_resethwid")
            .setLabel("♡ Reset HWID")
            .setStyle(ButtonStyle.Danger)
    );

    return {
        embeds: [embed],
        components: [row1, row2]
    };
}

function adminPanel() {
    const embed = new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle("♡ Jayce Main — Staff Panel")
        .setDescription([
            "`/generate-key` — generate a local tracking key",
            "`/grantaccess` — grant local access",
            "`/disableaccess` — disable local access",
            "`/revoke` — revoke local key and access",
            "`/forceresethwid` — clear stored HWID",
            "`/blacklist` — add local blacklist entry",
            "`/unblacklist` — remove local blacklist entry",
            "`/listallaccounts` — list stored accounts",
            "`/announce` — send an announcement"
        ].join("\n"))
        .setFooter({
            text: "jayce  ♡  staff tools"
        });

    return { embeds: [embed] };
}

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on("interactionCreate", async interaction => {
    try {
        // ---------------- BUTTONS ----------------

        if (interaction.isButton()) {
            const userId = interaction.user.id;

            if (interaction.customId === "jc_register") {
                const modal = new ModalBuilder()
                    .setCustomId("jc_register_modal")
                    .setTitle("♡ Register Jayce Account");

                const input = new TextInputBuilder()
                    .setCustomId("register_note")
                    .setLabel("Account note (optional)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(input)
                );

                return interaction.showModal(modal);
            }

            if (interaction.customId === "jc_key") {
                if (isBlacklisted(userId)) {
                    return replyError(
                        interaction,
                        "Your account is blacklisted in the local database."
                    );
                }

                const account = getAccount(userId);

                if (!account.key) {
                    return replyError(
                        interaction,
                        "You do not have a registered key yet. Ask staff for assistance."
                    );
                }

                saveDatabase();

                return interaction.reply({
                    content:
                        "♡ Your registered key: `" +
                        account.key +
                        "`",
                    ephemeral: true
                });
            }

            if (
                interaction.customId === "jc_main" ||
                interaction.customId === "jc_mobilemain"
            ) {
                if (isBlacklisted(userId)) {
                    return replyError(
                        interaction,
                        "Your account is blacklisted in the local database."
                    );
                }

                const type =
                    interaction.customId === "jc_main"
                        ? "main"
                        : "mobile";

                const neededRole =
                    type === "main"
                        ? MAIN_ROLE_ID
                        : MOBILE_MAIN_ROLE_ID;

                if (
                    !hasRole(interaction.member, neededRole) &&
                    !isStaff(interaction.member)
                ) {
                    return replyError(
                        interaction,
                        "You do not have the Discord role required for this script."
                    );
                }

                if (!BASE_URL) {
                    return replyError(
                        interaction,
                        "The Render URL is not configu
