
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
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VALIDATION_SECRET = process.env.VALIDATION_SECRET;

const STAFF_ROLE_ID = '1552637829815865414';
const MAIN_ROLE_ID = '1552637429456961657';
const MOBILE_ROLE_ID = '1554321313332469800';

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    'Missing Render environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID'
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Use /var/data when a persistent Render disk is mounted there.
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const databasePath = path.join(dataDir, 'keys.json');

function ensureDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(
      databasePath,
      JSON.stringify({ keys: {} }, null, 2),
      'utf8'
    );
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(databasePath, 'utf8'));
}

function writeDatabase(db) {
  ensureDatabase();

  const tempPath = `${databasePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempPath, databasePath);
}

function normalizeKey(key) {
  return String(key || '').trim().toUpperCase();
}

function keyHash(key) {
  return crypto
    .createHash('sha256')
    .update(normalizeKey(key))
    .digest('hex');
}

function generateKey(ownerId, days, product) {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('Key duration must be between 1 and 365 days.');
  }

  if (!['main', 'mobile'].includes(product)) {
    throw new Error('Invalid product.');
  }

  const db = readDatabase();
  let key;
  let hash;

  do {
    const part = () => crypto.randomBytes(4).toString('hex').toUpperCase();
    key = `JAYCE-${part()}-${part()}-${part()}`;
    hash = keyHash(key);
  } while (db.keys[hash]);

  const now = Date.now();

  db.keys[hash] = {
    ownerId,
    product,
    createdAt: now,
    expiresAt: now + days * 86400000,
    revoked: false,
  };

  writeDatabase(db);
  return { key, expiresAt: db.keys[hash].expiresAt };
}

function validateKey(key, product) {
  if (!key) return { valid: false, reason: 'Key is required.' };

  const db = readDatabase();
  const record = db.keys[keyHash(key)];

  if (!record) return { valid: false, reason: 'Key not found.' };
  if (record.revoked) return { valid: false, reason: 'Key revoked.' };

  if (record.expiresAt <= Date.now()) {
    return { valid: false, reason: 'Key expired.' };
  }

  if (product && record.product !== product) {
    return { valid: false, reason: 'Wrong product.' };
  }

  return {
    valid: true,
    ownerId: record.ownerId,
    product: record.product,
    expiresAt: record.expiresAt,
  };
}

function revokeKey(key) {
  const db = readDatabase();
  const record = db.keys[keyHash(key)];

  if (!record) return false;

  record.revoked = true;
  record.revokedAt = Date.now();
  writeDatabase(db);

  return true;
}

function hasRole(interaction, roleId) {
  return Boolean(interaction.member?.roles?.cache?.has(roleId));
}

function staffOnly(interaction) {
  return hasRole(interaction, STAFF_ROLE_ID);
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// HTTP health and license validation service.
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.get('/', (_req, res) => {
  res.status(200).send('Jayce Main is online.');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    botReady: client.isReady(),
    uptime: Math.floor(process.uptime()),
  });
});

// POST /api/validate
// JSON body: { "key": "JAYCE-...", "product": "main" }
// Header: x-api-secret: the same secret configured in Render.
app.post('/api/validate', (req, res) => {
  if (!VALIDATION_SECRET) {
    return res.status(503).json({
      valid: false,
      error: 'Validation secret is not configured.',
    });
  }

  const supplied = Buffer.from(req.get('x-api-secret') || '');
  const expected = Buffer.from(VALIDATION_SECRET);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({ valid: false, error: 'Unauthorized.' });
  }

  const { key, product } = req.body || {};

  if (!['main', 'mobile'].includes(product)) {
    return res.status(400).json({
      valid: false,
      error: 'Product must be main or mobile.',
    });
  }

  try {
    const result = validateKey(key, product);

    res.status(200).json({
      valid: result.valid,
      reason: result.valid ? 'Key is valid.' : result.reason,
      product: result.valid ? result.product : undefined,
      expiresAt: result.valid ? result.expiresAt : undefined,
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ valid: false, error: 'Internal error.' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[EXPRESS SERVICE RUNNING] Listening on port ${PORT}`);
});

// Discord commands.
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether Jayce is online.'),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the Jayce panel (staff only).'),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate a license key (staff only).')
    .addUserOption(o =>
      o.setName('user').setDescription('Key owner').setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('days')
        .setDescription('Number of days')
        .setMinValue(1)
        .setMaxValue(365)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('product')
        .setDescription('Product')
        .setRequired(true)
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('validatekey')
    .setDescription('Validate a license key.')
    .addStringOption(o =>
      o.setName('key').setDescription('License key').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('product')
        .setDescription('Product')
        .addChoices(
          { name: 'Main', value: 'main' },
          { name: 'Mobile', value: 'mobile' }
        )
    ),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('Revoke a key (staff only).')
    .addStringOption(o =>
      o.setName('key').setDescription('Key to revoke').setRequired(true)
    ),
].map(command => command.toJSON());

function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xFF9ED2)
    .setTitle('˚₊· ͟͟͞͞➳❥ jayce script panel ˚ʚ♡ɞ˚')
    .setDescription(
      'Welcome to Jayce Main ♡\n\n' +
      'Register or get a key, then use the matching script button to validate it.'
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

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === 'ping') {
        return interaction.reply({
          content: 'Pong! Jayce is online.',
          ephemeral: true,
        });
      }

      if (name === 'panel') {
        if (!staffOnly(interaction)) {
          return interaction.reply({
            content: 'You do not have permission to post the panel.',
            ephemeral: true,
          });
        }

        return interaction.reply(panelPayload());
      }

      if (name === 'generatekey') {
        if (!staffOnly(interaction)) {
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
            `Your Jayce ${product} key ♡\n` +
            `\`${generated.key}\`\nExpires: ${formatDate(generated.expiresAt)}`
          );
        } catch {
          console.log(`Could not DM key to user ${user.id}.`);
        }

        return;
      }

      if (name === 'validatekey') {
        const key = interaction.options.getString('key', true);
        const product = interaction.options.getString('product');
        const result = validateKey(key, product);

        return interaction.reply({
          content: result.valid
            ? `Valid key ♡\nProduct: ${result.product}\nExpires: ${formatDate(result.expiresAt)}`
            : `Invalid key: ${result.reason}`,
          ephemeral: true,
        });
      }

      if (name === 'revokekey') {
        if (!staffOnly(interaction)) {
          return interaction.reply({
            content: 'Only authorized staff can revoke keys.',
            ephemeral: true,
          });
        }

        const revoked = revokeKey(
          interaction.options.getString('key', true)
        );

        return interaction.reply({
          content: revoked ? 'Key revoked.' : 'Key not found.',
          ephemeral: true,
        });
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'jc_register' || id === 'jc_key') {
        const generated = generateKey(interaction.user.id, 30, 'main');

        return interaction.reply({
          content:
            `Your Jayce Main key ♡\n\`${generated.key}\`\n` +
            `Expires: ${formatDate(generated.expiresAt)}\n` +
            'Keep this key private.',
          ephemeral: true,
        });
      }

      if (id === 'jc_main' || id === 'jc_mobilemain') {
        const product = id === 'jc_mobilemain' ? 'mobile' : 'main';
        const roleId = product === 'mobile' ? MOBILE_ROLE_ID : MAIN_ROLE_ID;

        if (!hasRole(interaction, roleId)) {
          return interaction.reply({
            content: 'You do not have the role required for this product.',
            ephemeral: true,
          });
        }

        return interaction.reply({
          content:
            `To validate your ${product} license, use /validatekey ` +
            'with your key. The separate loader must also call /api/validate.',
          ephemeral: true,
        });
      }

      if (id === 'jc_resethwid') {
        return interaction.reply({
          content: 'HWID reset is not configured in this version.',
          ephemeral: true,
        });
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      }).catch(console.error);
    }
  }
});

async function startBot() {
  ensureDatabase();

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  await client.login(TOKEN);
}

startBot().catch(error => {
  console.error('Failed to start Jayce:', error);
  process.exit(1);
});
                   
