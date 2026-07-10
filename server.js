// server.js – Combined Key API Server + Discord Bot
const express = require('express');
const { google } = require('googleapis');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios'); // used by bot
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ============================================================
// 1. GOOGLE SHEETS API SETUP (same as before)
// ============================================================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Keys';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'defaultSecret';

let auth;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    console.error('No Google credentials provided');
    process.exit(1);
}
const sheets = google.sheets({ version: 'v4', auth });

async function getSheetData() {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:C`,
    });
    return response.data.values || [];
}

async function appendKeyToSheet(key, usedBy = '', used = false) {
    const now = new Date().toISOString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:C`,
        valueInputOption: 'RAW',
        requestBody: {
            values: [[key, usedBy, used ? 'TRUE' : 'FALSE', now]],
        },
    });
}

async function updateKeyStatus(key, usedBy) {
    const values = await getSheetData();
    let rowIndex = -1;
    for (let i = 0; i < values.length; i++) {
        if (values[i][0] === key) {
            rowIndex = i + 1;
            break;
        }
    }
    if (rowIndex === -1) return false;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!B${rowIndex}:C${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
            values: [[usedBy, 'TRUE']],
        },
    });
    return true;
}

// ============================================================
// 2. API ENDPOINTS
// ============================================================
app.post('/validate', async (req, res) => {
    const { key, gameId, player } = req.body;
    if (!key) return res.status(400).json({ valid: false, error: 'Missing key' });
    try {
        const rows = await getSheetData();
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[0] === key) {
                const used = row[2] && row[2].toUpperCase() === 'TRUE';
                if (used) {
                    return res.json({ valid: false, reason: 'already used' });
                } else {
                    await updateKeyStatus(key, `${player || 'unknown'} (${gameId || 'unknown'})`);
                    return res.json({ valid: true });
                }
            }
        }
        res.json({ valid: false, reason: 'not found' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ valid: false, error: 'Server error' });
    }
});

app.post('/generate', async (req, res) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    const newKey = 'KEY-' + crypto.randomBytes(16).toString('hex').toUpperCase();
    await appendKeyToSheet(newKey, '', false);
    res.json({ key: newKey });
});

app.get('/list', async (req, res) => {
    const { secret } = req.query;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    const rows = await getSheetData();
    res.json({ keys: rows.slice(1) });
});

app.post('/revoke', async (req, res) => {
    const { key, secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    const success = await updateKeyStatus(key, 'REVOKED');
    if (success) res.json({ success: true });
    else res.status(404).json({ error: 'Key not found' });
});

// ============================================================
// 3. START THE EXPRESS SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Key server running on port ${PORT}`);
});

// ============================================================
// 4. START THE DISCORD BOT (merged into same process)
// ============================================================
const botClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

botClient.once('ready', () => {
    console.log(`🤖 Discord bot logged in as ${botClient.user.tag}`);
});

botClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const allowed = message.member.permissions.has('Administrator') ||
                    (message.channel.name === 'bot-commands');
    if (!allowed) return message.reply('❌ Permission denied.');

    const SERVER_URL = process.env.SERVER_URL || `https://avd-script.onrender.com`;

    if (command === 'generatekey') {
        try {
            const response = await axios.post(`${SERVER_URL}/generate`, { secret: ADMIN_SECRET });
            await message.reply(`✅ Generated key: \`${response.data.key}\``);
        } catch (err) {
            await message.reply('❌ Failed to generate key.');
        }
    }
    else if (command === 'listkeys') {
        try {
            const response = await axios.get(`${SERVER_URL}/list`, { params: { secret: ADMIN_SECRET } });
            const keys = response.data.keys;
            if (!keys || keys.length === 0) return message.reply('📭 No keys.');
            let list = keys.map((row, idx) =>
                `${idx+1}. ${row[0]} | Used: ${(row[2] || 'FALSE').toUpperCase()}`
            ).join('\n');
            if (list.length > 2000) list = list.slice(0, 1997) + '...';
            await message.reply(`📋 Keys:\n${list}`);
        } catch (err) {
            await message.reply('❌ Failed to list keys.');
        }
    }
    else if (command === 'checkkey') {
        const key = args[0];
        if (!key) return message.reply('⚠️ Usage: !checkkey <key>');
        try {
            const response = await axios.post(`${SERVER_URL}/validate`, { key });
            if (response.data.valid) {
                await message.reply(`✅ Key \`${key}\` is valid.`);
            } else {
                await message.reply(`❌ Key \`${key}\` invalid/used.`);
            }
        } catch (err) {
            await message.reply('❌ Error checking key.');
        }
    }
    else if (command === 'revokekey') {
        const key = args[0];
        if (!key) return message.reply('⚠️ Usage: !revokekey <key>');
        try {
            await axios.post(`${SERVER_URL}/revoke`, { key, secret: ADMIN_SECRET });
            await message.reply(`🔒 Key \`${key}\` revoked.`);
        } catch (err) {
            await message.reply('❌ Failed to revoke key.');
        }
    }
    else if (command === 'help') {
        await message.reply(`
**Commands:**
!generatekey
!listkeys
!checkkey <key>
!revokekey <key>
!help
        `);
    }
});

botClient.login(process.env.DISCORD_TOKEN);
