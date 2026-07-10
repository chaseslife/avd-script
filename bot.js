// bot.js – Discord bot for key management (full working version)
// Requires: discord.js v14, axios
// Environment variables: DISCORD_TOKEN, ADMIN_SECRET, SERVER_URL

const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// ============================================================
// CONFIGURATION
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers  // optional, for member checks
  ]
});

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'defaultSecretChangeMe';
const SERVER_URL = process.env.SERVER_URL || 'https://your-app.onrender.com';

// ============================================================
// EVENT: READY
// ============================================================
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag} (ID: ${client.user.id})`);
  console.log(`🔗 Server URL: ${SERVER_URL}`);
});

// ============================================================
// EVENT: MESSAGE CREATE (Command handler)
// ============================================================
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only respond to commands starting with '!'
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Restrict to administrators or a specific channel
  const allowed = message.member.permissions.has('Administrator') ||
                  (message.channel.name === 'bot-commands');
  if (!allowed) {
    return message.reply('❌ You do not have permission to use this bot.');
  }

  // ---------- GENERATE KEY ----------
  if (command === 'generatekey') {
    try {
      const response = await axios.post(`${SERVER_URL}/generate`, {
        secret: ADMIN_SECRET
      });
      await message.reply(`✅ New key generated:\`${response.data.key}\``);
    } catch (err) {
      console.error(err.message);
      await message.reply('❌ Failed to generate key. Server may be down or secret incorrect.');
    }
  }

  // ---------- LIST KEYS ----------
  else if (command === 'listkeys') {
    try {
      const response = await axios.get(`${SERVER_URL}/list`, {
        params: { secret: ADMIN_SECRET }
      });
      const keys = response.data.keys;
      if (!keys || keys.length === 0) {
        return message.reply('📭 No keys found.');
      }
      let list = keys.map((row, idx) =>
        `${idx+1}. ${row[0]} | Used: ${(row[2] || 'FALSE').toUpperCase()} | ${row[1] || 'unused'}`
      ).join('\n');
      if (list.length > 2000) list = list.slice(0, 1997) + '...';
      await message.reply(`📋 Keys:\n${list}`);
    } catch (err) {
      console.error(err.message);
      await message.reply('❌ Failed to list keys.');
    }
  }

  // ---------- CHECK KEY ----------
  else if (command === 'checkkey') {
    const key = args[0];
    if (!key) return message.reply('⚠️ Usage: `!checkkey <key>`');
    try {
      const response = await axios.post(`${SERVER_URL}/validate`, { key });
      if (response.data.valid) {
        await message.reply(`✅ Key \`${key}\` is valid and unused.`);
      } else {
        await message.reply(`❌ Key \`${key}\` is invalid or already used.`);
      }
    } catch (err) {
      console.error(err.message);
      await message.reply('❌ Error checking key.');
    }
  }

  // ---------- REVOKE KEY ----------
  else if (command === 'revokekey') {
    const key = args[0];
    if (!key) return message.reply('⚠️ Usage: `!revokekey <key>`');
    try {
      await axios.post(`${SERVER_URL}/revoke`, { key, secret: ADMIN_SECRET });
      await message.reply(`🔒 Key \`${key}\` revoked.`);
    } catch (err) {
      console.error(err.message);
      await message.reply('❌ Failed to revoke key.');
    }
  }

  // ---------- HELP ----------
  else if (command === 'help') {
    await message.reply(`
**Available commands:**
\`!generatekey\` – Create a new license key
\`!listkeys\` – Show all keys and their status
\`!checkkey <key>\` – Verify if a key is valid
\`!revokekey <key>\` – Mark a key as revoked/used
\`!help\` – Show this message
    `);
  }
});

// ============================================================
// LOGIN – THIS IS THE CRITICAL LINE
// ============================================================
client.login(process.env.DISCORD_TOKEN);
// If you want to hardcode for testing (not recommended), replace with:
// client.login('YOUR_TOKEN_HERE');
