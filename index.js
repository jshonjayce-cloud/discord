const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ================= CONFIG =================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STAFF_ROLE_ID = '1552637829815865414';
const PANEL_BUTTON_ROLE_ID = '1554321313332469800';

const BRAND = 'Jayce Main';
const COLOR = 0xFF9ED2;
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'jayce-data.json');

const MAIN_SCRIPT_URL = process.env.MAIN_SCRIPT_URL;
const MOBILE_SCRIPT_URL = process.env.MOBILE_SCRIPT_URL;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing TOKEN, CLIENT_ID, or GUILD_ID environment variable.');
  process.exit(1);
}

// ================= DISCORD CLIENT =================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= EXPRESS KEEP-ALIVE =================

const app = express();

app.get('/', (_req, res) => {
  res.status(200).send('💗 Jayce Main is online.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    bot: client.isReady(),
    uptime: Math.floor(process.uptime())
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(
    '[EXPRESS SERVICE RUNNING] Listening on incoming gateway port ' + PORT
  );
});

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  console.log('[KEEP ALIVE] Jayce Main service is running.');
}, KEEP_ALIVE_INTERVAL).unref();

// ================= DATABASE =================

function defaultProducts() {
  return [
    {
      name: 'Main Script',
      price: 'Contact staff',
      description: 'Contact staff for availability and details.'
    },
    {
      name: 'Mobile Script',
      price: 'Contact staff',
      description: 'Contact staff for mobile compatibility details.'
    }
  ];
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

      return {
        products: Array.isArray(parsed.products)
          ? parsed.products
          : defaultProducts(),

        keys:
          parsed.keys && typeof parsed.keys === 'object'
            ? parsed.keys
            : {},

        registrations:
          parsed.registrations &&
          typeof parsed.registrations === 'object'
            ? parsed.registrations
            : {}
      };
    }
  } catch (error) {
    console.error('Database load error:', error.message);
  }

  return {
    products: defaultProducts(),
    keys: {},
    registrations: {}
  };
}

let db = loadDB();

function saveDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2),
      'utf8'
    );

    return true;
  } catch (error) {
    console.error('Database save error:', error.message);
    return false;
  }
}

// ================= PERMISSIONS =================

// Existing staff permission for staff commands.
function isStaff(interaction) {
  return Boolean(
    interaction.member?.roles?.cache?.has(STAFF_ROLE_ID) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

// ONLY this role can use the panel buttons and submit their forms.
// Administrator permission does not bypass this role requirement.
function canUsePanel(interaction) {
  const memberRoles = interaction.member?.roles;

  if (memberRoles?.cache?.has) {
    return memberRoles.cache.has(PANEL_BUTTON_ROLE_ID);
  }

  if (Array.isArray(memberRoles)) {
    return memberRoles.includes(PANEL_BUTTON_ROLE_ID);
  }

  return false;
}

async function denyPanelAccess(interaction) {
  const response = {
    content:
      '❌ You need role <@&' +
      PANEL_BUTTON_ROLE_ID +
      '> to use Jayce Main buttons and forms.',
    ephemeral: true,
    allowedMentions: { parse: [] }
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(response).catch(() => {});
  }

  return interaction.reply(response).catch(() => {});
}

// ================= HELPERS =================

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: `${BRAND} • Script Shop ♡`
    })
    .setTimestamp();
}

function makeKey() {
  let key;

  do {
    key = `JAYCE-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  } while (db.keys[key]);

  return key;
}

function makeInput(
  customId,
  label,
  placeholder,
  required = true,
  maxLength = 100
) {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(maxLength);
}

function modalWithInput(customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  for (const input of inputs) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );
  }

  return modal;
}

// ================= TERMS OF SERVICE =================

const TOS = `**♡ JAYCE MAIN — TERMS OF SERVICE ♡**

**1. Digital products:** Read the listing and ask about compatibility before buying.
**2. Payments:** Use only official payment methods. Staff must verify payment before delivery.
**3. Refunds:** Contact staff about missing, broken, or misdescribed products. Requests follow advertised terms and applicable law.
**4. Delivery:** Delivery times may vary. Wait for staff confirmation.
**5. License:** Do not leak, resell, or redistribute paid files without permission unless the listing explicitly allows it.
**6. Support and updates:** Support and compatibility depend on the product listing.
**7. Security:** Never share passwords, session cookies, or recovery codes.
**8. Abuse:** Scams, fake payment receipts, harassment, and fraud may lead to moderation.
**9. Lawful use:** Follow applicable law and platform rules. Malware, credential theft, and unauthorized access are not permitted.
**10. Changes:** Material changes should be announced. Applicable law takes precedence.`;

const RULES = `**♡ JAYCE MAIN — SERVER RULES ♡**

1. Respect members and staff.
2. No scams or fake payment receipts.
3. No spam or unsolicited advertising.
4. No harassment, threats, or doxxing.
5. Do not leak or redistribute paid products without permission.
6. Use the proper support and purchase channels.
7. Do not impersonate staff or customers.
8. No malicious files, credential theft, or harmful links.
9. Follow Discord's Terms of Service and Community Guidelines.
10. Keep disputes civil.

**Enforcement:** Warnings, timeouts, kicks, or bans may be issued depending on severity.`;

// ================= SLASH COMMANDS =================

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the Jayce Main account and script panel'),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View available scripts'),

  new SlashCommandBuilder()
    .setName('tos')
    .setDescription('Read the Terms of Service'),

  new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Read the server rules'),

  new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get customer support instructions'),

  new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('Add a product to the shop')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Product name')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('price')
        .setDescription('Price or payment instructions')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Product description')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('removeproduct')
    .setDescription('Remove a product')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Exact product name')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a server announcement')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Announcement message')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target text channel')
    ),

  new SlashCommandBuilder()
    .setName('posttos')
    .setDescription('Post the TOS')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target text channel')
    ),

  new SlashCommandBuilder()
    .setName('postrules')
    .setDescription('Post the server rules')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target text channel')
    ),

  new SlashCommandBuilder()
    .setName('staffhelp')
    .setDescription('Show staff commands')
].map(command => command.toJSON());

// ================= REGISTER COMMANDS =================

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('Slash commands registered.');
}

// ================= PANEL BUTTONS =================

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('jc_register')
        .setLabel('♡ Register')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('jc_getkey')
        .setLabel('Get Key')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('jc_getscript')
        .setLabel('Get Script')
        .setStyle(ButtonStyle.Primary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('jc_reset')
        .setLabel('Reset HWID')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('jc_generate')
        .setLabel('🔑 Generate Key (Staff)')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

// These are the exact button and modal IDs protected by the role check.
const PANEL_BUTTON_IDS = [
  'jc_register',
  'jc_getkey',
  'jc_getscript',
  'jc_reset',
  'jc_generate'
];

const PANEL_MODAL_IDS = [
  'jc_register_modal',
  'jc_keyrequest_modal',
  'jc_script_modal',
  'jc_reset_modal',
  'jc_generate_modal'
];

// ================= INTERACTIONS =================

client.on('interactionCreate', async interaction => {
  try {
    // Check role on every panel button click.
    if (
      interaction.isButton() &&
      PANEL_BUTTON_IDS.includes(interaction.customId)
    ) {
      if (!canUsePanel(interaction)) {
        return denyPanelAccess(interaction);
      }
    }

    // Check role again when any panel modal is submitted.
    // This prevents a user from submitting a form after losing the role.
    if (
      interaction.isModalSubmit() &&
      PANEL_MODAL_IDS.includes(interaction.customId)
    ) {
      if (!canUsePanel(interaction)) {
        return denyPanelAccess(interaction);
      }
    }

    // ================= AUTOCOMPLETE =================

    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);

      if (focused.name === 'name') {
        return interaction.respond(
          db.products
            .filter(product =>
              product.name.toLowerCase().includes(
                String(focused.value).toLowerCase()
              )
            )
            .slice(0, 25)
            .map(product => ({
              name: product.name.slice(0, 100),
              value: product.name.slice(0, 100)
            }))
        ).catch(() => {});
      }

      return;
    }

    // ================= BUTTON HANDLERS =================

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'jc_register') {
        return interaction.showModal(
          modalWithInput(
            'jc_register_modal',
            'Jayce Main Registration',
            [
              makeInput(
                'username',
                'Account username',
                'Enter your Roblox or customer username'
              )
            ]
          )
        );
      }

      if (id === 'jc_getkey') {
        return interaction.showModal(
          modalWithInput(
            'jc_keyrequest_modal',
            'Request a Jayce Key',
            [
              makeInput(
                'username',
                'Account username',
                'Enter the username you registered'
              )
            ]
          )
        );
      }

      if (id === 'jc_getscript') {
        return interaction.showModal(
          modalWithInput(
            'jc_script_modal',
            'Get Script — Validate Key',
            [
              makeInput(
                'username',
                'Account username',
                'Enter your registered username'
              ),
              makeInput(
                'key',
                'JAYCE key',
                'JAYCE-XXXXXXXXXXXXXXX'
              ),
              makeInput(
                'script_type',
                'Script type',
                'Type Main or Mobile'
              )
            ]
          )
        );
      }

      if (id === 'jc_reset') {
        return interaction.showModal(
          modalWithInput(
            'jc_reset_modal',
            'Request HWID Reset',
            [
              makeInput(
                'username',
                'Account username',
                'Your registered username'
              ),
              makeInput(
                'reason',
                'Reason for reset',
                'Briefly explain why you need a reset'
              )
            ]
          )
        );
      }

      if (id === 'jc_generate') {
        // The required panel role is checked above.
        // The staff permission is additionally required for key generation.
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: 'Only authorized staff can generate keys.',
            ephemeral: true
          });
        }

        return interaction.showModal(
          modalWithInput(
            'jc_generate_modal',
            'Generate Jayce Key',
            [
              makeInput(
                'discord_user_id',
                'Customer Discord user ID',
                'Right-click customer → Copy User ID'
              ),
              makeInput(
                'username',
                'Customer account username',
                'Username this key belongs to'
              ),
              makeInput(
                'days',
                'Validity in days',
                '30',
                true,
                5
              )
            ]
          )
        );
      }

      return;
    }

    // ================= MODAL SUBMISSIONS =================

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      // Registration
      if (id === 'jc_register_modal') {
        const username = interaction.fields
          .getTextInputValue('username')
          .trim();

        if (username.length < 2) {
          return interaction.reply({
            content: 'Please enter a valid username.',
            ephemeral: true
          });
        }

        const existing = db.registrations[interaction.user.id];

        if (existing) {
          return interaction.reply({
            content:
              `You are already registered as **${existing.username}**. ` +
              'Contact staff if this needs correcting.',
            ephemeral: true
          });
        }

        db.registrations[interaction.user.id] = {
          username,
          createdAt: new Date().toISOString()
        };

        if (!saveDB()) {
          delete db.registrations[interaction.user.id];

          return interaction.reply({
            content: 'Could not save registration. Please contact staff.',
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            `Registration saved for **${username}**. ` +
            'Use **Get Key** after staff confirms your purchase.',
          ephemeral: true
        });
      }

      // Key request
      if (id === 'jc_keyrequest_modal') {
        const username = interaction.fields
          .getTextInputValue('username')
          .trim();

        const registration = db.registrations[interaction.user.id];

        if (
          !registration ||
          registration.username.toLowerCase() !== username.toLowerCase()
        ) {
          return interaction.reply({
            content:
              'Registration not found or username does not match. ' +
              'Use Register first or contact staff.',
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            'Your key request has been noted. Keys are issued by staff ' +
            'after purchase verification. Please contact staff; this button ' +
            'does not create free keys.',
          ephemeral: true
        });
      }

      // Staff key generation
      if (id === 'jc_generate_modal') {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: 'Only authorized staff can generate keys.',
            ephemeral: true
          });
        }

        const targetId = interaction.fields
          .getTextInputValue('discord_user_id')
          .trim();

        const username = interaction.fields
          .getTextInputValue('username')
          .trim();

        const daysText = interaction.fields
          .getTextInputValue('days')
          .trim();

        const days = Number(daysText);

        if (
          !/^\d{17,20}$/.test(targetId) ||
          !username ||
          !Number.isInteger(days) ||
          days < 1 ||
          days > 365
        ) {
          return interaction.reply({
            content:
              'Enter a valid Discord user ID, username, and validity ' +
              'from 1 to 365 days.',
            ephemeral: true
          });
        }

        const key = makeKey();

        db.keys[key] = {
          discordUserId: targetId,
          username,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(
            Date.now() + days * 86400000
          ).toISOString(),
          revoked: false,
          usedAt: null
        };

        if (!saveDB()) {
          delete db.keys[key];

          return interaction.reply({
            content: 'Could not save key. Check persistent storage.',
            ephemeral: true
          });
        }

        const expirationTimestamp = Math.floor(
          Date.parse(db.keys[key].expiresAt) / 1000
        );

        return interaction.reply({
          content:
            `🔑 Generated key for <@${targetId}> (**${username}**)\n\n` +
            `\`${key}\`\n` +
            `Expires: <t:${expirationTimestamp}:F>\n\n` +
            'Give this key to the verified customer privately.',
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      }

      // Script key validation
      if (id === 'jc_script_modal') {
        const username = interaction.fields
          .getTextInputValue('username')
          .trim();

        const k
