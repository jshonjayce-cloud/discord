
'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
} = require('discord.js');

// ============================================================
// JAYCE MAIN — DISCORD BOT + LICENSE VALIDATION API
//
// Required environment variables:
// DISCORD_TOKEN
// CLIENT_ID
// GUILD_ID
// VALIDATION_SECRET
//
// Optional:
// PORT
// DATA_DIR (use /var/data with a persistent Render disk)
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VALIDATION_SECRET = process.env.VALIDATION_SECRET;

const STAFF_ROLE_ID = '1552637829815865414';
const MAIN_ROLE_ID = '1552637429456961657';
const MOBILE_ROLE_ID = '1554321313332469800';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    'Missing environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID.'
  );
  process.exit(1);
}

// ------------------------------------------------------------
// Persistent JSON storage
// ------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || '/var/data';
const FALLBACK_DIR = path.join(__dirname, 'data');

const STORAGE_DIR = fs.existsSync(DATA_DIR)
  ? DATA_DIR
  : FALLBACK_DIR;

const DB_FILE = path.join(STORAGE_DIR, 'keys.json');

function ensureDatabase() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ keys: {} }, null, 2),
      'utf8'
    );
  }
}

function readDatabase() {
  ensureDatabase();

  const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  if (!parsed.keys || typeof parsed.keys !== 'object') {
    parsed.keys = {};
  }

  return parsed;
}

function writeDatabase(database) {
  ensureDatabase();

  const temporaryFile = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(database, null, 2),
    'utf8'
  );

  fs.renameSync(temporaryFile, DB_FILE);
}

// ------------------------------------------------------------
// License key functions
// ------------------------------------------------------------

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}

function hashKey(key) {
  return crypto
    .createHash('sha256')
    .update(normalizeKey(key))
    .digest('hex');
}

function createKeyString() {
  const segment = () =>
    crypto.randomBytes(4).toString('hex').toUpperCase();

  return `JAYCE-${segment()}-${segment()}-${segment()}`;
}

function generateKey(ownerId, days, product) {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('Key duration must be from 1 to 365 days.');
  }

  if (!['main', 'mobile'].includes(product)) {
    throw new Error('Unknown product.');
  }

  const database = readDatabase();

  let key;
  let digest;

  do {
    key = createKeyString();
    digest = hashKey(key);
  } while (database.keys[digest]);

  const now = Date.now();

  database.keys[digest] = {
    ownerId,
    product,
    createdAt: now,
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    revoked: false,
    revokedAt: null,
  };

  writeDatabase(database);

  // The raw key is returned only at creation time.
  // Only the SHA-256 hash is stored in the database.
  return {
    key,
    expiresAt: database.keys[digest].expiresAt,
  };
}

function validateKey(key, product) {
  const normalized = normalizeKey(key);

  if (!normalized) {
    return { valid: false, reason: 'No key was supplied.' };
  }

  const database = readDatabase();
  const record = database.keys[hashKey(normalized)];

  if (!record) {
    return { valid: false, reason: 'Key not found.' };
  }

  if (record.revoked) {
    return { valid: false, reason: 'Key has been revoked.' };
  }

  if (record.expiresAt <= Date.now()) {
    return { valid: false, reason: 'Key has expired.' };
  }

  if (product && record.product !== product) {
    return {
      valid: false,
      reason: `This key is not for the ${product} product.`,
    };
  }

  return {
    valid: true,
    reason: 'Key is valid.',
    ownerId: record.ownerId,
    product: record.product,
    expiresAt: record.expiresAt,
  };
}

function revokeKey(key) {
  const database = readDatabase();
  const digest = hashKey(key);
  const record = database.keys[digest];

  if (!record) {
    return false;
  }

  record.revoked = true;
  record.revokedAt = Date.now();

  writeDatabase(database);
  return true;
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// ------------------------------------------------------------
// Express web server and validation endpoint
// ------------------------------------------------------------

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.get('/', (_req, res) => {
  res.status(200).send('Jayce Main service is running.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    botReady: client.isReady(),
    uptime: Math.floor(process.uptime()),
  });
});

// Used by a loader or application that you control.
// Configure VALIDATION_SECRET in Render.
// Send POST /api/validate with JSON:
// { "key": "JAYCE-...", "product": "main" }
// Header: x-api-secret: YOUR_VALIDATION_SECRET
app.post('/api/validate', (req, res) => {
  if (!VALIDATION_SECRET) {
    return res.status(503).json({
      valid: false,
      error: 'Validation API is not configured.',
    });
  }

  const suppliedSecret = req.get('x-api-secret') || '';
  const expected = Buffer.from(VALIDATION_SECRET);
  const supplied = Buffer.from(suppliedSecret);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({
      valid: false,
      error: 'Unauthorized.',
    });
  }

  const key = req.body?.key;
  const product = req.body?.product;

  if (!['main', 'mobile'].includes(product)) {
    return res.status(400).json({
      valid: false,
      error: 'Product must be main or mobile.',
    });
  }

  try {
    const result = validateKey(key, product);

    return res.status(200).json({
      valid: result.valid,
      reason: result.reason,
      product: result.valid ? result.product : undefined,
      expiresAt: result.valid ? result.expiresAt : undefined,
    });
  } catch (error) {
    console.error('API validation error:', error.message);

    return res.status(500).json({
      valid: false,
      error: 'Validation service error.',
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error('HTTP error:', error.message);

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  return res.status(500).json({ error: 'Internal server error.' });
});

// ------------------------------------------------------------
// Discord bot
// ------------------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function hasRole(interaction, roleId) {
  return Boolean(interaction.member?.roles?.cache?.has(roleId));
}

function isStaff(interaction) {
  return hasRole(interaction, STAFF_ROLE_ID);
}

function makePanel() {
  const embed = new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle('˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚')
    .setDescription(
      'Welcome to Jayce Main ♡\n\n' +
      '**Register** — create a personal license key.\n' +
      '**Get Key** — generate a new key.\n' +
      '**Main Script** — validate a Main license.\n' +
      '**Mobile Script** — validate a Mobile license.\n\n' +
      'Keys expire automatically. Revoked and expired keys are rejected.'
    )
    .setFooter({ text: 'jayce  ♡  soft & secure' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('jc_register')
      .setLabel('♡ Register')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('jc_key')
      .setLabel('Get Key')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('jc_main')
      .setLabel('Main Script')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('jc_mobilemain')
      .setLabel('Mobile Script')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('jc_resethwid')
      .setLabel('Reset HWID')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function makeValidationModal(product) {
  return new ModalBuilder()
    .setCustomId(`jc_validate_${product}`)
    .setTitle(`Validate ${product} key`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('license_key')
          .setLabel('Your license key')
          .setPlaceholder('JAYCE-XXXXXXXX-XXXXXXXX-XXXXXXXX')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64)
      )
    );
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether Jayce is online.'),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the Jayce Main panel (staff only).'),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate a license key (staff only).')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Discord account receiving the key')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('Duration from 1 to 365 days')
        .setMinValue(1)
        .setMaxValue(365)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('product')
        .setDescription('License product')
        .setRequired(true)
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('validatekey')
    .setDescription('Check a license key.')
    .addStringOption(option =>
      option
        .setName('key')
        .setDescription('License key')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('product')
        .setDescription('Product to validate')
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('Revoke a license key (staff only).')
    .addStringOption(option =>
      option
        .setName('key')
        .setDescription('License key to revoke')
        .setRequired(true)
    ),
].map(command => command.toJSON());

client.once(Events.ClientReady, readyClient => {
  console.log(`Discord logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === 'ping') {
        return interaction.reply({
          content: 'Pong! Jayce is online.',
          ephemeral: true,
        });
      }

      if (name === 'panel') {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: 'You do not have permission to post the panel.',
            ephemeral: true,
          });
        }

        return interaction.reply(makePanel());
      }

      if (name === 'generatekey') {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: 'Only authorized staff can generate keys.',
            ephemeral: true,
          });
        }

        const user = interaction.options.getUser('user', true);
        const days = interaction.options.getInteger('days', true);
        const product = interaction.options.getString('product', true);

        const generated = generateKey(user.id, days, product);

        await interaction.reply({
          content:
            `Generated a **${product}** key for <@${user.id}>.\n` +
            `Expires: ${formatDate(generated.expiresAt)}\n` +
            `Key: \`${generated.key}\``,
          ephemeral: true,
        });

        try {
          await user.send(
            `Your Jayce ${product} license key ♡\n` +
            `\`${generated.key}\`\n` +
            `Expires: ${formatDate(generated.expiresAt)}\n\n` +
            'Keep this key private.'
          );
        } catch {
          console.log(`Could not DM generated key to ${user.id}.`);
        }

        return;
      }

      if (name === 'validatekey') {
        const key = interaction.options.getString('key', true);
        const product = interaction.options.getString('product');

        const result = validateKey(key, product);

        return interaction.reply({
          content: result.valid
            ? `Valid key ♡\nProduct: **${result.product}**\nExpires: ${formatDate(result.expiresAt)}`
            : `Key rejected: ${result.reason}`,
          ephemeral: true,
        });
      }

      if (name === 'revokekey') {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: 'Only authorized staff can revoke keys.',
            ephemeral: true,
          });
        }

        const key = interaction.options.getString('key', true);
        const revoked = revokeKey(key);

        return interaction.reply({
          content: revoked ? 'Key revoked successfully.' : 'Key not found.',
          ephemeral: true,
        });
      }
    }

    // Panel buttons
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'jc_register' || id === 'jc_key') {
        const product = 'main';
        const generated = generateKey(
          interaction.user.id,
          30,
          product
        );

        return interaction.reply({
          content:
            `Your Jayce ${product} key is ready ♡\n` +
            `\`${generated.key}\`\n` +
            `Expires: ${formatDate(generated.expiresAt)}\n\n` +
            'This key is linked to your Discord account. Keep it private.',
          ephemeral: true,
        });
      }

      if (id === 'jc_main' || id === 'jc_mobilemain') {
        const product = id === 'jc_mobilemain' ? 'mobile' : 'main';
        const requiredRole =
          product === 'mobile' ? MOBILE_ROLE_ID : MAIN_ROLE_ID;

        if (!hasRole(interaction, requiredRole)) {
          return interaction.reply({
            content: 'You do not have the role required for this product.',
            ephemeral: true,
          });
        }

        return interaction.showModal(makeValidationModal(product));
      }

      if (id === 'jc_resethwid') {
        return interaction.reply({
          content:
            'HWID reset is not implemented in this version. ' +
            'Device binding requires its own secure registration and reset flow.',
          ephemeral: true,
        });
      }
    }

    // Key validation modals
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('jc_validate_')
    ) {
      const product = interaction.customId.slice('jc_validate_'.length);
      const key = interaction.fields.getTextInputValue('license_key');
      const result = validateKey(key, product);

      if (!result.valid) {
        return interaction.reply({
          content: `Key rejected: ${result.reason}`,
          ephemeral: true,
        });
      }

      if (result.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: 'This key belongs to a different Discord account.',
          ephemeral: true,
        });
      }

      return interaction.reply({
        content:
          `Your ${product} license is valid ♡\n` +
          `Expires: ${formatDate(result.expiresAt)}\n\n` +
          'License validated. Script delivery must be configured separately.',
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: 'An error occurred. Please try again later.',
        ephemeral: true,
      }).catch(console.error);
    }
  }
});

// ------------------------------------------------------------
// Start the bot and register commands
// ------------------------------------------------------------

async function startBot() {
  ensureDatabase();

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  console.log('Registering Jayce slash commands...');

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  await client.login(TOKEN);
}

startBot().catch(error => {
  console.error('Jayce failed to start:', error);
  process.exit(1);
});
                                       
