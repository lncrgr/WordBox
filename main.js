/**
 * WORD_RUNNER // FULL_STACK_SPEC // FILTERED
 */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const cmdInput = document.getElementById('cmd-input');
const terminalOutput = document.getElementById('terminal-output');
const scoreEl = document.getElementById('score-val');
const healthEl = document.getElementById('health-val');
const lobbyScreen = document.getElementById('lobby-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const restartBtn = document.getElementById('restart-btn');
const finalScoreEl = document.getElementById('final-score');

// Auth elements
const authModal = document.getElementById('auth-modal');
const authBtn = document.getElementById('auth-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');
const profileBtn = document.getElementById('profile-btn');
const profileScreen = document.getElementById('profile-screen');
const saveScorePrompt = document.getElementById('save-score-prompt');
const statsModal = document.getElementById('stats-modal');
const statsOpenBtn = document.getElementById('stats-open-btn');
const statsTypeBtns = document.querySelectorAll('.stats-type-btn');
const shopModal = document.getElementById('shop-modal');
const shopOpenBtn = document.getElementById('shop-open-btn');

const API_BASE = `${window.location.origin}/api`;
const PLAYER_X = 120;
const INITIAL_SPAWN_INTERVAL = 2500;
const MIN_SPAWN_INTERVAL = 800;
const MAX_SPEED_THRESHOLD = 5.0;

let wordsDict = { EASY: [], MEDIUM: [], HARD: [] };
let state = {
    status: 'LOBBY',
    difficulty: 'EASY',
    score: 0,
    health: 100,
    enemies: [],
    powerups: [],
    lastSpawn: 0,
    lastPowerupSpawn: 0,
    speedMultiplier: 1,
    baseSpeedMultiplier: 1,
    spawnInterval: INITIAL_SPAWN_INTERVAL,
    user: null,
    token: localStorage.getItem('wr_token'),
    globalTab: 'EASY',
    personalTab: 'EASY',
    slowMode: false,
    slowTimeout: null,
    combo: 0,
    maxCombo: 0,
    effects: [],
    statsChart: null,
    points: 0,
    activeTheme: 'BRUTALIST',
    ownedThemes: [],
    wordsTyped: [], // To track for server-side verification
    canvasPrimary: '#1a1a1a',
    canvasBg: '#fff',
    bgParticles: []
};

// --- Initialization ---
async function init() {
    await loadWords();
    await checkAuth();
    setupEventListeners();
    resize();
    renderLeaderboard();
    document.body.classList.add('overlay-active'); // Game starts in lobby
    requestAnimationFrame(gameLoop);
}

// --- API Helpers ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `HTTP_ERROR: ${response.status}`);
            return data;
        } else {
            const text = await response.text();
            throw new Error(`NON_JSON_RESPONSE: ${response.status} - ${text.substring(0, 50)}`);
        }
    } catch (e) {
        console.error(`API_CALL_FAILED: ${endpoint}`, e);
        throw e;
    }
}

function showNotification(msg, duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.textContent = `SYS_MSG: ${msg}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function updateAuthUI() {
    if (state.user) {
        userGreeting.textContent = `SESS_ACTIVE: ${state.user.username}`;
        document.getElementById('points-display').classList.remove('hidden');
        document.getElementById('user-points').textContent = state.points;
        document.getElementById('shop-open-btn').classList.remove('hidden');
        authBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        profileBtn.classList.remove('hidden');
        applyTheme(state.activeTheme);
    } else {
        userGreeting.textContent = `GUEST_MODE`;
        document.getElementById('points-display').classList.add('hidden');
        document.getElementById('shop-open-btn').classList.add('hidden');
        authBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
        profileBtn.classList.add('hidden');
        applyTheme('BRUTALIST');
    }
}

async function checkAuth() {
    const token = localStorage.getItem('wr_token');
    if (token) {
        try {
            const res = await apiCall('/me/scores'); // Re-use this to get updated profile info
            state.user = { username: localStorage.getItem('wr_username') };
            state.points = res.points;
            state.activeTheme = res.activeTheme;
            state.ownedThemes = res.ownedThemes;
            updateAuthUI();
        } catch (e) {
            localStorage.removeItem('wr_token');
            state.token = null;
        }
    }
}

async function renderLeaderboard() {
    const leaderboardData = document.getElementById('leaderboard-data');
    try {
        const scores = await apiCall('/leaderboard');
        const activeDiff = state.globalTab;
        const diffScores = scores[activeDiff] || [];

        let html = '<table class="leaderboard-table"><tr><th>RANK</th><th>USER</th><th>SCORE</th></tr>';

        if (diffScores.length > 0) {
            diffScores.forEach((s, index) => {
                html += `<tr>
                    <td>#${(index + 1).toString().padStart(2, '0')}</td>
                    <td>${s.username}</td>
                    <td>${s.score.toString().padStart(4, '0')}</td>
                </tr>`;
            });
            html += '</table>';
        } else {
            html = '<p>NO_DATA_FOR_THIS_SECTOR</p>';
        }

        leaderboardData.innerHTML = html;
    } catch (e) {
        leaderboardData.innerHTML = '<p>CONNECTION_ERROR</p>';
    }
}

async function renderStats(chartType = 'line') {
    const canvas = document.getElementById('stats-canvas');
    if (!canvas) return;

    try {
        const data = await apiCall('/stats/raw');
        if (state.statsChart) {
            state.statsChart.destroy();
        }

        const ctx = canvas.getContext('2d');
        const config = getChartConfig(chartType, data);
        state.statsChart = new Chart(ctx, config);
    } catch (e) {
        console.error('Failed to render stats', e);
    }
}

function getChartConfig(type, data) {
    const colors = {
        EASY: '#1a1a1a',
        MEDIUM: '#555',
        HARD: '#d00'
    };

    if (type === 'line') {
        const datasets = ['EASY', 'MEDIUM', 'HARD'].map(diff => ({
            label: `${diff}_PROGRESS`,
            data: data.filter(d => d.difficulty === diff).map((d, i) => ({ x: i, y: d.score })),
            borderColor: colors[diff],
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.1
        }));

        return {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { type: 'linear', title: { display: true, text: 'GAMES_PLAYED' } },
                    y: { title: { display: true, text: 'SCORE' } }
                }
            }
        };
    } else if (type === 'bar') {
        // Histogram of scores (frequency)
        const bins = [0, 1000, 2000, 5000, 10000, 20000, 50000];
        const binLabels = bins.map((b, i) => i === bins.length - 1 ? `${b}+` : `${b}-${bins[i + 1]}`);

        const datasets = ['EASY', 'MEDIUM', 'HARD'].map(diff => {
            const scores = data.filter(d => d.difficulty === diff).map(d => d.score);
            const frequencies = bins.map((b, i) => {
                const next = bins[i + 1] || Infinity;
                return scores.filter(s => s >= b && s < next).length;
            });
            return {
                label: diff,
                data: frequencies,
                backgroundColor: colors[diff]
            };
        });

        return {
            type: 'bar',
            data: { labels: binLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'FREQUENCY' } }
                }
            }
        };
    } else if (type === 'scatter') {
        const datasets = ['EASY', 'MEDIUM', 'HARD'].map(diff => ({
            label: diff,
            data: data.filter(d => d.difficulty === diff).map(d => ({
                x: new Date(d.date).getTime(),
                y: d.score
            })),
            backgroundColor: colors[diff]
        }));

        return {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'TIME' },
                        ticks: {
                            callback: (value) => new Date(value).toLocaleDateString()
                        }
                    },
                    y: { title: { display: true, text: 'SCORE' } }
                }
            }
        };
    }
}

async function renderProfile() {
    const myRankings = document.getElementById('my-rankings');
    document.getElementById('profile-username').textContent = state.user.username;
    try {
        const res = await apiCall('/me/scores');
        state.points = res.points;
        state.activeTheme = res.activeTheme;
        state.ownedThemes = res.ownedThemes;
        updateAuthUI();

        const activeDiff = state.personalTab;
        const diffScores = res.top10[activeDiff] || [];

        let html = '<table class="leaderboard-table"><tr><th>RANK</th><th>SCORE</th><th>DATE</th></tr>';

        if (diffScores.length > 0) {
            diffScores.forEach((s, index) => {
                const date = new Date(s.date).toLocaleDateString();
                html += `<tr>
                    <td>#${(index + 1).toString().padStart(2, '0')}</td>
                    <td>${s.score.toString().padStart(4, '0')}</td>
                    <td>${date}</td>
                </tr>`;
            });
            html += '</table>';
        } else {
            html = '<p>NO_DATA_RECORDED_YET</p>';
        }

        myRankings.innerHTML = html;
    } catch (e) {
        myRankings.innerHTML = '<p>PROFILE_FETCH_ERROR</p>';
    }
}

async function renderShop() {
    const container = document.getElementById('shop-items-container');
    const balanceEl = document.getElementById('shop-points-val');
    balanceEl.textContent = state.points;

    const themePalettes = {
        BRUTALIST: ['#f0f0f0', '#1a1a1a', '#d00'],
        NEON: ['#050008', '#00ffff', '#ff00ff'],
        GALAXY: ['#000208', '#b794f4', '#9d4edd'],
        VOLCANO: ['#100000', '#ff6600', '#ffcc00'],
        VEGETAL: ['#020502', '#4caf50', '#2e7d32']
    };

    try {
        const res = await apiCall('/shop');
        if (res.error) {
            container.innerHTML = `<p class="system-msg">ERROR: ${res.error}</p>`;
            return;
        }

        let html = '';
        if (res.items && Array.isArray(res.items)) {
            res.items.forEach(item => {
                const isActive = state.activeTheme === item.id;
                const isOwned = item.isOwned;
                const colors = themePalettes[item.id] || ['#fff', '#000', '#888'];

                html += `
                    <div class="shop-item ${isOwned ? 'owned' : ''} ${isActive ? 'active-theme' : ''}">
                        <div class="theme-preview">
                            <div class="preview-bar" style="background: ${colors[0]}"></div>
                            <div class="preview-bar" style="background: ${colors[1]}"></div>
                            <div class="preview-bar" style="background: ${colors[2]}"></div>
                        </div>
                        <h3>${item.name}</h3>
                        <p class="description">${item.description}</p>
                        <p class="price">${isOwned ? 'OWNED' : item.price + ' PT'}</p>
                        <button class="buy-btn" data-id="${item.id}" ${isActive ? 'disabled' : ''}>
                            ${isOwned ? (isActive ? 'ACTIVE' : 'ACTIVATE') : 'BUY_ITEM'}
                        </button>
                    </div>
                `;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = '<p>SHOP_DATA_MALFORMED</p>';
        }

        container.querySelectorAll('.buy-btn').forEach(btn => {
            btn.onclick = async () => {
                const themeId = btn.dataset.id;
                const item = res.items.find(t => t.id === themeId);

                if (item.isOwned) {
                    await setActiveTheme(themeId);
                } else {
                    if (confirm(`CONFIRM_PURCHASE: ${item.name} FOR ${item.price} PT?`)) {
                        try {
                            const buyRes = await apiCall('/shop/buy', 'POST', { themeId });
                            if (buyRes.success) {
                                state.points = buyRes.newPoints;
                                showNotification(`PURCHASE_SUCCESS: ${item.name}`);
                                renderShop();
                                updateAuthUI();
                            }
                        } catch (err) {
                            showNotification(`PURCHASE_FAILED: ${err.message}`);
                        }
                    }
                }
            };
        });
    } catch (e) {
        container.innerHTML = `<p class="system-msg">ERR: ${e.message}</p>`;
    }
}

async function setActiveTheme(themeId) {
    const res = await apiCall('/me/active-theme', 'POST', { themeId });
    if (res.success) {
        state.activeTheme = themeId;
        applyTheme(themeId);
        renderShop();
        showNotification(`THEME_ACTIVATED: ${themeId}`);
    }
}

function applyTheme(themeId) {
    // Remove all theme classes from body
    document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
    document.body.classList.add(`theme-${themeId}`);

    // Some game elements might need canvas color updates if they weren't using CSS vars
    // But since it's brutalist, we mostly use CSS vars or hardcoded #1a1a1a
    // I will update the state to reflect the primary color for canvas use if needed
    const style = getComputedStyle(document.body);
    state.canvasPrimary = style.getPropertyValue('--primary-color').trim();
    state.canvasBg = style.getPropertyValue('--canvas-bg').trim();
}

// --- Event Handlers ---
function setupEventListeners() {
    // Stats Modal
    statsOpenBtn.onclick = () => {
        statsModal.classList.remove('hidden');
        document.body.classList.add('overlay-active');
        renderStats('line');
    };

    statsTypeBtns.forEach(btn => {
        btn.onclick = () => {
            statsTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderStats(btn.dataset.type);
        };
    });

    shopOpenBtn.onclick = () => {
        shopModal.classList.remove('hidden');
        document.body.classList.add('overlay-active');
        renderShop();
    };

    window.addEventListener('resize', resize);
    cmdInput.addEventListener('keydown', handleInput);
    restartBtn.addEventListener('click', () => {
        gameOverScreen.classList.add('hidden');
        lobbyScreen.classList.remove('hidden');
        document.body.classList.add('overlay-active');
        renderLeaderboard();
    });

    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => startGame(btn.dataset.diff));
    });

    // Leaderboard Tabs
    document.querySelectorAll('#global-tabs .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#global-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.globalTab = btn.dataset.tabDiff;
            renderLeaderboard();
        };
    });

    document.querySelectorAll('#personal-tabs .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#personal-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.personalTab = btn.dataset.tabDiff;
            renderProfile();
        };
    });

    // Auth Event Listeners
    authBtn.addEventListener('click', () => {
        authModal.classList.remove('hidden');
        document.body.classList.add('overlay-active');
    });
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => {
            authModal.classList.add('hidden');
            profileScreen.classList.add('hidden');
            statsModal.classList.add('hidden');
            shopModal.classList.add('hidden');
            // Only remove overlay-active if we're not also in lobby or game over
            const isLobbyHidden = lobbyScreen.classList.contains('hidden');
            const isGameOverHidden = gameOverScreen.classList.contains('hidden');
            const isStatsHidden = statsModal.classList.contains('hidden');
            const isShopHidden = shopModal.classList.contains('hidden');

            if (isLobbyHidden && isGameOverHidden && isStatsHidden && isShopHidden) {
                document.body.classList.remove('overlay-active');
            }
        };
    });

    document.getElementById('toggle-to-register').onclick = (e) => {
        e.preventDefault();
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        document.getElementById('auth-title').textContent = 'NEW_IDENTIFICATION';
    };

    document.getElementById('toggle-to-login').onclick = (e) => {
        e.preventDefault();
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        document.getElementById('auth-title').textContent = 'ACCESS_REQUISITION';
    };

    document.getElementById('do-register-btn').onclick = async () => {
        const u = document.getElementById('register-username').value;
        const p = document.getElementById('register-password').value;
        if (!u || !p) return showNotification('INPUT_REQUIRED: USERNAME_AND_PASSWORD');

        const res = await apiCall('/register', 'POST', { username: u, password: p });
        if (res.success) {
            showNotification('IDENTITY_GENERATED. PROCEED_TO_LOGIN.');
            document.getElementById('toggle-to-login').click();
        } else {
            showNotification('ERROR: ' + res.error);
        }
    };

    document.getElementById('do-login-btn').onclick = async () => {
        const u = document.getElementById('login-username').value;
        const p = document.getElementById('login-password').value;
        if (!u || !p) return showNotification('INPUT_REQUIRED: USERNAME_AND_PASSWORD');

        const res = await apiCall('/login', 'POST', { username: u, password: p });
        if (res.success) {
            state.token = res.token;
            state.user = { username: res.username };
            localStorage.setItem('wr_token', res.token);
            localStorage.setItem('wr_username', res.username);
            updateAuthUI();
            authModal.classList.add('hidden');
            showNotification(`WELCOME_BACK: ${res.username}`);
            // Check if we should remove overlay-active
            if (lobbyScreen.classList.contains('hidden') && gameOverScreen.classList.contains('hidden')) {
                document.body.classList.remove('overlay-active');
            }
            renderLeaderboard();
        } else {
            showNotification('ERROR: ' + res.error);
        }
    };

    logoutBtn.onclick = () => {
        state.token = null;
        state.user = null;
        localStorage.removeItem('wr_token');
        localStorage.removeItem('wr_username');
        updateAuthUI();
        renderLeaderboard();
    };

    profileBtn.onclick = () => {
        profileScreen.classList.remove('hidden');
        document.body.classList.add('overlay-active');
        renderProfile();
    };

    document.getElementById('prompt-register-btn').onclick = () => {
        gameOverScreen.classList.add('hidden');
        authModal.classList.remove('hidden');
        document.body.classList.add('overlay-active');
        document.getElementById('toggle-to-register').click();
    };
}

async function loadWords() {
    try {
        const response = await fetch('liste_sans_accents.txt');
        const text = await response.text();
        const allWords = text.split('\n').map(w => w.trim().toUpperCase()).filter(w => w.length > 2);
        wordsDict.EASY = allWords.filter(w => w.length <= 5);
        wordsDict.MEDIUM = allWords.filter(w => w.length > 5 && w.length <= 8);
        wordsDict.HARD = allWords.filter(w => w.length > 8);
        logToTerminal('WORD_LIST_LOADED: ' + allWords.length + ' ENTRIES.');
    } catch (e) {
        logToTerminal('CRITICAL_ERROR: WORD_LIST_UNSPECIFIED.');
    }
}

function resize() {
    const viewport = document.getElementById('game-viewport');
    if (viewport) {
        canvas.width = viewport.clientWidth;
        canvas.height = viewport.clientHeight;
    }
}

// --- Game Logic ---
function startGame(difficulty) {
    state.status = 'PLAYING';
    state.difficulty = difficulty;
    state.score = 0;
    state.health = 100;
    state.enemies = [];
    state.effects = [];
    state.combo = 0;
    updateComboUI();
    state.wordsTyped = [];
    state.lastSpawn = 0;
    state.lastPowerupSpawn = 0;
    state.slowMode = false;
    if (state.slowTimeout) clearTimeout(state.slowTimeout);
    document.getElementById('vignette-layer').classList.remove('active');

    // Balance Adjustment
    if (difficulty === 'MEDIUM') {
        state.speedMultiplier = 1.15;
    } else if (difficulty === 'HARD') {
        state.speedMultiplier = 1.35; // Previously 1.5
    } else {
        state.speedMultiplier = 1.0;
    }
    state.baseSpeedMultiplier = state.speedMultiplier;

    state.spawnInterval = INITIAL_SPAWN_INTERVAL;

    lobbyScreen.classList.add('hidden');
    document.body.classList.remove('overlay-active');
    cmdInput.disabled = false;
    cmdInput.focus();
    updateStats();
    logToTerminal(`SECTOR_INIT: ${difficulty}_MODE`);

    // Init BG particles
    state.bgParticles = [];
    let particleType = null;
    if (state.activeTheme === 'GALAXY') particleType = 'STAR';
    if (state.activeTheme === 'VOLCANO') particleType = 'EMBER';
    if (state.activeTheme === 'VEGETAL') particleType = 'LEAF';

    if (particleType) {
        for (let i = 0; i < 50; i++) state.bgParticles.push(new BackgroundParticle(particleType));
    }
}

function handleInput(e) {
    if (e.key === 'Enter') {
        const val = cmdInput.value.trim().toUpperCase();
        cmdInput.value = '';
        if (val) {
            const index = state.enemies.findIndex(e => e.word === val);
            if (index !== -1) {
                const target = state.enemies[index];
                state.enemies.splice(index, 1);

                if (target.type === 'POWERUP') {
                    activatePowerUp(target.powerType);
                    state.combo++;
                } else {
                    state.score += 100 * (1 + Math.floor(state.combo / 5));
                    state.combo++;
                    state.wordsTyped.push(val);

                    // Spawn particles
                    spawnParticles(target.x + target.width / 2, target.y, '#1a1a1a');

                    // Gentler scaling
                    let speedStep = 0.05;
                    let intervalStep = 20;

                    if (state.difficulty === 'HARD') {
                        speedStep = 0.03;
                        intervalStep = 10;
                    } else if (state.difficulty === 'EASY') {
                        speedStep = 0.015; // Much slower ramp-up for EASY
                        intervalStep = 5;
                    }

                    if (state.baseSpeedMultiplier < MAX_SPEED_THRESHOLD) {
                        state.baseSpeedMultiplier += speedStep;
                        state.speedMultiplier = state.slowMode ? state.baseSpeedMultiplier * 0.4 : state.baseSpeedMultiplier;
                        state.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, state.spawnInterval - intervalStep);
                    }
                }
                updateStats();
                updateComboUI();
                logToTerminal(`CLEARED: ${val}`);
            } else {
                state.combo = 0;
                updateComboUI();
                logToTerminal(`UNKNOWN_SIG: ${val}`);
            }
        }
    }
}

function updateComboUI() {
    const comboPanel = document.getElementById('combo-panel');
    const comboVal = document.getElementById('combo-val');
    if (state.combo > 1) {
        comboPanel.classList.remove('hidden');
        comboVal.textContent = state.combo;
        // Trigger CSS animation
        comboPanel.style.animation = 'none';
        comboPanel.offsetHeight; // trigger reflow
        comboPanel.style.animation = null;
    } else {
        comboPanel.classList.add('hidden');
    }
}

function activatePowerUp(type) {
    logToTerminal(`POWERUP_ACTIVE: ${type}`);
    if (type === 'CLEAR') {
        const enemyCount = state.enemies.filter(e => e.type === 'ENEMY').length;
        state.enemies = state.enemies.filter(e => e.type === 'POWERUP');
        state.score += enemyCount * 50;

        // Visual Shockwave
        state.effects.push(new Effect(canvas.width / 2, canvas.height / 2, 'SHOCKWAVE', '#1a1a1a'));
        showNotification('OS_CORE: DISK_CLEANUP_COMPLETE');
    } else if (type === 'SLOW') {
        if (state.slowTimeout) clearTimeout(state.slowTimeout);
        state.slowMode = true;
        document.getElementById('vignette-layer').classList.add('active');
        state.speedMultiplier = state.baseSpeedMultiplier * 0.4;
        showNotification('OS_CORE: CLOCK_CYCLES_REDUCED');

        state.slowTimeout = setTimeout(() => {
            state.slowMode = false;
            document.getElementById('vignette-layer').classList.remove('active');
            state.speedMultiplier = state.baseSpeedMultiplier;
            showNotification('OS_CORE: CLOCK_CYCLES_RESTORED');
        }, 8000);
    } else if (type === 'HEAL') {
        state.health = Math.min(100, state.health + 50);
        state.effects.push(new Effect(PLAYER_X, canvas.height / 2, 'PULSE', '#2ecc71'));
        showNotification('OS_CORE: INTEGRITY_REPAIRED');
    }
}

class Effect {
    constructor(x, y, type, color) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.color = color;
        this.life = 1.0;
        this.decay = type === 'PARTICLE' ? 0.02 + Math.random() * 0.02 : 0.03;
        this.radius = type === 'SHOCKWAVE' ? 0 : (type === 'PULSE' ? 0 : 2 + Math.random() * 3);
        this.vx = type === 'PARTICLE' ? (Math.random() - 0.5) * 10 : 0;
        this.vy = type === 'PARTICLE' ? (Math.random() - 0.5) * 10 : 0;
    }
    update() {
        this.life -= this.decay;
        if (this.type === 'PARTICLE') {
            this.x += this.vx;
            this.y += this.vy;
            this.vy += 0.2; // Gravity
        } else if (this.type === 'SHOCKWAVE') {
            this.radius += 20;
        } else if (this.type === 'PULSE') {
            this.radius += 15;
        }
    }
    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.strokeStyle = this.color;
        if (this.type === 'PARTICLE') {
            ctx.fillRect(this.x, this.y, this.radius, this.radius);
        } else if (this.type === 'SHOCKWAVE') {
            ctx.lineWidth = 10 * this.life;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
        } else if (this.type === 'PULSE') {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}

class BackgroundParticle {
    constructor(type) {
        this.type = type;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * (type === 'STAR' ? 2 : 4) + 1;
        this.speed = Math.random() * 0.5 + 0.1;
        this.angle = Math.random() * Math.PI * 2;
        this.color = '';
        if (type === 'STAR') this.color = '#fff';
        if (type === 'EMBER') this.color = `rgba(255, ${Math.random() * 100 + 50}, 0, ${Math.random() * 0.5 + 0.5})`;
        if (type === 'LEAF') this.color = `rgba(${Math.random() * 50 + 20}, ${Math.random() * 100 + 100}, 20, 0.6)`;
    }
    update() {
        if (this.type === 'STAR') {
            this.x -= this.speed;
            if (this.x < 0) this.x = canvas.width;
        } else if (this.type === 'EMBER') {
            this.x -= this.speed * 2;
            this.y -= Math.sin(this.angle) * 0.5;
            this.angle += 0.05;
            if (this.x < 0) this.x = canvas.width;
            if (this.y < 0) this.y = canvas.height;
        } else if (this.type === 'LEAF') {
            this.x -= this.speed;
            this.y += Math.cos(this.angle) * 0.5;
            this.angle += 0.02;
            if (this.x < 0) this.x = canvas.width;
            if (this.y > canvas.height) this.y = 0;
        }
    }
    draw() {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.6;
        if (this.type === 'LEAF') {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size, this.size / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}

function spawnParticles(x, y, color) {
    const pColor = color === '#1a1a1a' ? state.canvasPrimary : color;
    for (let i = 0; i < 15; i++) {
        state.effects.push(new Effect(x, y, 'PARTICLE', pColor));
    }
}

class Enemy {
    constructor(word) {
        this.word = word;
        this.x = canvas.width + 50;
        this.y = Math.random() * (canvas.height - 100) + 50;
        this.baseSpeed = 1.2 + (Math.random() * 0.4);
        ctx.font = '700 18px "Space Mono"';
        this.width = ctx.measureText(word).width + 24;
        this.height = 36;
        this.type = 'ENEMY';
    }
    update() { this.x -= this.baseSpeed * state.speedMultiplier; }
    draw() {
        ctx.fillStyle = state.canvasPrimary;
        ctx.strokeRect(this.x, this.y - this.height / 2, this.width, this.height);
        ctx.fillRect(this.x + 4, this.y - this.height / 2 + 4, this.width, this.height);
        ctx.fillStyle = state.canvasBg;
        ctx.fillRect(this.x, this.y - this.height / 2, this.width, this.height);
        ctx.fillStyle = state.canvasPrimary;
        ctx.font = '700 18px "Space Mono"';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.word, this.x + 12, this.y);
    }
}

class PowerUp extends Enemy {
    constructor(type) {
        super(`_${type}`);
        this.powerType = type;
        this.type = 'POWERUP';
        this.baseSpeed = 1.5;
    }
    draw() {
        let bgColor = state.canvasPrimary; // CLEAR
        let textColor = state.canvasBg;
        if (this.powerType === 'SLOW') bgColor = '#add8e6'; // Light Blue
        if (this.powerType === 'HEAL') bgColor = '#2ecc71'; // Green
        if (this.powerType === 'SLOW' || this.powerType === 'HEAL') textColor = '#1a1a1a';

        ctx.fillStyle = state.canvasPrimary;
        ctx.strokeRect(this.x, this.y - this.height / 2, this.width, this.height);
        ctx.fillRect(this.x + 4, this.y - this.height / 2 + 4, this.width, this.height);

        ctx.fillStyle = bgColor;
        ctx.fillRect(this.x, this.y - this.height / 2, this.width, this.height);

        ctx.fillStyle = textColor;
        ctx.font = '900 18px "Space Mono"';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.word, this.x + 12, this.y);
    }
}

function spawnEnemy(timestamp) {
    // Regular enemy spawn
    if (timestamp - state.lastSpawn > state.spawnInterval) {
        const pool = wordsDict[state.difficulty];
        if (pool && pool.length > 0) {
            const word = pool[Math.floor(Math.random() * pool.length)];
            state.enemies.push(new Enemy(word));
            state.lastSpawn = timestamp;
        }
    }

    // Power-up spawn (every ~15-20 seconds)
    if (timestamp - state.lastPowerupSpawn > 15000 + Math.random() * 5000) {
        let types = ['CLEAR', 'SLOW'];
        if (state.health < 100) types.push('HEAL'); // Only HEAL if damaged

        const type = types[Math.floor(Math.random() * types.length)];
        state.enemies.push(new PowerUp(type));
        state.lastPowerupSpawn = timestamp;
    }
}

function drawPlayer() {
    ctx.strokeStyle = state.canvasPrimary;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(PLAYER_X, 0); ctx.lineTo(PLAYER_X, canvas.height);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.height; i += 20) {
        ctx.beginPath(); ctx.moveTo(PLAYER_X - 10, i); ctx.lineTo(PLAYER_X + 10, i + 10); ctx.stroke();
    }
}

function updateStats() {
    if (scoreEl) scoreEl.textContent = state.score.toString().padStart(4, '0');
    if (healthEl) healthEl.textContent = `${Math.ceil(state.health)}%`;
    if (state.health <= 0) endGame();
}

function logToTerminal(msg) {
    const p = document.createElement('p');
    p.textContent = `> ${msg}`;
    terminalOutput.appendChild(p);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function gameLoop(timestamp) {
    if (state.status === 'PLAYING') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw BG particles
        state.bgParticles.forEach(p => { p.update(); p.draw(); });

        drawPlayer();
        spawnEnemy(timestamp);
        for (let i = state.enemies.length - 1; i >= 0; i--) {
            const enemy = state.enemies[i];
            enemy.update(); enemy.draw();
            if (enemy.x <= PLAYER_X) {
                state.health -= 25;
                state.enemies.splice(i, 1);
                updateStats();
                logToTerminal(`!! INTEGRITY_FRACTURE_DET !!`);
                ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                state.combo = 0;
                updateComboUI();
            }
        }

        // Draw and update effects
        for (let i = state.effects.length - 1; i >= 0; i--) {
            const effect = state.effects[i];
            effect.update();
            effect.draw();
            if (effect.life <= 0) state.effects.splice(i, 1);
        }
    }
    requestAnimationFrame(gameLoop);
}

async function endGame() {
    state.status = 'GAME_OVER';
    gameOverScreen.classList.remove('hidden');
    document.body.classList.add('overlay-active');
    cmdInput.disabled = true;
    finalScoreEl.textContent = state.score.toString().padStart(4, '0');

    if (state.user) {
        saveScorePrompt.classList.add('hidden');
        const res = await apiCall('/scores', 'POST', {
            score: state.score,
            difficulty: state.difficulty,
            wordsTyped: state.wordsTyped
        });
        if (res.pointsAwarded) {
            state.points += res.pointsAwarded;
            logToTerminal(`RANKING_SAVED. POINTS_EARNED: +${res.pointsAwarded}`);
            updateAuthUI();
        } else {
            logToTerminal('RANKING_SAVED_TO_DATABANK.');
        }
    } else {
        saveScorePrompt.classList.remove('hidden');
        logToTerminal('PROMPT: ACCOUNT_LOGIN_REQUIRED_FOR_PERSISTENCE.');
    }
    logToTerminal('FATAL_EXCEPTION: ABORTING_OPERATION.');
}

init();
