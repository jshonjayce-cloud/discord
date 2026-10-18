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
} = require('discord.js');

const express = require('express');
const fs = require('fs');
const path = require('path');

// -------------------- CONFIGURATION --------------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = '1552637829815865414';
const MAIN_ROLE_ID = '1552637429456961657';
const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || '1554321313332469800';

const PANEL_COLOR = 0xFF7518;

const UPDATED_LOADER =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua"))()';

const GET_SCRIPT_TEXT = UPDATED_LOADER;
const MOBILE_MAIN_LOADSTRING = UPDATED_LOADER;

// -------------------- DISCORD CLIENT --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// -------------------- RENDER WEB SERVER --------------------
const app = express();

app.get('/', (_req, res) => {
  res.status(200).send('🎃 Jayce Main is running. Happy Halloween! 🦇');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    bot: 'Jayce Main',
    discord: client.isReady(),
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WEB] Listening on port ${PORT}`);
});

// -------------------- DATABASE --------------------
const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, 'data');

const DB_FILE = path.join(DATA_DIR, 'database.json');

let db = {
  keys: {},
  blacklisted: {},
  hwids: {},
  accounts: {},
  access: {},
};

function saveDatabase() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tempFile = `${DB_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2)
    );

    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error('[DATABASE] Save error:', error);
  }
}

function loadDatabase() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(DB_FILE)) {
      const loaded = JSON.parse(
        fs.readFileSync(DB_FILE, 'utf8')
      );

      db = {
        keys: loaded.keys || {},
        blacklisted: loaded.blacklisted || {},
        hwids: loaded.hwids || {},
        accounts: loaded.accounts || {},
        access: loaded.access || {},
      };
    }

    saveDatabase();
    console.log('[DATABASE] Loaded successfully.');
  } catch (error) {
    console.error('[DATABASE] Load error:', error);
  }
}

loadDatabase();

// -------------------- HELPERS --------------------
function isStaff(member) {
  return Boolean(
    member?.roles?.cache?.has(STAFF_ROLE_ID)
  );
}

function isBlacklisted(userId) {
  return Boolean(db.blacklisted[userId]);
}

function accessEnabled(userId) {
  return db.access[userId] !== false;
}

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: '🎃 jayce  ♡  spooky & secure 🦇',
    })
    .setTimestamp();
}

function replyWithHeart(interaction, options) {
  if (
    typeof options.content === 'string' &&
    !options.content.trimStart().startsWith('♡')
  ) {
    options.content = `♡ ${options.content}`;
  }

  if (Array.isArray(options.embeds)) {
    options.embeds = options.embeds.map(embed => {
      const title = embed.data?.title;

      if (
        typeof title === 'string' &&
        !title.trimStart().startsWith('♡')
      ) {
        embed.setTitle(`♡ ${title}`);
      }

      return embed;
    });
  }

  return interaction.reply(options);
}

function makeCode(length = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return result;
}

async function getGuildMember(guild, userId) {
  if (!guild) return null;

  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function setScriptRoles(member, enabled) {
  const roleIds = [
    ...new Set([MAIN_ROLE_ID, MOBILE_MAIN_ROLE_ID]),
  ];

  for (const roleId of roleIds) {
    const role =
      member.guild.roles.cache.get(roleId) ||
      await member.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }

    if (enabled) {
      await member.roles.add(roleId);
    } else {
      await member.roles.remove(roleId);
    }
  }
}

async function sendScriptDM(user, scriptType) {
  const script =
    scriptType === 'mobile'
      ? MOBILE_MAIN_LOADSTRING
      : GET_SCRIPT_TEXT;

  const embed = makeEmbed(
    scriptType === 'mobile'
      ? '📱 Jayce Mobile Main'
      : '💗 Jayce Main Script',
    'Here is your script. Keep it private. ♡'
  );

  await user.send({
    embeds: [embed],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

// -------------------- SLASH COMMANDS --------------------
const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Send the Jayce Main Halloween customer panel'),

  new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('View the Jayce Main admin panel'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a Halloween-themed announcement')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Announcement text')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to announce in')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('generate-key')
    .setDescription('Generate a Jayce access code')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User receiving the code')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('jaycescripts')
    .setDescription('Send a buyer their Jayce script')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Buyer receiving the script')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('script')
        .setDescription('Choose which script')
        .setRequired(true)
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile Main', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('account')
    .setDescription("View a user's Jayce account")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Account to inspect')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('disableaccess')
    .setDescription("Disable a user's Jayce access")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to disable')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('grantaccess')
    .setDescription('Grant access to one Jayce script')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to grant access')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('script')
        .setDescription('Which script did they purchase?')
        .setRequired(true)
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile Main', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to blacklist')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the blacklist')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription("Remove a user's blacklist")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to unblacklist')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from this server')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('listallaccounts')
    .setDescription('List registered Jayce accounts'),
].map(command => command.toJSON());

// -------------------- REGISTER COMMANDS --------------------
async function registerCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error(
      '[CONFIG] Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.'
    );
    return;
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('[COMMANDS] Registered successfully.');
}

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error('[COMMANDS] Registration failed:', error);
  }
});

// -------------------- INTERACTION HANDLER --------------------
client.on('interactionCreate', async interaction => {
  try {
    // CUSTOMER PANEL BUTTONS
    if (interaction.isButton()) {
      const userId = interaction.user.id;

      // REGISTER BUTTON
      if (interaction.customId === 'jc_register') {
        const modal = new ModalBuilder()
          .setCustomId('jc_register_modal')
          .setTitle('♡ Jayce Registration');

        const usernameInput = new TextInputBuilder()
          .setCustomId('roblox_username')
          .setLabel('Your Roblox username')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter your Roblox username')
          .setRequired(true)
          .setMaxLength(32);

        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput)
        );

        return interaction.showModal(modal);
      }

      // GET STATS BUTTON
      // Stats are visible to panel users without script access.
      if (interaction.customId === 'jc_stats') {
        const totalAccounts =
          Object.keys(db.accounts).length;

        const totalKeys =
          Object.keys(db.keys).length;

        const redeemedKeys =
          Object.values(db.keys).filter(
            entry => entry && entry.redeemed
          ).length;

        const blacklistedCount =
          Object.keys(db.blacklisted).length;

        const enabledAccess =
          Object.keys(db.access).filter(
            id => db.access[id] !== false
          ).length;

        const disabledAccess =
          Object.values(db.access).filter(
            value => value === false
          ).length;

        const stats = makeEmbed(
          '🎃 Jayce Main • Spooky Stats 🦇',
          [
            'A tiny peek at the haunted control room! ♡',
            '',
            `👻 **Registered accounts:** ${totalAccounts}`,
            `🗝️ **Access codes created:** ${totalKeys}`,
            `✨ **Codes redeemed:** ${redeemedKeys}`,
            `💜 **Enabled access records:** ${enabledAccess}`,
            `🔒 **Disabled access records:** ${disabledAccess}`,
            `🎃 **Blacklisted accounts:** ${blacklistedCount}`,
            '',
            '*Updated from the bot database.*',
          ].join('\n')
        );

        return replyWithHeart(interaction, {
          embeds: [stats],
          ephemeral: true,
        });
      }

      // CHECK BLACKLIST AND ACCESS FOR SCRIPT BUTTONS
      if (isBlacklisted(userId)) {
        return replyWithHeart(interaction, {
          content: '⛔ Your account is blacklisted.',
          ephemeral: true,
        });
      }

      if (!access
