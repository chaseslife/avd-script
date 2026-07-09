// server.js
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // e.g., "1abc..."
const SHEET_NAME = process.env.SHEET_NAME || "Keys";
// Google service account credentials – set GOOGLE_APPLICATION_CREDENTIALS env var to path of JSON key file
// or store the credentials directly in env as JSON string.
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

// ============ HELPER: Read/Write to Sheets ============
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
    // Find the row and update columns B and C
    const values = await getSheetData();
    let rowIndex = -1;
    for (let i = 0; i < values.length; i++) {
        if (values[i][0] === key) {
            rowIndex = i + 1; // 1-indexed for Sheets
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

// ============ API Endpoints ============
// Validate a key
app.post('/validate', async (req, res) => {
    const { key, gameId, player } = req.body;
    if (!key) {
        return res.status(400).json({ valid: false, error: 'Missing key' });
    }
    try {
        const rows = await getSheetData();
        // Assume first row is header, so skip it
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[0] === key) {
                const used = row[2] && row[2].toUpperCase() === 'TRUE';
                if (used) {
                    return res.json({ valid: false, reason: 'already used' });
                } else {
                    // Mark as used
                    await updateKeyStatus(key, `${player} (${gameId})`);
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

// (Optional) Admin endpoint to generate a new key – used by Discord bot
app.post('/generate', async (req, res) => {
    const { secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const newKey = 'KEY-' + crypto.randomBytes(16).toString('hex').toUpperCase();
    await appendKeyToSheet(newKey, '', false);
    res.json({ key: newKey });
});

// (Optional) List all keys – for bot
app.get('/list', async (req, res) => {
    const { secret } = req.query;
    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const rows = await getSheetData();
    res.json({ keys: rows.slice(1) }); // skip header
});

app.listen(PORT, () => console.log(`Key server running on port ${PORT}`));
