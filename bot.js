// bot.js
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const SERVER_URL = process.env.SERVER_URL || 'https://your-app.onrender.com';

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Only allow in specific channel or admin roles
    const allowed = message.member.permissions.has('Administrator') || message.channel.name === 'bot-commands';
    if (!allowed) return message.reply('You are not allowed to use this bot.');

    if (command === 'generatekey') {
        try {
            const response = await axios.post(`${SERVER_URL}/generate`, { secret: ADMIN_SECRET });
            const key = response.data.key;
            await message.reply(`Generated key: \`${key}\``);
        } catch (err) {
            await message.reply('Failed to generate key.');
            console.error(err);
        }
    }
    else if (command === 'listkeys') {
        try {
            const response = await axios.get(`${SERVER_URL}/list`, { params: { secret: ADMIN_SECRET } });
            const keys = response.data.keys;
            if (keys.length === 0) return message.reply('No keys found.');
            let list = keys.map((row, idx) => `${idx+1}. ${row[0]} | Used: ${row[2] || 'FALSE'} | ${row[1] || 'unused'}`).join('\n');
            // Discord message limit: split if needed
            if (list.length > 2000) list = list.slice(0, 1997) + '...';
            await message.reply(`Keys:\n${list}`);
        } catch (err) {
            await message.reply('Failed to list keys.');
            console.error(err);
        }
    }
    else if (command === 'checkkey') {
        const key = args[0];
        if (!key) return message.reply('Usage: !checkkey <key>');
        try {
            const response = await axios.post(`${SERVER_URL}/validate`, { key: key });
            if (response.data.valid) {
                await message.reply(`Key \`${key}\` is valid and unused.`);
            } else {
                await message.reply(`Key \`${key}\` is invalid or already used.`);
            }
        } catch (err) {
            await message.reply('Error checking key.');
        }
    }
    else if (command === 'revokekey') {
        // Implement revocation: mark as used or delete? For simplicity, update sheet to used with "REVOKED"
        // You need a separate endpoint or directly update sheet. We'll add a quick implementation.
        const key = args[0];
        if (!key) return message.reply('Usage: !revokekey <key>');
        // We'll use the update endpoint (you'd need to add a /revoke endpoint)
        // For brevity, we'll call a new endpoint.
        try {
            const response = await axios.post(`${SERVER_URL}/revoke`, { key: key, secret: ADMIN_SECRET });
            await message.reply(`Key \`${key}\` revoked.`);
        } catch (err) {
            await message.reply('Failed to revoke key.');
        }
    }
});

client.login(DISCORD_TOKEN);
