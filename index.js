
"use strict";

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
    PermissionFlagsBits
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ======================================================
// CONFIGURATION
// ======================================================

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

const ROOT = __dirname;
const SCRIPTS_DIR = path.join(ROOT, "scripts");

const DATA_DIR = fs.existsSync("/var/data")
    ? "/var/data"
    : path.join(ROOT, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

const DATABASE_FILE = path.join(
    DATA_DIR,
    "jayce-database.json"
);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
        "[CONFIG ERROR] Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID."
    );
    process.exit(1);
}

// ======================================================
// DATABASE
// ======================================================

function emptyDatabase() {
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
            return emptyDatabase();
        }

        const loaded = JSON.parse(
            fs.readFileSync(DATABASE_FILE, "utf8")
        );

        return {
            ...emptyDatabase(),
            ...loaded
        };
    } catch (error) {
        console.error("[DATABASE LOAD ERROR]", error);
        return emptyDatabase();
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

function getAccount(userId) {
    if (!db.accounts[userId]) {
        db.accounts[userId] = {
            userId,
            createdAt: new Date().toISOString(),
            key: null,
            access: false,
            mobileAccess: false,
            hwid: null
        };
    }

    return db.accounts[userId];
}

function makeKey() {
    return (
        "JAYCE-" +
        crypto.randomBytes(4).toString("hex").toUpperCase() +
        "-" +
        crypto.randomBytes(4).toString("hex").toUpperCase()
    );
}

function isStaff(member) {
    return Boolean(
        member?.roles?.cache?.has(STAFF_ROLE_ID)
    );
}

function hasRole(member, roleId) {
    return Boolean(
        member?.roles?.cache?.has(roleId)
    );
}

function isBlacklisted(userId) {
    return Boolean(db.blacklisted[userId]);
}

function hasLocalAccess(userId, mobile = false) {
    const account = db.accounts[userId];

    if (!account || isBlacklisted(userId)) {
        return false;
    }

    return mobile
        ? Boolean(account.mobileAccess)
        : Boolean(account.access);
}

function canUseLoader(member, userId, mobile = false) {
    if (isBlacklisted(userId)) {
        return false;
    }

    if (isStaff(member)) {
        return true;
    }

    const roleId = mobile
        ? MOBILE_MAIN_ROLE_ID
        : MAIN_ROLE_ID;

    return (
        hasRole(member, roleId) ||
        hasLocalAccess(userId, mobile)
    );
}

async function replyPrivate(interaction, content) {
    const payload = {
        content,
        ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload);
    }

    return interaction.reply(payload);
}

async function requireStaff(interaction) {
    if (!isStaff(interaction.member)) {
        await replyPrivate(
            interaction,
            "You do not have permission to use this staff command."
        );

        return false;
    }

    return true;
}

function createEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0xFF9ED2)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "jayce  ♡  soft & secure"
        })
        .setTimestamp();
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ======================================================
// EXPRESS KEEP-ALIVE SERVICE
// ======================================================

const app = express();

app.disable("x-powered-by");

app.get("/", (req, res) => {
    res.status(200).json({
        service: "Jayce Main",
        status: "online",
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        discordReady: client.isReady(),
        uptimeSeconds: Math.floor(process.uptime())
    });
});

app.get("/scripts", (req, res) => {
    res.status(200).json({
        available: ["main", "mobile"],
        message: "Jayce script service"
    });
});

// IMPORTANT:
// These URLs are public. The Discord panel checks permissions
// before sharing the loader, but a copied URL can still be opened
// directly. Real endpoint protection requires a separate
// authenticated loader/token verification system.

app.get("/load/:type", (req, res) => {
    const type = String(req.params.type || "").toLowerCase();

    const allowed = {
        main: "main.lua",
        mobile: "mobile.lua"
    };

    if (!allowed[type]) {
        return res.status(404).send("Unknown script.");
    }

    const filePath = path.join(SCRIPTS_DIR, allowed[type]);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send(
            "Script file not found: " + allowed[type]
        );
    }

    res.type("text/plain");
    res.set("Cache-Control", "no-store");

    return res.sendFile(filePath);
});

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(
        "[EXPRESS SERVICE RUNNING] Listening on port " + PORT
    );
});

// Optional lightweight self-check. This does not replace Render's
// own health checks or guarantee that a hosting service stays awake.
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

const keepAliveTimer = setInterval(() => {
    if (!server.listening) {
        console.warn("[KEEP ALIVE] Express server is not listening.");
        return;
    }

    console.log("[KEEP ALIVE] Service is running.");
}, KEEP_ALIVE_INTERVAL);

if (typeof keepAliveTimer.unref === "function") {
    keepAliveTimer.unref();
}

// ======================================================
// SLASH COMMAND DEFINITIONS
// ======================================================

const commands = [
    new SlashCommandBuilder()
        .setName("panel")
        .setDescription("Show the Jayce Main panel"),

    new SlashCommandBuilder()
        .setName("adminpanel")
        .setDescription("Show the Jayce staff panel"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot response time"),

    new SlashCommandBuilder()
        .setName("pm")
        .setDescription("Show Jayce payment methods"),

    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Show bot statistics"),

    new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send an announcement")
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Announcement text")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("generate-key")
        .setDescription("Generate a Jayce tracking key")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account owner")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("getkey")
        .setDescription("Retrieve your registered key"),

    new SlashCommandBuilder()
        .setName("getmain")
        .setDescription("Get the main loader"),

    new SlashCommandBuilder()
        .setName("jaycescripts")
        .setDescription("Show available Jayce scripts"),

    new SlashCommandBuilder()
        .setName("lookup")
        .setDescription("Look up a Discord account")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("User to look up")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("account")
        .setDescription("View an account record")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to inspect")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("grantaccess")
        .setDescription("Grant script access and the matching Discord role")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to grant")
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
        .setDescription("Disable script access and remove access roles")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to disable")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("revoke")
        .setDescription("Remove a user's stored key")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to revoke")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("dmbuyerupdate")
        .setDescription("DM an update to script role holders")
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Update message")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("forceresethwid")
        .setDescription("Clear a locally stored HWID")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to reset")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Blacklist an account locally")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to blacklist")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unblacklist")
        .setDescription("Remove a local blacklist")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Account to unblacklist")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a member from this Discord server")
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
        .setDescription("List locally registered accounts")
];

// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        {
            body: commands.map(command => command.toJSON())
        }
    );

    console.log("[COMMANDS] Registered guild slash commands.");
}

// ======================================================
// PANELS
// ======================================================

function createMainPanel() {
    const embed = createEmbed(
        "˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚",
        [
            "Welcome to **Jayce Main** ♡",
            "",
            "♡ **Register** — create your local account",
            "♡ **Get Key** — retrieve your registered key",
            "♡ **Main Loader** — get the main loader",
            "♡ **Mobile Loader** — get the mobile loader",
            "♡ **Reset HWID** — request an HWID reset",
            "",
            "Use the buttons below to continue."
        ].join("\n")
    );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("jc_register")
            .setLabel("♡ Register")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("jc_key")
            .setLabel("♡ Get Key")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("jc_main")
            .setLabel("♡ Main Loader")
            .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("jc_mobilemain")
            .setLabel("♡ Mobile Loader")
            .setStyle(ButtonStyle.Success),

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

function createAdminPanel() {
    return {
        embeds: [
            createEmbed(
                "♡ Jayce Staff Panel",
                [
                    "Staff commands:",
                    "",
                    "`/generate-key` — generate a tracking key",
                    "`/grantaccess` — grant access and roles",
                    "`/disableaccess` — disable access and remove roles",
                    "`/revoke` — remove a stored key",
                    "`/forceresethwid` — clear stored HWID",
                    "`/blacklist` — locally blacklist a user",
                    "`/unblacklist` — remove local blacklist",
                    "`/ban` — ban a Discord member",
                    "`/lookup` — look up a user",
                    "`/account` — inspect an account",
                    "`/listallaccounts` — list local accounts"
                ].join("\n")
            )
        ]
    };
}

// ======================================================
// INTERACTION HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        // --------------------------------------------------
        // BUTTONS
        // --------------------------------------------------

        if (interaction.isButton()) {
            const userId = interaction.user.id;

            if (interaction.customId === "jc_register") {
                const modal = new ModalBuilder()
                    .setCustomId("jc_register_modal")
                    .setTitle("♡ Jayce Registration");

                const field = new TextInputBuilder()
                    .setCustomId("registration_note")
                    .setLabel("Optional registration note")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(field)
                );

                return interaction.showModal(modal);
            }

            if (interaction.customId === "jc_key") {
                if (isBlacklisted(userId)) {
                    return replyPrivate(
                        interaction,
                        "Your account is blacklisted. Contact staff."
                    );
                }

                const account = db.accounts[userId];

                if (!account || !account.key) {
                    return replyPrivate(
                        interaction,
                        "You do not have a registered key yet. Press Register first."
                    );
                }

                return replyPrivate(
                    interaction,
                    "**♡ Your Jayce Key**\n`" + account.key + "`"
                );
            }

            if (
                interaction.customId === "jc_main" ||
                interaction.customId === "jc_mobilemain"
            ) {
                const mobile =
                    interaction.customId === "jc_mobilemain";

                if (
                    !canUseLoader(
                        interaction.member,
                        userId,
                        mobile
                    )
                ) {
                    return replyPrivate(
                        interaction,
                        isBlacklisted(userId)
                            ? "Your account is blacklisted. Contact staff."
                            : "You do not have access to this loader. Contact staff."
                    );
                }

                if (!BASE_URL) {
                    return replyPrivate(
                        interaction,
                        "The Render URL is not configured. Set RENDER_EXTERNAL_URL in your Render environment variables."
                    );
                }

                const type = mobile ? "mobile" : "main";

                const loader =
                    'loadstring(game:HttpGet("' +
                    BASE_URL +
                    "/load/" +
                    type +
                    '"))()';

                return replyPrivate(
                    interaction,
                    "**♡ Jayce " +
                    (mobile ? "Mobile" : "Main") +
                    " Loader**\n```lua\n" +
                    loader +
                    "\n```"
                );
            }

            if (interaction.customId === "jc_resethwid") {
                return replyPrivate(
                    interaction,
                    "To request a reset, contact staff and use `/forceresethwid` if authorized. This only clears the HWID stored in this bot's database."
                );
            }
        }

        // --------------------------------------------------
        // REGISTRATION MODAL
        // --------------------------------------------------

        if (
            interaction.isModalSubmit() &&
            interaction.customId === "jc_register_modal"
        ) {
            const userId = interaction.user.id;

            if (isBlacklisted(userId)) {
                return replyPrivate(
                    interaction,
                    "Your account is blacklisted. Contact staff."
                );
            }

            const account = 
