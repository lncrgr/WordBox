import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;
const SECRET_KEY = 'word-runner-secret'; // In a real app, use .env

app.use(cors());
app.use(express.json());
// Routes will be moved before this in previous step

// --- Database Setup ---
let db;
(async () => {
    db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            points INTEGER DEFAULT 0,
            active_theme TEXT DEFAULT 'BRUTALIST'
        );
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            score INTEGER,
            difficulty TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS purchased_themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            theme_id TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, theme_id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    `);

    // Migration for existing tables
    try { await db.exec('ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0'); } catch (e) { }
    try { await db.exec('ALTER TABLE users ADD COLUMN active_theme TEXT DEFAULT "BRUTALIST"'); } catch (e) { }
})();

// --- Shop Definitions ---
const THEMES = [
    { id: 'BRUTALIST', name: 'BRUTALIST_ORIGIN', price: 0, description: 'STARK. INK_ON_PAPER.' },
    { id: 'NEON', name: 'NEON_OVERDRIVE', price: 500, description: 'CYBERPUNK_GLOW. VIBRANT_ENERGY.' },
    { id: 'GALAXY', name: 'COSMIC_VOID', price: 1000, description: 'DEEP_SPACE. STARLIGHT_ACCENTS.' },
    { id: 'VOLCANO', name: 'MAGMA_FLOW', price: 1500, description: 'HIGH_TEMPERATURE. OBSIDIAN_BASE.' },
    { id: 'VEGETAL', name: 'APOCALYPTIC_GROWTH', price: 2000, description: 'NATURE_RECLAIMED. OVERGROWN_SYSTEM.' }
];

// --- Auth Routes ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        // Auto-unlock default theme
        await db.run('INSERT INTO purchased_themes (user_id, theme_id) VALUES (?, ?)', [result.lastID, 'BRUTALIST']);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'USERNAME_ALREADY_EXISTS' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (user && await bcrypt.compare(password, user.password)) {
        const ownedThemes = (await db.all('SELECT theme_id FROM purchased_themes WHERE user_id = ?', [user.id])).map(t => t.theme_id);
        const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY);
        res.json({
            success: true,
            token,
            username: user.username,
            points: user.points,
            activeTheme: user.active_theme,
            ownedThemes
        });
    } else {
        res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }
});

// --- Score Routes ---
app.post('/api/scores', async (req, res) => {
    const { score, difficulty } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader) return res.status(401).json({ error: 'UNAUTHORIZED' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        await db.run('INSERT INTO scores (user_id, score, difficulty) VALUES (?, ?, ?)',
            [decoded.id, score, difficulty]);

        // Award points: 1 point per 10 score
        const pointsAwarded = Math.floor(score / 10);
        await db.run('UPDATE users SET points = points + ? WHERE id = ?', [pointsAwarded, decoded.id]);

        res.json({ success: true, pointsAwarded });
    } catch (e) {
        res.status(401).json({ error: 'INVALID_TOKEN' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    console.log('GET /api/leaderboard');
    // Return only the BEST score per user per difficulty
    const scores = await db.all(`
        SELECT users.id as user_id, users.username, MAX(scores.score) as score, scores.difficulty 
        FROM scores 
        JOIN users ON scores.user_id = users.id 
        GROUP BY scores.user_id, scores.difficulty
        ORDER BY score DESC 
    `);

    const leaderboard = { EASY: [], MEDIUM: [], HARD: [] };
    scores.forEach(s => {
        if (leaderboard[s.difficulty].length < 10) {
            leaderboard[s.difficulty].push(s);
        }
    });

    res.json(leaderboard);
});

// --- Shop Routes ---
app.get('/api/shop', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'UNAUTHORIZED' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        const owned = (await db.all('SELECT theme_id FROM purchased_themes WHERE user_id = ?', [decoded.id])).map(t => t.theme_id);

        const shopItems = THEMES.map(t => ({
            ...t,
            isOwned: owned.includes(t.id)
        }));

        res.json({ items: shopItems });
    } catch (e) {
        res.status(401).json({ error: 'INVALID_TOKEN' });
    }
});

app.post('/api/shop/buy', async (req, res) => {
    const { themeId } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'UNAUTHORIZED' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        const theme = THEMES.find(t => t.id === themeId);
        if (!theme) return res.status(404).json({ error: 'THEME_NOT_FOUND' });

        const user = await db.get('SELECT points FROM users WHERE id = ?', [decoded.id]);
        const owned = await db.get('SELECT 1 FROM purchased_themes WHERE user_id = ? AND theme_id = ?', [decoded.id, themeId]);

        if (owned) return res.status(400).json({ error: 'ALREADY_OWNED' });
        if (user.points < theme.price) return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });

        await db.run('UPDATE users SET points = points - ? WHERE id = ?', [theme.price, decoded.id]);
        await db.run('INSERT INTO purchased_themes (user_id, theme_id) VALUES (?, ?)', [decoded.id, themeId]);

        res.json({ success: true, newPoints: user.points - theme.price });
    } catch (e) {
        res.status(401).json({ error: 'INVALID_TOKEN' });
    }
});

app.post('/api/me/active-theme', async (req, res) => {
    const { themeId } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'UNAUTHORIZED' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        const owned = await db.get('SELECT 1 FROM purchased_themes WHERE user_id = ? AND theme_id = ?', [decoded.id, themeId]);

        if (!owned) return res.status(403).json({ error: 'THEME_NOT_OWNED' });

        await db.run('UPDATE users SET active_theme = ? WHERE id = ?', [themeId, decoded.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(401).json({ error: 'INVALID_TOKEN' });
    }
});

app.get('/api/stats/raw', async (req, res) => {
    console.log('GET /api/stats/raw');
    try {
        const scores = await db.all(`
            SELECT score, difficulty, date 
            FROM scores 
            ORDER BY date ASC
        `);
        console.log(`Found ${scores.length} scores`);
        res.json(scores);
    } catch (e) {
        console.error('Error in /api/stats/raw:', e);
        res.status(500).json({ error: 'FAILED_TO_FETCH_RAW_DATA' });
    }
});

app.use(express.static(__dirname));

app.get('/api/me/scores', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'UNAUTHORIZED' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], SECRET_KEY);
        const user = await db.get('SELECT points, active_theme FROM users WHERE id = ?', [decoded.id]);
        const ownedThemes = (await db.all('SELECT theme_id FROM purchased_themes WHERE user_id = ?', [decoded.id])).map(t => t.theme_id);

        const myScores = await db.all(`
            SELECT score, difficulty, date 
            FROM scores 
            WHERE user_id = ? 
            ORDER BY score DESC 
        `, [decoded.id]);

        const top10 = { EASY: [], MEDIUM: [], HARD: [] };
        myScores.forEach(s => {
            if (top10[s.difficulty].length < 10) {
                top10[s.difficulty].push(s);
            }
        });

        res.json({ top10, points: user.points, activeTheme: user.active_theme, ownedThemes });
    } catch (e) {
        res.status(401).json({ error: 'INVALID_TOKEN' });
    }
});


import os from 'os';

function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

app.listen(PORT, () => {
    const ip = getNetworkIP();
    console.log(`
    ================================================
    WORD_RUNNER SERVER IS ACTIVE
    ================================================
    LOCAL:   http://localhost:${PORT}
    NETWORK: http://${ip}:${PORT}
    
    Share the NETWORK URL with your friends on the same branch!
    ================================================
    `);
});
