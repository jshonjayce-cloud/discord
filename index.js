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

// -------------------- Configuration --------------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = '1552637829815865414';
const MAIN_ROLE_ID = '1552637429456961657';
const MOBILE_MAIN_ROLE_ID =
  process.env.MOBILE_MAIN_ROLE_ID || '1554321313332469800';

const PANEL_COLOR = 0xff9ed2;

const UPDATED_LOADER =
  'loadstring(game:HttpGet("https://flowauth.net/v1/loaders/a98aeecca217266364e1eb0396c7a283.lua"))()';

const GET_SCRIPT_TEXT = UPDATED_LOADER;
const MOBILE_MAIN_LOADSTRING = UPDATED_LOADER;

// -------------------- Discord client --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// -------------------- Render web server --------------------
const app = express();

app.get('/', (_req, res) => {
  res.status(200).send('Jayce Main bot is running 💗');
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

// -------------------- JSON database --------------------
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

// -------------------- Helpers --------------------
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
      text: 'jayce  ♡  soft & secure',
    })
    .setTimestamp();
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
    'Here is your updated script. Keep it private.'
  );

  await user.send({
    embeds: [embed],
    content: `\`\`\`lua\n${script}\n\`\`\``,
  });
}

// -------------------- Slash command definitions --------------------
const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Send the Jayce Main customer panel'),

  new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('View the Jayce Main admin panel'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement')
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Announcement text')
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to announce in')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('generate-key')
    .setDescription('Generate a Jayce access code')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User receiving the code')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('jaycescripts')
    .setDescription('Send a buyer their Jayce script')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Buyer receiving the script')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('script')
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
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Account to inspect')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('disableaccess')
    .setDescription("Disable a user's Jayce access")
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to disable')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('grantaccess')
    .setDescription('Grant a user Jayce access')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to grant access')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a user')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to blacklist')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason for the blacklist')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription("Remove a user's blacklist")
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to unblacklist')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from this server')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member to ban')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('listallaccounts')
    .setDescription('List registered Jayce accounts'),
].map(command => command.toJSON());

// -------------------- Register commands --------------------
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
    console.error(
      '[COMMANDS] Registration failed:',
      error
    );
  }
});

// -------------------- Interaction handler --------------------
client.on('interactionCreate', async interaction => {
  try {
    // Customer panel buttons
    if (interaction.isButton()) {
      const userId = interaction.user.id;

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

      if (isBlacklisted(userId)) {
        return interaction.reply({
          content: '⛔ Your account is blacklisted.',
          ephemeral: true,
        });
      }

      if (!accessEnabled(userId)) {
        return interaction.reply({
          content: '🔒 Your Jayce access is disabled. Contact staff.',
          ephemeral: true,
        });
      }

      if (
        interaction.customId === 'jc_key' ||
        interaction.customId === 'jc_mobilemain'
      ) {
        const member = await getGuildMember(
          interaction.guild,
          userId
        );

        if (!member) {
          return interaction.reply({
            content: "I couldn't find you in this server.",
            ephemeral: true,
          });
        }

        const mobile =
          interaction.customId === 'jc_mobilemain';

        const requiredRole = mobile
          ? MOBILE_MAIN_ROLE_ID
          : MAIN_ROLE_ID;

        if (!member.roles.cache.has(requiredRole)) {
          return interaction.reply({
            content: mobile
              ? "You don't have the Mobile Main role."
              : "You don't have the Jayce Main role.",
            ephemeral: true,
          });
        }

        try {
          await sendScriptDM(
            interaction.user,
            mobile ? 'mobile' : 'main'
          );

          return interaction.reply({
            content: mobile
              ? '📱 Mobile Main was sent to your DMs.'
              : '💗 Jayce Main was sent to your DMs.',
            ephemeral: true,
          });
        } catch {
          return interaction.reply({
            content: "I couldn't DM you. Enable server DMs and try again.",
            ephemeral: true,
          });
        }
      }

      return;
    }

    // Registration modal
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'jc_register_modal'
    ) {
      const username = interaction.fields
        .getTextInputValue('roblox_username')
        .trim();

      if (!username) {
        return interaction.reply({
          content: 'Please enter a valid username.',
          ephemeral: true,
        });
      }

      db.accounts[interaction.user.id] = {
        username,
        registeredAt: new Date().toISOString(),
        discordTag: interaction.user.tag,
      };

      saveDatabase();

      return interaction.reply({
        embeds: [
          makeEmbed(
            '♡ Registration Complete',
            `**Roblox username:** ${username}\n**Discord:** ${interaction.user.tag}`
          ),
        ],
        ephemeral: true,
      });
    }

    if (!interaction.isChatInputCommand()) return;

    // All slash commands require the staff role
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '⛔ You do not have permission to use this command.',
        ephemeral: true,
      });
    }

    const commandName = interaction.commandName;

    // -------------------- Customer panel --------------------
    if (commandName === 'panel') {
      const embed = makeEmbed(
        '˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚',
        [
          'Welcome to **Jayce Main** ♡',
          '',
          '♡ Register your account',
          '♡ Get your Main script',
          '♡ Get Mobile Main',
          '',
          'Choose an option below to continue.',
        ].join('\n')
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('jc_register')
          .setLabel('♡ Register')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('jc_key')
          .setLabel('♡ Get Script')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('jc_mobilemain')
          .setLabel('♡ Mobile Main')
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
      });
    }

    // -------------------- Admin panel --------------------
    if (commandName === 'adminpanel') {
      const embed = makeEmbed(
        '♡ Jayce Main Admin Panel',
        [
          '**Account Management**',
          '`/account` — inspect an account',
          '`/grantaccess` — grant access',
          '`/disableaccess` — disable access',
          '`/generate-key` — create an access code',
          '',
          '**Script Delivery**',
          '`/jaycescripts` — send Main or Mobile Main',
          '`/panel` — post the customer panel',
          '',
          '**Moderation**',
          '`/blacklist` — blacklist a user',
          '`/unblacklist` — remove a blacklist',
          '`/ban` — ban a member',
          '',
          '**Other**',
          '`/announce` — send an announcement',
          '`/listallaccounts` — list registrations',
        ].join('\n')
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    // -------------------- Announcements --------------------
    if (commandName === 'announce') {
      const message = interaction.options.getString('message', true);

      const channel =
        interaction.options.getChannel('channel') ||
        interaction.channel;

      if (!channel?.isTextBased() || !channel.send) {
        return interaction.reply({
          content: 'Please select a text channel.',
          ephemeral: true,
        });
      }

      await channel.send({
        embeds: [
          makeEmbed('♡ Jayce Main Announcement', message),
        ],
      });

      return interaction.reply({
        content: `Announcement sent to ${channel}.`,
        ephemeral: true,
      });
    }

    // -------------------- Generate access code --------------------
    if (commandName === 'generate-key') {
      const user = interaction.options.getUser('user', true);

      let code;

      do {
        code = makeCode();
      } while (db.keys[code]);

      db.keys[code] = {
        userId: user.id,
        createdAt: new Date().toISOString(),
        redeemed: false,
      };

      saveDatabase();

      try {
        await user.send({
          embeds: [
            makeEmbed(
              '♡ Your Jayce Access Code',
              `Your access code is:\n\n\`${code}\`\n\nKeep it private.`
            ),
          ],
        });

        return interaction.reply({
          content: `Access code generated and sent to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return interaction.reply({
          content: `Code generated, but I couldn't DM ${user}.\nCode: \`${code}\``,
          ephemeral: true,
        });
      }
    }

    // -------------------- Send script --------------------
    if (commandName === 'jaycescripts') {
      const user = interaction.options.getUser('user', true);
      const scriptType =
        interaction.options.getString('script', true);

      if (isBlacklisted(user.id)) {
        return interaction.reply({
          content: '⛔ That user is blacklisted.',
          ephemeral: true,
        });
      }

      if (!accessEnabled(user.id)) {
        return interaction.reply({
          content: "🔒 That user's Jayce access is disabled.",
          ephemeral: true,
        });
      }

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      if (!member) {
        return interaction.reply({
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      const requiredRole =
        scriptType === 'mobile'
          ? MOBILE_MAIN_ROLE_ID
          : MAIN_ROLE_ID;

      if (!member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content:
            "That user doesn't have the required script role. Use `/grantaccess` if they should receive access.",
          ephemeral: true,
        });
      }

      try {
        await sendScriptDM(user, scriptType);

        return interaction.reply({
          content: `♡ Sent the ${
            scriptType === 'mobile' ? 'Mobile Main' : 'Main'
          } script to ${user}.`,
          ephemeral: true,
        });
      } catch {
        return interaction.reply({
          content: `I couldn't DM ${user}. They may need to enable server DMs.`,
          ephemeral: true,
        });
      }
    }

    // -------------------- Account details --------------------
    if (commandName === 'account') {
      const user = interaction.options.getUser('user', true);
      const account = db.accounts[user.id];

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      const codes = Object.entries(db.keys)
        .filter(([, data]) => data.userId === user.id)
        .map(([code, data]) => {
          const status = data.redeemed
            ? 'Redeemed'
            : 'Not redeemed';

          return `Code: ${code} — ${status}`;
        });

      const roleMain = Boolean(
        member?.roles.cache.has(MAIN_ROLE_ID)
      );

      const roleMobile = Boolean(
        member?.roles.cache.has(MOBILE_MAIN_ROLE_ID)
      );

      const embed = makeEmbed(
        '♡ Jayce Account Information',
        [
          `**Discord:** ${user.tag}`,
          `**User ID:** ${user.id}`,
          `**Roblox username:** ${account?.username || 'Not registered'}`,
          `**Registered:** ${account?.registeredAt || 'No'}`,
          `**Access:** ${accessEnabled(user.id) ? 'Enabled' : 'Disabled'}`,
          `**Blacklisted:** ${isBlacklisted(user.id) ? 'Yes' : 'No'}`,
          `**Main role:** ${roleMain ? 'Yes' : 'No'}`,
          `**Mobile Main role:** ${roleMobile ? 'Yes' : 'No'}`,
          '',
          '**Generated codes:**',
          codes.length ? codes.join('\n').slice(0, 1500) : 'No codes found.',
        ].join('\n')
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    // -------------------- Disable access --------------------
    if (commandName === 'disableaccess') {
      const user = interaction.options.getUser('user', true);

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      db.access[user.id] = false;
      saveDatabase();

      if (member) {
        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error('[ACCESS] Role removal failed:', error);

          return interaction.reply({
            content:
              `Access was marked disabled for ${user}, but I couldn't remove all roles. Check Manage Roles and the bot's role hierarchy.`,
            ephemeral: true,
          });
        }
      }

      return interaction.reply({
        content: `🔒 Jayce access disabled for ${user}.`,
        ephemeral: true,
      });
    }

    // -------------------- Grant access --------------------
    if (commandName === 'grantaccess') {
      const user = interaction.options.getUser('user', true);

      if (isBlacklisted(user.id)) {
        return interaction.reply({
          content: "⛔ Remove the user's blacklist before granting access.",
          ephemeral: true,
        });
      }

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      if (!member) {
        return interaction.reply({
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      try {
        await setScriptRoles(member, true);
      } catch (error) {
        console.error('[ACCESS] Role grant failed:', error);

        return interaction.reply({
          content:
            "I couldn't assign the roles. Check Manage Roles and make sure the bot's highest role is above both script roles.",
          ephemeral: true,
        });
      }

      db.access[user.id] = true;
      saveDatabase();

      return interaction.reply({
        content: `💗 Jayce access granted to ${user}.`,
        ephemeral: true,
      });
    }

    // -------------------- Blacklist --------------------
    if (commandName === 'blacklist') {
      const user = interaction.options.getUser('user', true);

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

      db.blacklisted[user.id] = {
        reason,
        moderator: interaction.user.id,
        createdAt: new Date().toISOString(),
      };

      db.access[user.id] = false;
      saveDatabase();

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      if (member) {
        try {
          await setScriptRoles(member, false);
        } catch (error) {
          console.error('[BLACKLIST] Role removal failed:', error);
        }
      }

      return interaction.reply({
        content: `⛔ ${user} has been blacklisted.\nReason: ${reason}`,
        ephemeral: true,
      });
    }

    // -------------------- Remove blacklist --------------------
    if (commandName === 'unblacklist') {
      const user = interaction.options.getUser('user', true);

      if (!isBlacklisted(user.id)) {
        return interaction.reply({
          content: "That user isn't blacklisted.",
          ephemeral: true,
        });
      }

      delete db.blacklisted[user.id];
      delete db.access[user.id];
      saveDatabase();

      return interaction.reply({
        content:
          `♡ Removed the blacklist for ${user}. Access is enabled by default, but roles must be restored separately.`,
        ephemeral: true,
      });
    }

    // -------------------- Ban member --------------------
    if (commandName === 'ban') {
      const user = interaction.options.getUser('user', true);

      const reason =
        interaction.options.getString('reason') ||
        'No reason provided';

      const member = await getGuildMember(
        interaction.guild,
        user.id
      );

      if (!member) {
        return interaction.reply({
          content: "That user isn't a member of this server.",
          ephemeral: true,
        });
      }

      if (!member.bannable) {
        return interaction.reply({
          content:
            "I can't ban that member. Check Ban Members permission and role hierarchy.",
          ephemeral: true,
        });
      }

      await member.ban({ reason });

      return interaction.reply({
        content: `🔨 Banned ${user}.\nReason: ${reason}`,
        ephemeral: true,
      });
    }

    // -------------------- List registered accounts --------------------
    if (commandName === 'listallaccounts') {
      const entries = Object.entries(db.accounts);

      if (!entries.length) {
        return interaction.reply({
          content: 'No registered accounts yet.',
          ephemeral: true,
        });
      }

      const lines = entries.map(([userId, account]) =>
        `• **${account.username || 'Unknown'}** — <@${userId}> (\`${userId}\`)`
      );

      const chunks = [];

      for (let i = 0; i < lines.length; i += 15) {
        chunks.push(lines.slice(i, i + 15).join('\n'));
      }

      const embeds = chunks.slice(0, 10).map((chunk, index) =>
        makeEmbed(
          `♡ Registered Accounts (${entries.length})`,
          `Page ${index + 1}\n\n${chunk}`
        )
      );

      return interaction.reply({
        embeds,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error('[INTERACTION ERROR]', error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: 'Something went wrong. Check the Render logs for details.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

// -------------------- Login --------------------
if (!TOKEN) {
  console.error('[CONFIG] DISCORD_TOKEN is missing.');
} else {
  client.login(TOKEN).catch(error => {
    console.error('[BOT] Login failed:', error);
  });
}
