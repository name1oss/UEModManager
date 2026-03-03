const { app, BrowserWindow, ipcMain, dialog, protocol, shell, net } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');
const { exec } = require('child_process');
// 引入 adm-zip 用于处理 ZIP 压缩包
let AdmZip;
try {
    AdmZip = require('adm-zip');
} catch (e) {
    console.warn('Warning: adm-zip is not installed. Download processing will fail for zip files.');
}
// 引入 node-7z 用于处理多种压缩格式 (7z, TAR, etc.)
let Seven, sevenBin;
try {
    Seven = require('node-7z');
    sevenBin = require('7zip-bin');
} catch (e) {
    console.warn('Warning: node-7z or 7zip-bin is not installed. Multi-format archive support will be limited.');
}
// 引入 node-unrar-js 用于处理 RAR 文件（包括 RAR5 格式）
let unrar;
try {
    unrar = require('node-unrar-js');
} catch (e) {
    console.warn('Warning: node-unrar-js is not installed. RAR support will be limited.');
}

// --- 这里是修复的核心：忽略 SSL 证书错误 ---
// 许多用户反馈 Nexus Mods 连接出现 SSL 握手失败 (-100)
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true'); // 可选，针对可能的本地代理

// 修复 GPU 磁盘缓存错误 (Gpu Cache Creation failed/Unable to create cache)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// 全局捕获证书错误，允许继续访问
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // 允许所有非安全证书 (针对 Nexus Mods 代理/VPN 问题)
    event.preventDefault();
    callback(true);
});

// --- 配置路径 ---
// 在开发环境和生产环境(打包后)动态确定数据目录
const IS_DEV = !app.isPackaged;
const BASE_DIR = IS_DEV ? path.resolve(__dirname, '../../') : path.dirname(app.getPath('exe'));
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'mod_manager.db');
const DEFAULT_BG_DIR = path.join(DATA_DIR, 'background_images'); // Updated to use DATA_DIR
const CLOTHING_IMAGES_DIR = path.join(DATA_DIR, 'clothing');
const GAME_COVER_DIR = path.join(DATA_DIR, 'game_cover'); // New: Game Covers Directory
const TEMP_DOWNLOADS_DIR = path.join(DATA_DIR, 'temp_downloads');
const PRESETS_DIR = path.join(DATA_DIR, 'preset'); // Folder named 'preset' as requested

// 确保基础目录存在
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(DEFAULT_BG_DIR);
fs.ensureDirSync(CLOTHING_IMAGES_DIR);
fs.ensureDirSync(GAME_COVER_DIR); // Ensure game cover dir exists
fs.ensureDirSync(TEMP_DOWNLOADS_DIR);
fs.ensureDirSync(PRESETS_DIR);

let db;
let mainWindow;
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let activeGameId = 'StellarBlade'; // Default Global State

// --- New IPC Handler for Game Covers ---
ipcMain.handle('save-game-cover', async (event, { gameName, sourcePath }) => {
    try {
        if (!sourcePath || !gameName) throw new Error('Invalid arguments');
        const ext = path.extname(sourcePath);
        // Sanitize game name for filename
        const safeName = gameName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').trim();
        const destName = `${safeName}${ext}`;
        const destPath = path.join(GAME_COVER_DIR, destName);

        await fs.copy(sourcePath, destPath, { overwrite: true });
        // Return relative path for frontend use (or full path if needed, but relative usually safer for portability if base matches)
        // Here we return the full path since frontend might need to load it directly via protocol or file://
        return { success: true, path: destPath, filename: destName };
    } catch (err) {
        console.error('Failed to save game cover:', err);
        return { success: false, message: err.message };
    }
});

try {
    if (fs.existsSync(STATE_FILE)) {
        const state = fs.readJsonSync(STATE_FILE);
        if (state.activeGameId) {
            activeGameId = state.activeGameId;
        }
    }
} catch (e) {
    console.warn('Failed to load application state:', e);
}

// ==========================================================================
// 并发操作队列 — 确保同一 Mod 的操作（激活/停用）顺序排队执行，避免文件系统竞争
// 不同 Mod 的操作独立排队，互不阻塞
// ==========================================================================

/** @type {Map<string, Promise<any>>} */
const modOperationQueue = new Map();

/**
 * 为指定 modName 排队一个异步操作。
 * 同一 modName 的操作会利用 Promise 链顺序执行；不同 modName 并行执行。
 * @param {string} modName 
 * @param {() => Promise<any>} fn 
 * @returns {Promise<any>}
 */
function enqueueModOperation(modName, fn) {
    const key = String(modName).toLowerCase().trim();
    const prev = modOperationQueue.get(key) ?? Promise.resolve();
    const next = prev
        .then(fn)
        .catch(e => { throw e; }) // preserve rejection so callers see it
        .finally(() => {
            // 如果队列中只剩这一个，清理 Map 防止内存泄漏
            if (modOperationQueue.get(key) === next) {
                modOperationQueue.delete(key);
            }
        });
    modOperationQueue.set(key, next);
    return next;
}

// ==========================================================================
// 游戏配置 Schema 验证
// ==========================================================================

/**
 * 验证游戏配置 JSON 是否符合最小 Schema。
 * 返回验证错误数组；数组为空表示验证通过。
 * @param {any} data 
 * @param {string} filename 
 * @returns {string[]}
 */
function validateGameConfig(data, filename) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return [`${filename}: 根层必须是一个 JSON 对象`];
    }

    // 必需字段及其类型要求
    const required = [
        { key: 'id', type: 'string' },
        { key: 'name', type: 'string' },
        { key: 'settings_id', type: 'number' },
        { key: 'executable', type: 'string' },
    ];
    for (const { key, type } of required) {
        if (data[key] === undefined || data[key] === null) {
            errors.push(`${filename}: 缺少必需字段 "${key}"`);
        } else if (typeof data[key] !== type) {
            errors.push(`${filename}: 字段 "${key}" 应为 ${type}，实际为 ${typeof data[key]}`);
        } else if (type === 'string' && data[key].trim() === '') {
            errors.push(`${filename}: 字段 "${key}" 不能为空字符串`);
        }
    }

    // 可选字段类型检查
    if (data.features !== undefined && (typeof data.features !== 'object' || Array.isArray(data.features))) {
        errors.push(`${filename}: 可选字段 "features" 若存在必须是对象`);
    }
    if (data.uiConfig !== undefined && (typeof data.uiConfig !== 'object' || Array.isArray(data.uiConfig))) {
        errors.push(`${filename}: 可选字段 "uiConfig" 若存在必须是对象`);
    }
    if (data.nexusUrl !== undefined && typeof data.nexusUrl !== 'string') {
        errors.push(`${filename}: 可选字段 "nexusUrl" 若存在必须是字符串`);
    }

    return errors;
}

// --- 数据库初始化 ---
function initDB() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Mod 标签表 (包含 display_order 和 priority)
    db.exec(`
        CREATE TABLE IF NOT EXISTS mod_tags (
            mod_name TEXT PRIMARY KEY,
            tags TEXT,
            display_order INTEGER,
            priority INTEGER DEFAULT 9
        )
    `);

    // 子模块表
    db.exec(`
        CREATE TABLE IF NOT EXISTS sub_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_mod_name TEXT NOT NULL,
            sub_mod_name TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            display_order INTEGER,
            FOREIGN KEY (parent_mod_name) REFERENCES mod_tags(mod_name) ON DELETE CASCADE,
            UNIQUE(parent_mod_name, sub_mod_name)
        )
    `);

    // 同类 Mod 组表
    db.exec(`
        CREATE TABLE IF NOT EXISTS similar_mod_groups (
            group_id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_name TEXT UNIQUE NOT NULL,
            mod_names TEXT NOT NULL
        )
    `);

    // 设置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY,
            mods_dir TEXT,
            game_path TEXT,
            background_images_dir TEXT,
            background_image_name TEXT,
            background_opacity REAL,
            background_blur REAL,
            theme TEXT,
            color_preset TEXT,
            foreground_transparency REAL DEFAULT 1.0,
            preview_delay INTEGER DEFAULT 600,
            preview_interval INTEGER DEFAULT 2000,
            scroll_trigger_distance INTEGER DEFAULT 100,
            nexus_download_dir TEXT
        )
    `);

    // Mod 预设表
    db.exec(`
        CREATE TABLE IF NOT EXISTS mod_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT,
            mods TEXT,
            sub_mods TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // --- Database Migration: Add missing columns if they don't exist ---
    try {
        const settingsTableInfo = db.pragma('table_info(settings)');
        const existingSettingsColumns = new Set(settingsTableInfo.map(c => c.name));

        if (!existingSettingsColumns.has('foreground_transparency')) {
            db.prepare('ALTER TABLE settings ADD COLUMN foreground_transparency REAL DEFAULT 1.0').run();
        }
        if (!existingSettingsColumns.has('preview_delay')) {
            db.prepare('ALTER TABLE settings ADD COLUMN preview_delay INTEGER DEFAULT 600').run();
        }
        if (!existingSettingsColumns.has('preview_interval')) {
            db.prepare('ALTER TABLE settings ADD COLUMN preview_interval INTEGER DEFAULT 2000').run();
        }
        if (!existingSettingsColumns.has('scroll_trigger_distance')) {
            db.prepare('ALTER TABLE settings ADD COLUMN scroll_trigger_distance INTEGER DEFAULT 100').run();
        }
        if (!existingSettingsColumns.has('nexus_download_dir')) {
            db.prepare('ALTER TABLE settings ADD COLUMN nexus_download_dir TEXT').run();
        }

        // Migration for mod_tags custom_display_name
        const modTagsTableInfo = db.pragma('table_info(mod_tags)');
        const existingModTagsColumns = new Set(modTagsTableInfo.map(c => c.name));
        if (!existingModTagsColumns.has('custom_display_name')) {
            console.log('Migrating database: Adding custom_display_name to mod_tags');
            db.prepare('ALTER TABLE mod_tags ADD COLUMN custom_display_name TEXT').run();
        }

    } catch (e) {
        console.error("Database migration error:", e);
    }

    // 初始化默认设置
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!settings) {
        db.prepare(`
            INSERT INTO settings (id, mods_dir, game_path, background_images_dir, background_image_name, background_opacity, background_blur, theme, color_preset, foreground_transparency, preview_delay, preview_interval, scroll_trigger_distance, nexus_download_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(1, '', '', DEFAULT_BG_DIR, '', 1.0, 0.0, 'dark', 'default', 1.0, 600, 2000, 100, '');
    }
}

// --- 辅助函数 ---

function getSettingsIdForGame(gameId) {
    const fallbackId = 1;
    if (!gameId) return fallbackId;

    try {
        const games = getGamesData();
        const game = games.find(g => g.id === gameId);
        const settingsId = Number(game?.settings_id);
        if (Number.isInteger(settingsId) && settingsId > 0) {
            return settingsId;
        }
    } catch (e) {
        console.error('Failed to resolve settings_id for game:', gameId, e);
    }

    return fallbackId;
}

function ensureSettingsRow(settingsId) {
    let row = db.prepare('SELECT * FROM settings WHERE id = ?').get(settingsId);
    if (!row) {
        db.prepare(`
            INSERT INTO settings (id, mods_dir, game_path, background_images_dir, background_image_name, background_opacity, background_blur, theme, color_preset, foreground_transparency, preview_delay, preview_interval, scroll_trigger_distance, nexus_download_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(settingsId, '', '', DEFAULT_BG_DIR, '', 1.0, 0.0, 'dark', 'default', 1.0, 600, 2000, 100, '');
        row = db.prepare('SELECT * FROM settings WHERE id = ?').get(settingsId);
    }
    return row;
}

function getSettings() {
    const settingsId = getSettingsIdForGame(activeGameId);
    let settings = { ...ensureSettingsRow(settingsId) };

    // 动态计算 active_mods_dir 和 game_exe_path
    if (settings.game_path && fs.existsSync(settings.game_path)) {
        // For new game, we might want different paths, but assuming same structure 'SB/Content/...' for now 
        // OR we should make this dynamic based on game type.
        // But the user said "roughly same". I'll assume same structure or generic.
        // Actually, if it's a different game, it might not be 'SB/Content/Paks/~mods'.
        // But for now, let's keep the logic or adapt it.
        // Assuming UE logic: Content/Paks/~mods is standard. The 'SB' part is GameName.
        // We might need to guess the GameName folder or let user configure 'active_mods_dir' manually?
        // But the current logic derives it.

        // Improve derivation: Use the game executable name or folder name if possible?
        // For now, I will keep the SB hardcoding for ID=1, and generic for ID=2?
        // Or better yet, check if 'SB' folder exists, if not check others?
        // User asked "Management page roughly same".

        if (activeGameId === 'RomancingSaGa2') { // Romancing SaGa 2
            settings.active_mods_dir = path.join(settings.game_path, 'Game', 'Content', 'Paks', '~mods');
            settings.game_exe_path = path.join(settings.game_path, 'Game', 'Binaries', 'Win64', 'Romancing SaGa 2 RotS-Win64.exe');
        } else if (activeGameId === 'KCD2') { // KCD2
            settings.active_mods_dir = path.join(settings.game_path, 'Mods');
            settings.game_exe_path = path.join(settings.game_path, 'Bin', 'Win64MasterMasterSteamPGO', 'KingdomCome.exe');
        } else if (activeGameId === 'StellarBlade') { // Stellar Blade
            const sbPath = path.join(settings.game_path, 'SB');
            const gamePath = path.join(settings.game_path, 'Game');

            if (fs.existsSync(sbPath)) {
                settings.active_mods_dir = path.join(settings.game_path, 'SB', 'Content', 'Paks', '~mods');
                settings.game_exe_path = path.join(settings.game_path, 'SB.exe');
            } else if (fs.existsSync(gamePath)) {
                settings.active_mods_dir = path.join(settings.game_path, 'Game', 'Content', 'Paks', '~mods');
                try {
                    const exes = fs.readdirSync(settings.game_path).filter(f => f.endsWith('.exe'));
                    settings.game_exe_path = exes.length > 0 ? path.join(settings.game_path, exes[0]) : '';
                } catch (e) {
                    settings.game_exe_path = '';
                }
            } else {
                // Default to SB structure
                settings.active_mods_dir = path.join(settings.game_path, 'SB', 'Content', 'Paks', '~mods');
                settings.game_exe_path = path.join(settings.game_path, 'SB.exe');
            }
        } else {
            // Generic UE Game: find project folder containing Content/Paks
            const subFolders = fs.readdirSync(settings.game_path).filter(f => fs.statSync(path.join(settings.game_path, f)).isDirectory());
            const projectFolder = subFolders.find(f => fs.existsSync(path.join(settings.game_path, f, 'Content', 'Paks')));

            if (projectFolder) {
                settings.active_mods_dir = path.join(settings.game_path, projectFolder, 'Content', 'Paks', '~mods');
                const exes = fs.readdirSync(settings.game_path).filter(f => f.endsWith('.exe'));
                settings.game_exe_path = exes.length > 0 ? path.join(settings.game_path, exes[0]) : '';
            } else if (fs.existsSync(path.join(settings.game_path, 'Content', 'Paks'))) {
                settings.active_mods_dir = path.join(settings.game_path, 'Content', 'Paks', '~mods');
                settings.game_exe_path = '';
            } else {
                settings.active_mods_dir = '';
                settings.game_exe_path = '';
            }
        }
    }

    if (!settings.active_mods_dir) settings.active_mods_dir = '';
    if (!settings.game_exe_path) settings.game_exe_path = '';

    // 确保目录存在
    if (settings.mods_dir) fs.ensureDirSync(settings.mods_dir);
    if (settings.active_mods_dir) fs.ensureDirSync(settings.active_mods_dir);
    if (settings.background_images_dir) fs.ensureDirSync(settings.background_images_dir);

    return settings;
}

// 检查文件是否被占用
function isFileLocked(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        const fd = fs.openSync(filePath, 'r+');
        fs.closeSync(fd);
        return false;
    } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
            return true;
        }
        return false;
    }
}

function checkModFilesLocked(modPath) {
    if (!fs.existsSync(modPath)) return null;
    let lockedFile = null;

    function walkDir(dir) {
        if (lockedFile) return;
        try {
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                if (lockedFile) return;
                const filePath = path.join(dir, file);
                // 增加 try-catch 防止读取特殊文件属性时报错
                try {
                    const stat = fs.statSync(filePath);
                    if (stat && stat.isDirectory()) {
                        walkDir(filePath);
                    } else {
                        // 仅检查 .pak 文件
                        if (file.toLowerCase().endsWith('.pak')) {
                            if (isFileLocked(filePath)) {
                                lockedFile = filePath;
                            }
                        }
                    }
                } catch (e) {
                    // 忽略无权限访问的文件
                }
            });
        } catch (e) {
            // 目录读取失败
        }
    }

    walkDir(modPath);
    return lockedFile;
}

// 异步获取 Mod 文件列表 (性能优化版)
async function getModFilesAsync(modPath) {
    const fileSet = new Set();
    if (!await fs.pathExists(modPath)) return fileSet;

    const excludedExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.dds']);

    async function walk(dir, rootDir) {
        let list;
        try {
            list = await fs.readdir(dir);
        } catch (e) { return; }

        await Promise.all(list.map(async (file) => {
            const filePath = path.join(dir, file);
            let stat;
            try {
                stat = await fs.stat(filePath);
            } catch (e) { return; }

            if (stat.isDirectory()) {
                await walk(filePath, rootDir);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (!excludedExts.has(ext)) {
                    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
                    fileSet.add(relativePath);
                }
            }
        }));
    }

    await walk(modPath, modPath);
    return fileSet;
}

function getDisplayName(name) {
    // 优化正则：只匹配开头是 0-9 且紧跟下划线的情况 (例如 1_ModName)
    const match = name.match(/^(\d+)_+(.*)$/);
    if (match && match[2]) {
        return match[2].trim() || name;
    }
    return name;
}

function getModPriority(name) {
    // 优化正则：与 getDisplayName 保持一致
    const match = name.match(/^(\d+)_/);
    return match ? parseInt(match[1]) : 9;
}

const copyFilter = (src, dest) => {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) return true;
    const ext = path.extname(src).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.dds'];
    return !imageExtensions.includes(ext);
};

// 异步延时函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 带重试机制的异步重命名函数
async function safeRename(oldPath, newPath, retries = 5, delay = 200) {
    for (let i = 0; i < retries; i++) {
        try {
            await fs.rename(oldPath, newPath);
            return; // 成功
        } catch (error) {
            // 如果不是文件占用/权限问题，或者是最后一次尝试，则抛出错误
            const isLockError = error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES';
            if (!isLockError || i === retries - 1) {
                throw error;
            }
            // 等待后重试
            await sleep(delay);
        }
    }
}

// 核心重命名/优先级逻辑 (高鲁棒性版 - 解决子模块和文件状态不一致问题)
async function renameModLogic(oldName, newName, newDisplayName, isSubMod, parentModName, explicitPriority = null) {
    const settings = getSettings();

    // 0. 单独处理 Display Name 更新 (如果文件名没变)
    if (!isSubMod) {
        // 如果提供了新显示名称，且文件名未变（或变了但后续会处理）
        // 我们只需确保 final 的记录里有 custom_display_name

        // 如果仅仅是改显示名称，不改文件名
        if (oldName === newName && newDisplayName) {
            // 更新 DB
            const existing = db.prepare('SELECT * FROM mod_tags WHERE mod_name = ?').get(oldName);
            if (existing) {
                db.prepare('UPDATE mod_tags SET custom_display_name = ? WHERE mod_name = ?').run(newDisplayName, oldName);
                return { success: true, oldName, newName, newDisplayName };
            }
            // 如果 mod_tags 没记录 (极端情况)，可能需要插入? 
            // 暂时忽略，通常都有记录
        }
    }

    // 1. 计算最终名称
    let finalName = newName;
    if (!isSubMod) {
        let priority;
        if (explicitPriority !== null && explicitPriority !== undefined) {
            priority = explicitPriority;
        } else {
            const hasExplicitPriority = /^(\d+)_(.*)/.test(newName);
            priority = hasExplicitPriority ? getModPriority(newName) : getModPriority(oldName);
        }
        const baseName = getDisplayName(newName);
        // 如果优先级不是 9 (默认)，则添加前缀
        finalName = priority !== 9 ? `${priority}_${baseName}` : baseName;
    }

    // 如果名称没有变化，检查是否需要更新优先级或显示名称
    if (oldName === finalName) {
        // 如果仅仅是更新 Display Name，上面已经return了。
        // 如果运行到这里，说明文件名和显示名都没变 (或者 Display Name 逻辑没命中)
        // 但可能需要更新优先级字段（当设置的优先级与当前文件名的优先级相同时）
        if (!isSubMod && explicitPriority !== null && explicitPriority !== undefined) {
            const existing = db.prepare('SELECT * FROM mod_tags WHERE mod_name = ?').get(oldName);
            if (existing && existing.priority !== explicitPriority) {
                // 更新数据库中的优先级字段
                db.prepare('UPDATE mod_tags SET priority = ? WHERE mod_name = ?').run(explicitPriority, oldName);
                return { success: true, oldName, newName: finalName };
            }
        }
        // 再次检查是否需要更新 Display Name (针对 newName 计算后等于 oldName 但 newDisplayName 变了的情况)
        if (!isSubMod && newDisplayName) {
            const existing = db.prepare('SELECT * FROM mod_tags WHERE mod_name = ?').get(oldName);
            if (existing && existing.custom_display_name !== newDisplayName) {
                db.prepare('UPDATE mod_tags SET custom_display_name = ? WHERE mod_name = ?').run(newDisplayName, oldName);
                return { success: true, oldName, newName: finalName };
            }
        }
        return { success: true, oldName, newName: finalName };
    }

    const oldPath = path.join(settings.mods_dir, oldName);
    const newPath = path.join(settings.mods_dir, finalName);

    // 2. 检查文件系统状态
    if (!fs.existsSync(oldPath)) {
        return { success: false, message: `原 Mod "${oldName}" 不存在。` };
    }
    if (fs.existsSync(newPath)) {
        return { success: false, message: `目标 Mod 名称 "${finalName}" 已存在，操作取消。` };
    }

    // 2.1 预检查并清理数据库冲突 (防止文件改名成功但数据库因重复记录报错)
    if (!isSubMod) {
        try {
            const collision = db.prepare('SELECT mod_name FROM mod_tags WHERE mod_name = ?').get(finalName);
            if (collision) {
                // 如果数据库有记录但文件夹不存在（前面已检查 newPath 不存在），说明是残留的僵尸记录
                console.log(`检测到数据库残留记录 "${finalName}"，正在清理...`);
                const cleanupTx = db.transaction(() => {
                    db.prepare('DELETE FROM mod_tags WHERE mod_name = ?').run(finalName);
                    // 也要清理关联的子文件记录，防止外键冲突
                    db.prepare('DELETE FROM sub_files WHERE parent_mod_name = ? OR sub_mod_name = ?').run(finalName, finalName);
                });
                cleanupTx();
            }
        } catch (dbCheckErr) {
            console.error("Database check error:", dbCheckErr);
            // 这里不阻断，尝试继续
        }
    }

    // 状态标志，用于回滚
    let fsRenamed = false;

    // 3. 执行重命名 (使用带重试的机制)
    try {
        // 重命名主存储目录
        await safeRename(oldPath, newPath);
        fsRenamed = true;

        // 4. 同步重命名激活目录中的副本 (如果存在)
        if (!isSubMod && settings.active_mods_dir) {
            const oldActive = path.join(settings.active_mods_dir, oldName);
            const newActive = path.join(settings.active_mods_dir, finalName);

            // 只有当旧的激活文件夹存在时才操作
            if (fs.existsSync(oldActive)) {
                try {
                    // 如果因为意外情况目标已存在，先尝试删除
                    if (fs.existsSync(newActive)) {
                        fs.removeSync(newActive);
                    }
                    await safeRename(oldActive, newActive);
                } catch (activeErr) {
                    console.error("Active mod rename warning:", activeErr);
                    // 即使激活目录重命名失败，我们也不回滚主目录的操作，只是记录警告
                }
            }
        }

        // 5. 更新数据库 (事务)
        const updateGroups = db.prepare('SELECT * FROM similar_mod_groups').all();

        // 数据库操作必须是同步的，包裹在事务中
        const transaction = db.transaction(() => {
            // 策略：使用 "复制-转移-删除" (Copy-Update-Delete) 模式
            // 这种模式可以避免直接更新主键 (UPDATE PK) 导致的外键约束 (Foreign Key) 冲突，
            // 尤其是在 SQLite 默认可能不允许级联更新 (ON UPDATE CASCADE) 的情况下。

            // 1. 获取旧记录数据
            const oldTagRow = db.prepare('SELECT * FROM mod_tags WHERE mod_name = ?').get(oldName);

            if (oldTagRow) {
                // 计算新优先级：如果提供了 explicitPriority，使用它；否则从 finalName 中提取
                let newPriorityVal;
                if (!isSubMod) {
                    newPriorityVal = (explicitPriority !== null && explicitPriority !== undefined)
                        ? explicitPriority
                        : getModPriority(finalName);
                } else {
                    newPriorityVal = oldTagRow.priority;
                }

                // 确定 Custom Display Name: 如果传入了新名称则使用，否则沿用旧的
                const finalCustomDisplayName = newDisplayName !== undefined ? newDisplayName : oldTagRow.custom_display_name;

                // 2. 插入新记录 (Clone)
                // 注意：需要添加 custom_display_name
                db.prepare(`
                    INSERT INTO mod_tags (mod_name, tags, display_order, priority, custom_display_name) 
                    VALUES (?, ?, ?, ?, ?)
                `).run(finalName, oldTagRow.tags, oldTagRow.display_order, newPriorityVal, finalCustomDisplayName);

                // 3. 转移子引用：更新子文件的父级引用 (将子模块挂载到新名称下)
                db.prepare('UPDATE sub_files SET parent_mod_name = ? WHERE parent_mod_name = ?').run(finalName, oldName);

                // 4. 转移自身引用：如果被重命名的是个子模块，更新它在 sub_files 中的记录
                db.prepare('UPDATE sub_files SET sub_mod_name = ? WHERE sub_mod_name = ?').run(finalName, oldName);

                // 5. 删除旧记录 (此时它不再被引用，可以安全删除)
                db.prepare('DELETE FROM mod_tags WHERE mod_name = ?').run(oldName);
            } else {
                // 极端情况：mod_tags 里没记录 (例如纯文件被扫描到但没入库?)
                // 尝试直接更新 sub_files 里的自身引用
                db.prepare('UPDATE sub_files SET sub_mod_name = ? WHERE sub_mod_name = ?').run(finalName, oldName);
            }

            // 更新同类组 (文本替换，无外键约束)
            updateGroups.forEach(g => {
                const members = g.mod_names.split(',');
                if (members.includes(oldName)) {
                    const updatedMembers = members.map(m => m === oldName ? finalName : m);
                    db.prepare('UPDATE similar_mod_groups SET mod_names = ? WHERE group_id = ?').run(updatedMembers.join(','), g.group_id);
                }
            });
        });

        transaction();

        return { success: true, oldName: oldName, newName: finalName };
    } catch (e) {
        console.error("Rename Error:", e);

        // --- 自动回滚逻辑 ---
        let rollbackMessage = "";
        if (fsRenamed) {
            try {
                // 关键：如果数据库更新失败，且文件系统已经改名了，必须尝试把文件夹名改回去！
                // 这样能保证用户看到的状态是一致的，不会出现“提示失败但文件已改名”的情况。
                if (fs.existsSync(newPath) && !fs.existsSync(oldPath)) {
                    await safeRename(newPath, oldPath);
                    rollbackMessage = " (已自动回滚文件夹名称，请重试)";
                }
            } catch (rollbackErr) {
                console.error("Rollback failed:", rollbackErr);
                rollbackMessage = " (文件夹名称回滚失败，请手动检查 Mod 文件夹)";
            }
        }

        let errorMsg = e.message;
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
            errorMsg = `文件被占用，请关闭可能正在使用该 Mod 的程序（如图片查看器或游戏）后重试。(${e.code})`;
        } else if (e.message.includes('UNIQUE constraint failed') || e.message.includes('PRIMARY KEY')) {
            errorMsg = `数据库更新冲突。这通常是因为目标名称 "${finalName}" 在数据库中已存在残留记录。`;
        } else if (e.message.includes('FOREIGN KEY constraint failed')) {
            errorMsg = `数据库外键约束冲突。无法修改拥有子模块的父 Mod 名称。`;
        }

        return { success: false, message: `操作失败: ${errorMsg}${rollbackMessage}` };
    }
}

// 核心 Mod 导入逻辑 (抽象出公共函数供 按钮点击 和 拖拽使用)
function importModsFromDirectories(directoryPaths) {
    const settings = getSettings();
    if (!settings.mods_dir) return { success: false, message: '请先设置 Mod 文件夹路径。' };

    const addedMods = [];
    const skippedMods = [];

    // 递归查找叶子目录 (即包含文件的最底层目录，或者是 Mod 的根目录)
    function findLeafFolders(dir) {
        let leaves = [];
        try {
            if (!fs.statSync(dir).isDirectory()) return []; // 跳过文件
            const items = fs.readdirSync(dir);
            let hasSubDir = false;
            items.forEach(item => {
                const fullPath = path.join(dir, item);
                try {
                    if (fs.statSync(fullPath).isDirectory()) {
                        hasSubDir = true;
                        leaves = leaves.concat(findLeafFolders(fullPath));
                    }
                } catch (e) { }
            });
            // 如果没有子目录（或者所有子项都是文件），则认为这是个叶子 Mod 文件夹
            if (!hasSubDir) leaves.push(dir);
        } catch (e) {
            console.error("Error finding leaves:", e);
        }
        return leaves;
    }

    const minOrderRow = db.prepare('SELECT MIN(display_order) as min_order FROM mod_tags').get();
    let nextOrder = (minOrderRow.min_order || 0) - 1;

    directoryPaths.forEach(rootPath => {
        try {
            if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) return;
        } catch (e) { return; }

        const leaves = findLeafFolders(rootPath);

        leaves.forEach(leafPath => {
            const modName = path.basename(leafPath);
            const dest = path.join(settings.mods_dir, modName);

            if (fs.existsSync(dest)) {
                skippedMods.push(modName);
            } else {
                try {
                    fs.copySync(leafPath, dest);
                    const priority = getModPriority(modName);
                    db.prepare('INSERT OR IGNORE INTO mod_tags (mod_name, tags, display_order, priority) VALUES (?, ?, ?, ?)').run(modName, '', nextOrder--, priority);
                    addedMods.push(modName);
                } catch (e) {
                    console.error(`Failed to copy ${modName}:`, e);
                }
            }
        });
    });

    if (addedMods.length === 0 && skippedMods.length === 0) {
        return { success: false, message: '未找到有效文件夹或文件夹无效。' };
    }

    return {
        success: addedMods.length > 0,
        message: `成功添加: ${addedMods.length}, 跳过: ${skippedMods.length}`
    };
}

// --- Electron 主程序 ---

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        backgroundColor: '#1a1b26',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            webviewTag: true // <--- 修复：启用 webview 标签
        },
        // 修复：使用 icon.ico 确保在 windows 任务栏显示正确，与 package.json 一致
        icon: path.join(__dirname, '../renderer/assets/icon.ico')
    });

    // --- 强制绕过 SSL 证书验证 (针对 Nexus Mods 代理/VPN) ---
    // 这是比 ignore-certificate-errors 更底层的处理方式
    mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
        // 直接返回 0 (net::OK)，信任所有证书
        callback(0);
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/game-selector.html'));

    // 外部链接仍使用默认浏览器打开 (排除 download 链接)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // 如果是 Nexus 的下载链接，允许它以便触发 download 事件 (虽然通常 click 会直接触发 download 而不是新窗口)
        // 但大部分 mod 下载是新窗口打开下载，这里我们允许它，然后拦截下载
        if (url.includes('nexusmods.com') && url.includes('download')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // --- 核心：下载监听与拦截 ---
    mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
        const fileName = item.getFilename();
        const url = item.getURL();

        // 确保下载目录存在
        fs.ensureDirSync(TEMP_DOWNLOADS_DIR);

        // 使用时间戳防止文件名冲突
        const savePath = path.join(TEMP_DOWNLOADS_DIR, `${Date.now()}_${fileName}`);
        item.setSavePath(savePath);

        // 发送开始下载事件给前端 (可选：用于显示全局进度条)
        mainWindow.webContents.send('download-started', { filename: fileName });

        item.on('updated', (event, state) => {
            if (state === 'interrupted') {
                console.log('Download interrupted');
                mainWindow.webContents.send('download-interrupted', { filename: fileName });
            } else if (state === 'progressing') {
                if (item.isPaused()) {
                    // Paused
                } else {
                    const progress = item.getTotalBytes() > 0 ? item.getReceivedBytes() / item.getTotalBytes() : 0;
                    mainWindow.webContents.send('download-progress', {
                        filename: fileName,
                        progress: progress,
                        received: item.getReceivedBytes(),
                        total: item.getTotalBytes()
                    });
                }
            }
        });

        item.once('done', (event, state) => {
            if (state === 'completed') {
                console.log('Download successfully:', savePath);
                // 下载完成，处理文件
                handleDownloadedFile(savePath, fileName);
                cleanupTempDownloads(); // Check for cleanup
            } else {
                console.log(`Download failed: ${state}`);
                mainWindow.webContents.send('download-failed', { filename: fileName, state });
            }
        });
    });
}

// ==========================================================================
// 压缩文件处理辅助函数
// ==========================================================================

/**
 * 检测文件是否为支持的压缩格式
 */
function isSupportedArchive(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = filePath.toLowerCase();
    const supportedFormats = ['.zip', '.rar', '.7z', '.tar'];

    // 检查单一扩展名
    if (supportedFormats.includes(ext)) return true;

    // 检查复合扩展名 (如 .tar.gz, .tar.bz2)
    if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) return true;
    if (fileName.endsWith('.tar.bz2') || fileName.endsWith('.tbz2')) return true;
    if (fileName.endsWith('.tar.xz') || fileName.endsWith('.txz')) return true;

    return false;
}

/**
 * 使用 node-7z 列出压缩包内容
 */
async function listArchiveContents(filePath) {
    return new Promise((resolve, reject) => {
        if (!Seven || !sevenBin) {
            reject(new Error('node-7z 未安装'));
            return;
        }

        const stream = Seven.list(filePath, { $bin: sevenBin.path7za });
        const entries = [];

        stream.on('data', (data) => {
            // 过滤掉目录项和系统文件
            if (!data.file || data.file.startsWith('__MACOSX')) return;

            entries.push({
                path: data.file,
                name: path.basename(data.file),
                isDirectory: data.attributes && data.attributes.includes('D'),
                size: parseInt(data.size) || 0
            });
        });

        stream.on('end', () => resolve(entries));
        stream.on('error', (err) => reject(err));
    });
}

/**
 * 使用 node-7z 解压选定的文件
 */
async function extractSelectedFiles(archivePath, selectedPaths, targetDir) {
    if (!Seven || !sevenBin) {
        throw new Error('node-7z 未安装，无法解压文件');
    }

    // node-7z 不支持选择性解压单个文件，需要先全部解压到临时目录
    // 然后只复制选中的文件到目标目录
    const tempExtractDir = path.join(TEMP_DOWNLOADS_DIR, `extract_${Date.now()}`);

    try {
        // 解压所有文件到临时目录
        await new Promise((resolve, reject) => {
            const stream = Seven.extractFull(archivePath, tempExtractDir, { $bin: sevenBin.path7za });
            stream.on('end', () => resolve());
            stream.on('error', (err) => reject(err));
        });

        // 只复制选中的文件到目标目录
        for (const selectedPath of selectedPaths) {
            const sourcePath = path.join(tempExtractDir, selectedPath);
            const targetPath = path.join(targetDir, selectedPath);

            if (await fs.pathExists(sourcePath)) {
                await fs.ensureDir(path.dirname(targetPath));
                await fs.copy(sourcePath, targetPath);
            }
        }

        // 清理临时目录
        await fs.remove(tempExtractDir);
    } catch (error) {
        // 确保清理临时目录
        if (await fs.pathExists(tempExtractDir)) {
            await fs.remove(tempExtractDir);
        }
        throw error;
    }
}

/**
 * 使用 node-unrar-js 列出 RAR 文件内容
 */
async function listRarContents(filePath) {
    if (!unrar) {
        throw new Error('node-unrar-js 未安装');
    }

    const buf = await fs.readFile(filePath);
    const extractor = await unrar.createExtractorFromData({ data: buf });
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];

    return fileHeaders
        .filter(header => !header.name.startsWith('__MACOSX'))
        .map(header => ({
            path: header.name,
            name: path.basename(header.name),
            isDirectory: header.flags.directory,
            size: header.unpSize
        }));
}

/**
 * 使用 node-unrar-js 解压 RAR 文件
 */
async function extractRarFiles(rarPath, selectedPaths, targetDir) {
    if (!unrar) {
        throw new Error('node-unrar-js 未安装，无法解压 RAR 文件');
    }

    const buf = await fs.readFile(rarPath);
    const extractor = await unrar.createExtractorFromData({ data: buf });
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];

    // 创建选中文件的 Set 以便快速查找
    const selectedSet = new Set(selectedPaths);

    // 解压选中的文件
    for (const header of fileHeaders) {
        if (selectedSet.has(header.name) && !header.flags.directory) {
            const extracted = extractor.extract([header]);
            const files = [...extracted.files];

            if (files.length > 0) {
                const file = files[0];
                const targetPath = path.join(targetDir, header.name);

                await fs.ensureDir(path.dirname(targetPath));
                await fs.writeFile(targetPath, file.extraction);
            }
        }
    }
}

// 处理下载完成的文件：检查是否为压缩包，是则读取结构
async function handleDownloadedFile(filePath, originalFilename) {
    // 检查是否为支持的压缩格式
    if (!isSupportedArchive(filePath)) {
        // 不是支持的压缩格式，直接提示
        mainWindow.webContents.send('download-complete-single', {
            tempPath: filePath,
            originalFilename: originalFilename
        });
        return;
    }

    const ext = path.extname(filePath).toLowerCase();

    try {
        let entries = [];

        // 对于 ZIP 文件，使用 adm-zip（速度更快）
        if (ext === '.zip') {
            if (!AdmZip) {
                mainWindow.webContents.send('download-error', { message: '下载完成，但未安装 adm-zip 模块，无法预览 ZIP 内容。' });
                return;
            }

            const zip = new AdmZip(filePath);
            const zipEntries = zip.getEntries();

            // 构建文件树结构供前端展示
            entries = zipEntries.map(entry => ({
                path: entry.entryName,
                name: entry.name,
                isDirectory: entry.isDirectory,
                size: entry.header.size
            })).filter(e => e.path && !e.path.startsWith('__MACOSX')); // 过滤掉垃圾文件
        }
        // 对于 RAR 文件，使用 node-unrar-js（完全支持 RAR5）
        else if (ext === '.rar') {
            if (!unrar) {
                mainWindow.webContents.send('download-error', { message: '下载完成，但未安装 node-unrar-js 模块，无法预览 RAR 内容。' });
                return;
            }

            entries = await listRarContents(filePath);
        }
        // 对于其他格式（7z, TAR, etc.），使用 node-7z
        else {
            if (!Seven || !sevenBin) {
                mainWindow.webContents.send('download-error', { message: '下载完成，但未安装 node-7z 模块，无法预览此压缩格式。' });
                return;
            }

            entries = await listArchiveContents(filePath);
        }

        // 发送给前端弹出选择框
        mainWindow.webContents.send('download-complete-selection', {
            tempPath: filePath,
            originalFilename: originalFilename,
            entries: entries,
            archiveType: ext // 添加压缩格式信息
        });

    } catch (e) {
        console.error('Error reading archive:', e);

        // 提供更详细的错误信息
        let errorMessage = `无法读取压缩文件: ${e.message}`;

        // 针对 RAR 文件的特殊提示
        if (ext === '.rar') {
            errorMessage = `无法打开 RAR 文件: ${e.message}\n\n` +
                `如果问题持续，请尝试：\n` +
                `- 重新下载文件\n` +
                `- 使用 WinRAR 手动解压后添加到 Mod 文件夹`;
        }

        mainWindow.webContents.send('download-error', { message: errorMessage });
    }
}

async function cleanupTempDownloads() {
    try {
        if (!fs.existsSync(TEMP_DOWNLOADS_DIR)) return;

        const files = fs.readdirSync(TEMP_DOWNLOADS_DIR);
        let totalSize = 0;
        const fileStats = [];

        for (const file of files) {
            const filePath = path.join(TEMP_DOWNLOADS_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    totalSize += stats.size;
                    fileStats.push({ path: filePath, size: stats.size, mtime: stats.mtimeMs });
                }
            } catch (e) { }
        }

        const MAX_SIZE = 1 * 1024 * 1024 * 1024; // 1GB

        if (totalSize > MAX_SIZE) {
            console.log(`Temp downloads size (${(totalSize / 1024 / 1024).toFixed(2)} MB) exceeds limit. Cleaning up...`);
            // Sort by oldest first
            fileStats.sort((a, b) => a.mtime - b.mtime);

            for (const file of fileStats) {
                if (totalSize <= MAX_SIZE) break;
                try {
                    fs.unlinkSync(file.path);
                    totalSize -= file.size;
                    console.log(`Deleted old temp file: ${path.basename(file.path)}`);
                } catch (e) {
                    console.error(`Failed to delete ${file.path}:`, e);
                }
            }
        }
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 当运行第二个实例时，聚焦到主窗口
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        initDB();
        cleanupTempDownloads(); // auto-cleanup on start

        protocol.handle('media', (req) => {
            const url = req.url.replace('media://', '');
            const decodedPath = decodeURIComponent(url);
            return net.fetch('file:///' + decodedPath.replace(/\\/g, '/'));
        });

        createWindow();

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});


// ================= IPC 处理程序 (API) =================

// --- 窗口控制 ---
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());

// --- 游戏选择 ---


ipcMain.handle('select-game', async (event, gameId) => {
    const games = getGamesData();
    const game = games.find(g => g.id === gameId);

    if (game) {
        activeGameId = gameId;
        try {
            fs.writeJsonSync(STATE_FILE, { activeGameId });
        } catch (e) {
            console.error('Failed to save state:', e);
        }
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        return { success: true };
    }
    return { success: false, message: 'Game not found' };
});

ipcMain.handle('get-active-game-id', () => {
    return activeGameId;
});

ipcMain.handle('return-to-game-select', () => {
    mainWindow.loadFile(path.join(__dirname, '../renderer/game-selector.html'));
});

// --- Dynamic Game Data Handlers ---
const GAMES_JSON_PATH = path.join(DATA_DIR, 'games.json');
const GAME_JSON_DIR = path.join(DATA_DIR, 'game');
fs.ensureDirSync(GAME_JSON_DIR);

function migrateLegacyGamesData() {
    if (fs.existsSync(GAMES_JSON_PATH)) {
        try {
            const legacyGames = fs.readJsonSync(GAMES_JSON_PATH);
            legacyGames.forEach(game => {
                const gamePath = path.join(GAME_JSON_DIR, `${game.id}.json`);
                if (!fs.existsSync(gamePath)) {
                    fs.outputJsonSync(gamePath, game, { spaces: 2 });
                }
            });
            // Rename to backup so we don't migrate again
            fs.renameSync(GAMES_JSON_PATH, path.join(DATA_DIR, 'games_backup.json'));
        } catch (e) {
            console.error("Failed to migrate legacy games.json", e);
        }
    }
}

function getGamesData() {
    try {
        migrateLegacyGamesData();

        let games = [];

        // Read all json files in GAME_JSON_DIR
        const files = fs.readdirSync(GAME_JSON_DIR);
        files.forEach(file => {
            if (file.toLowerCase().endsWith('.json')) {
                try {
                    const gameData = fs.readJsonSync(path.join(GAME_JSON_DIR, file));
                    // Schema 验证：确保必要字段存在且类型正确
                    const validationErrors = validateGameConfig(gameData, file);
                    if (validationErrors.length > 0) {
                        validationErrors.forEach(err => console.error(`[GameConfig] 验证失败: ${err}`));
                        // 跳过该配置，不加入列表
                    } else {
                        games.push(gameData);
                    }
                } catch (err) {
                    console.error(`[GameConfig] 解析 JSON 失败: ${file}`, err.message);
                }
            }
        });

        // --- Dynamic Cover Image Loading ---
        // Scan GAME_COVER_DIR for images matching game.name
        if (fs.existsSync(GAME_COVER_DIR)) {
            try {
                const coverFiles = fs.readdirSync(GAME_COVER_DIR);
                games.forEach(game => {
                    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
                    const matchingFile = coverFiles.find(file => {
                        const parsed = path.parse(file);
                        return parsed.name === game.name && validExtensions.includes(parsed.ext.toLowerCase());
                    });
                    if (matchingFile) {
                        game.cover_image = path.join(GAME_COVER_DIR, matchingFile);
                    }
                });
            } catch (err) {
                console.error("Error scanning game cover directory:", err);
            }
        }

        return games;
    } catch (e) {
        console.error("Failed to load games data:", e);
        return [];
    }
}

function sanitizeGameId(rawId) {
    return String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function buildGameId(inputId, gameName) {
    const normalizedInputId = sanitizeGameId(inputId);
    if (normalizedInputId) return normalizedInputId;

    const fromName = sanitizeGameId(String(gameName || '').replace(/\s+/g, ''));
    if (fromName) return fromName;

    return `Game${Date.now()}`;
}

function getNextSettingsId() {
    const games = getGamesData();
    const usedFromGameConfig = games
        .map(g => Number(g.settings_id))
        .filter(v => Number.isInteger(v) && v > 0);

    const settingsMaxRow = db.prepare('SELECT MAX(id) as max_id FROM settings').get();
    const maxFromSettingsTable = Number(settingsMaxRow?.max_id) || 0;
    const maxUsed = Math.max(maxFromSettingsTable, ...usedFromGameConfig, 0);

    return maxUsed + 1;
}

ipcMain.handle('get-games-list', () => {
    return getGamesData();
});

ipcMain.handle('update-game-details', (event, { id, name, description, cover_image }) => {
    try {
        const gamePath = path.join(GAME_JSON_DIR, `${id}.json`);

        let gameData = {};
        if (fs.existsSync(gamePath)) {
            gameData = fs.readJsonSync(gamePath);
        } else {
            // If the game JSON doesn't exist but somehow it's being updated, fall back to getting from array
            const games = getGamesData();
            const existing = games.find(g => g.id === id);
            if (existing) {
                gameData = existing;
            } else {
                return { success: false, message: 'Game not found' };
            }
        }

        gameData.name = name;
        gameData.description = description;
        gameData.cover_image = cover_image;

        fs.outputJsonSync(gamePath, gameData, { spaces: 2 });
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('add-game', (event, { id, name, description, executable, cover_image }) => {
    try {
        const gameName = String(name || '').trim();
        if (!gameName) {
            return { success: false, message: 'Game name cannot be empty' };
        }

        const gameId = buildGameId(id, gameName);
        if (!gameId) {
            return { success: false, message: 'Invalid game ID' };
        }

        const existingGames = getGamesData();
        const duplicated = existingGames.some(g => String(g.id).toLowerCase() === gameId.toLowerCase());
        if (duplicated) {
            return { success: false, message: `Game ID already exists: ${gameId}` };
        }

        const settingsId = getNextSettingsId();
        const gameData = {
            id: gameId,
            name: gameName,
            description: String(description || '').trim(),
            cover_image: String(cover_image || '').trim(),
            executable: String(executable || '').trim() || `${gameId}.exe`,
            settings_id: settingsId,
            displayName: gameName,
            nexusUrl: '',
            features: {
                clothingList: false
            },
            uiConfig: {
                windowTitle: `${gameName} Mod Manager`,
                launchButtonText: 'Launch Game',
                gamePathLabel: `${gameName} Game Root Directory:`
            }
        };

        const validationErrors = validateGameConfig(gameData, `${gameId}.json`);
        if (validationErrors.length > 0) {
            return { success: false, message: validationErrors.join('; ') };
        }

        const gamePath = path.join(GAME_JSON_DIR, `${gameId}.json`);
        fs.outputJsonSync(gamePath, gameData, { spaces: 2 });

        ensureSettingsRow(settingsId);

        return { success: true, game: gameData };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('select-image-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择图片',
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'webp'] }],
        properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

// --- 设置相关 ---
ipcMain.handle('get-all-settings', () => {
    return getSettings();
});

ipcMain.handle('save-all-settings', (event, settings) => {
    try {
        const id = getSettingsIdForGame(activeGameId);
        ensureSettingsRow(id);

        const stmt = db.prepare(`
            UPDATE settings
            SET mods_dir = ?, game_path = ?, nexus_download_dir = ?, background_images_dir = ?, background_image_name = ?, background_opacity = ?, background_blur = ?, theme = ?, color_preset = ?, foreground_transparency = ?, preview_delay = ?, preview_interval = ?, scroll_trigger_distance = ?
            WHERE id = ?
        `);
        const info = stmt.run(
            settings.mods_dir,
            settings.game_path,
            settings.nexus_download_dir || '',
            settings.background_images_dir,
            settings.background_image_name,
            settings.background_opacity,
            settings.background_blur,
            settings.theme,
            settings.color_preset,
            settings.foreground_transparency !== undefined ? settings.foreground_transparency : 1.0,
            settings.preview_delay !== undefined ? settings.preview_delay : 600,
            settings.preview_interval !== undefined ? settings.preview_interval : 2000,
            settings.scroll_trigger_distance !== undefined ? settings.scroll_trigger_distance : 100,
            id
        );

        // 向所有打开的窗口广播设置更新事件
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('settings-updated', settings);
        });

        return { success: info.changes > 0 };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- Mod 数据获取 ---
ipcMain.handle('get-mods-data', (event, filters) => {
    const settings = getSettings();
    if (!settings.mods_dir || !settings.active_mods_dir) {
        return { all_mod_details: [], similar_mod_groups: [], unfiltered_mod_details: [], unfiltered_sub_mods: [] };
    }

    const fsMods = new Set();
    if (fs.existsSync(settings.mods_dir)) {
        fs.readdirSync(settings.mods_dir).forEach(file => {
            if (fs.statSync(path.join(settings.mods_dir, file)).isDirectory()) {
                fsMods.add(file);
            }
        });
    }

    const dbModsRows = db.prepare('SELECT mod_name FROM mod_tags').all();
    const dbMods = new Set(dbModsRows.map(row => row.mod_name));

    const modsToAdd = [...fsMods].filter(x => !dbMods.has(x));
    if (modsToAdd.length > 0) {
        const maxOrderRow = db.prepare('SELECT MAX(display_order) as max_order FROM mod_tags').get();
        let nextOrder = (maxOrderRow.max_order || -1) + 1;

        const insertStmt = db.prepare('INSERT INTO mod_tags (mod_name, tags, display_order, priority) VALUES (?, ?, ?, ?)');
        const updateTrans = db.transaction((mods) => {
            mods.sort().forEach((mod, i) => {
                insertStmt.run(mod, '', nextOrder + i, getModPriority(mod));
            });
        });
        updateTrans(modsToAdd);
    }

    const modTags = db.prepare('SELECT * FROM mod_tags').all();
    const modTagsMap = {};
    modTags.forEach(row => {
        modTagsMap[row.mod_name] = {
            tags: row.tags ? row.tags.split(',').filter(t => t) : [],
            display_order: row.display_order,
            priority: row.priority,
            custom_display_name: row.custom_display_name // New field
        };
    });

    const subFiles = db.prepare(`
        SELECT sf.*, mt.tags 
        FROM sub_files sf 
        LEFT JOIN mod_tags mt ON sf.sub_mod_name = mt.mod_name
    `).all();

    const similarGroupsRaw = db.prepare('SELECT * FROM similar_mod_groups').all();
    const similarGroups = similarGroupsRaw.map(g => ({
        group_id: g.group_id,
        group_name: g.group_name,
        mod_names: g.mod_names.split(',')
    }));

    const subModsMap = {};
    const allChildModNames = new Set();

    subFiles.forEach(sm => {
        if (!subModsMap[sm.parent_mod_name]) subModsMap[sm.parent_mod_name] = [];
        subModsMap[sm.parent_mod_name].push({
            name: sm.sub_mod_name,
            display_name: getDisplayName(sm.sub_mod_name), // Sub-mods don't have custom display names yet
            is_active: !!sm.is_active,
            display_order: sm.display_order,
            tags: sm.tags ? sm.tags.split(',').filter(t => t) : []
        });
        allChildModNames.add(sm.sub_mod_name);
    });

    const activeMods = new Set();
    if (fs.existsSync(settings.active_mods_dir)) {
        fs.readdirSync(settings.active_mods_dir).forEach(f => activeMods.add(f));
    }

    const unfilteredModDetails = [];

    if (fs.existsSync(settings.mods_dir)) {
        const dirs = fs.readdirSync(settings.mods_dir).filter(f => fs.statSync(path.join(settings.mods_dir, f)).isDirectory());
        dirs.sort().forEach(modName => {
            if (allChildModNames.has(modName)) return;

            const modInfo = modTagsMap[modName] || { tags: [], display_order: 0, priority: 9, custom_display_name: null };
            const sourcePath = path.join(settings.mods_dir, modName);
            const activePath = path.join(settings.active_mods_dir, modName);

            // 优化：仅在必要时检查锁，减少IO
            const isLocked = isFileLocked(sourcePath);

            unfilteredModDetails.push({
                name: modName,
                // Priority: Custom Display Name > Generated Display Name
                display_name: modInfo.custom_display_name || getDisplayName(modName),
                is_active: activeMods.has(modName),
                tags: modInfo.tags,
                sub_mods: subModsMap[modName] || [],
                display_order: modInfo.display_order,
                priority: modInfo.priority,
                is_locked: isLocked
            });
        });
    }

    // Filter sub-mods to only those whose parent exists in the current mods directory
    // This effectively isolates sub-mods (and their tags) to the current game.
    const unfilteredSubMods = subFiles
        .filter(sm => fsMods.has(sm.parent_mod_name))
        .map(sm => ({
            name: sm.sub_mod_name,
            display_name: getDisplayName(sm.sub_mod_name),
            parent_mod_name: sm.parent_mod_name,
            is_active: !!sm.is_active,
            tags: sm.tags ? sm.tags.split(',').filter(t => t) : []
        }));

    return {
        all_mod_details: unfilteredModDetails,
        similar_mod_groups: similarGroups,
        unfiltered_mod_details: unfilteredModDetails,
        unfiltered_sub_mods: unfilteredSubMods
    };
});



// --- 文件夹选择 ---
ipcMain.handle('select-directory', async (event, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: title || '选择文件夹',
        properties: ['openDirectory']
    });
    if (result.canceled) {
        return { success: false, message: '未选择文件夹。' };
    }
    return { success: true, path: result.filePaths[0] };
});

// --- 添加 Mod 文件夹 ---
ipcMain.handle('add-mod-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要添加的 Mod 文件夹',
        properties: ['openDirectory']
    });

    if (result.canceled) return { success: false, message: '未选择文件夹。' };

    // 复用逻辑
    return importModsFromDirectories(result.filePaths);
});

// --- 新增：处理拖拽的文件夹 ---
ipcMain.handle('add-dropped-mods', async (event, filePaths) => {
    return importModsFromDirectories(filePaths);
});

// --- 新增：安装从 Nexus 下载的文件 ---
ipcMain.handle('install-selected-download', async (event, { tempPath, selectedEntries, modName }) => {
    const settings = getSettings();
    if (!settings.mods_dir) return { success: false, message: '未设置 Mod 文件夹路径。' };

    const targetDir = path.join(settings.mods_dir, modName);

    if (fs.existsSync(targetDir)) {
        return { success: false, message: `Mod "${modName}" 已存在，请重命名或删除后重试。` };
    }

    const ext = path.extname(tempPath).toLowerCase();

    try {
        // 创建目标 Mod 文件夹
        fs.ensureDirSync(targetDir);

        // 对于 ZIP 文件，使用 adm-zip
        // 对于 ZIP 文件，尝试使用 node-7z (extractSelectedFiles) 以支持大文件
        // AdmZip 在处理大文件 (>2GB) 时会抛出 "Array buffer allocation failed"
        if (ext === '.zip') {
            // 优先使用 node-7z，因为它更健壮
            if (Seven && sevenBin) {
                await extractSelectedFiles(tempPath, selectedEntries, targetDir);
            } else {
                // Fallback to AdmZip if node-7z is missing
                if (!AdmZip) return { success: false, message: 'AdmZip 和 node-7z 未安装，无法解压。' };
                const zip = new AdmZip(tempPath);
                for (const entryPath of selectedEntries) {
                    const entry = zip.getEntry(entryPath);
                    if (entry && !entry.isDirectory) {
                        zip.extractEntryTo(entry, targetDir, true, true);
                    }
                }
            }
        }
        // 对于 RAR 文件，使用 node-unrar-js
        else if (ext === '.rar') {
            if (!unrar) return { success: false, message: 'node-unrar-js 未安装，无法解压 RAR 文件。' };
            await extractRarFiles(tempPath, selectedEntries, targetDir);
        }
        // 对于其他格式，使用 node-7z
        else {
            await extractSelectedFiles(tempPath, selectedEntries, targetDir);
        }

        // 添加到数据库
        const priority = getModPriority(modName);
        const minOrderRow = db.prepare('SELECT MIN(display_order) as min_order FROM mod_tags').get();
        let nextOrder = (minOrderRow.min_order || 0) - 1;

        db.prepare('INSERT OR IGNORE INTO mod_tags (mod_name, tags, display_order, priority) VALUES (?, ?, ?, ?)').run(modName, '', nextOrder, priority);

        // 清理临时文件 (可选：如果需要保留原压缩包则不删，通常安装后删除)
        // fs.unlinkSync(tempPath); 
        // 建议不立即删除，或者询问用户。这里暂时保留以便调试，或者稍后在应用退出时清理 TEMP 目录。

        return { success: true };
    } catch (e) {
        console.error('Install download error:', e);
        // 如果失败，尝试清理已创建的文件夹
        try { if (fs.existsSync(targetDir)) fs.removeSync(targetDir); } catch (ex) { }
        return { success: false, message: e.message };
    }
});

// --- 激活/禁用 Mod (ASYNC OPTIMIZED) ---

// 异步删除 Mod 文件夹
async function deactivateModInternalAsync(modName, activeDir) {
    const target = path.join(activeDir, modName);
    if (await fs.pathExists(target)) {
        if (checkModFilesLocked(target)) { // 保持同步检查以确保快速锁定检测
            throw new Error(`Mod "${modName}" 文件被占用，无法删除。`);
        }
        await fs.remove(target);
    }
}

// 异步重新激活 Mod 包 (并行 Winner-Map 策略)
async function reactivateModPackageAsync(modName, settings) {

    // 1. 清理旧文件
    await deactivateModInternalAsync(modName, settings.active_mods_dir);

    const dest = path.join(settings.active_mods_dir, modName);

    // 2. 构建加载栈: [parentMod, subMod1(最低优先), ..., subModN(最高优先)]
    //    数据库按 display_order ASC 返回，最后的子模块覆盖前面的
    const activeSubs = db.prepare(
        'SELECT sub_mod_name FROM sub_files WHERE parent_mod_name = ? AND is_active = 1 ORDER BY display_order ASC'
    ).all(modName);
    const stack = [modName, ...activeSubs.map(r => r.sub_mod_name)];

    // 3. 并行扫描所有 Mod 目录，构建文件 Winner Map
    //    relPath -> 绝对源路径 (后扫描的覆盖先扫描的)
    const fileMap = new Map();
    const excludedExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.dds']);

    async function scanDir(modInStack) {
        const srcDir = path.join(settings.mods_dir, modInStack);
        if (!await fs.pathExists(srcDir)) return;

        async function walk(dir) {
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            await Promise.all(entries.map(async entry => {
                const absPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(absPath);
                } else {
                    if (!excludedExts.has(path.extname(entry.name).toLowerCase())) {
                        const rel = path.relative(srcDir, absPath).replace(/\\/g, '/');
                        fileMap.set(rel, absPath);
                    }
                }
            }));
        }
        await walk(srcDir);
    }

    // 顺序扫描（后扫的覆盖先扫的）以保证子模块覆盖顺序正确
    for (const modInStack of stack) {
        await scanDir(modInStack);
    }

    // 4. 并行复制所有 Winner 文件（批量限流避免 EMFILE）
    const BATCH_SIZE = 64;
    const entries = Array.from(fileMap.entries());

    await fs.ensureDir(dest);

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([relPath, srcFile]) => {
            const destFile = path.join(dest, relPath);
            await fs.ensureDir(path.dirname(destFile));
            await fs.copyFile(srcFile, destFile);
        }));
    }

    console.log(`[reactivate] ${modName}: ${entries.length} files copied (${stack.length} layers merged)`);
    return dest;
}


// 异步处理同类组冲突
async function handleSimilarGroupConflictsAsync(modName, settings) {
    const groups = db.prepare('SELECT * FROM similar_mod_groups').all();
    const myGroups = groups.filter(g => g.mod_names.split(',').includes(modName));

    for (const group of myGroups) {
        const members = group.mod_names.split(',');
        for (const member of members) {
            if (member === modName) continue;

            // 禁用冲突的主 Mod
            const memberPath = path.join(settings.active_mods_dir, member);
            if (await fs.pathExists(memberPath)) {
                await deactivateModInternalAsync(member, settings.active_mods_dir);
            }

            // 检查并禁用冲突的子 Mod
            const subModInfo = db.prepare('SELECT * FROM sub_files WHERE sub_mod_name = ? AND is_active = 1').get(member);
            if (subModInfo) {
                db.prepare('UPDATE sub_files SET is_active = 0 WHERE sub_mod_name = ?').run(member);
                const parentPath = path.join(settings.active_mods_dir, subModInfo.parent_mod_name);
                if (await fs.pathExists(parentPath)) {
                    // 如果父 Mod 处于激活状态，需要重构它以移除子 Mod 的影响
                    await reactivateModPackageAsync(subModInfo.parent_mod_name, settings);
                }
            }
        }
    }
}

ipcMain.handle('activate-mod', async (event, { modName, force }) => {
    return enqueueModOperation(modName, async () => {
        const settings = getSettings();
        const src = path.join(settings.mods_dir, modName);

        if (checkModFilesLocked(src)) return { success: false, message: 'Mod 文件被占用。', is_locked: true };

        try {
            // 处理冲突 (异步)
            await handleSimilarGroupConflictsAsync(modName, settings);

            // 核心激活逻辑 (异步) - 包括复制主文件和所有子文件
            const destPath = await reactivateModPackageAsync(modName, settings);

            return { success: true, dest: destPath };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });
});

ipcMain.handle('deactivate-mod', async (event, modName) => {
    return enqueueModOperation(modName, async () => {
        const settings = getSettings();
        try {
            await deactivateModInternalAsync(modName, settings.active_mods_dir);
            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });
});

// --- 子模块控制 (ASYNC) ---
// 智能禁用子模块 (仅回滚受影响的文件，而不重建整个包)
async function smartDeactivateSubModAsync(parentModName, subModToDeactivate, settings) {
    const activeDir = path.join(settings.active_mods_dir, parentModName);
    if (!await fs.pathExists(activeDir)) return;

    // 1. 获取需要移除的文件列表 (来自待禁用的子模块)
    const subModSourcePath = path.join(settings.mods_dir, subModToDeactivate);
    const filesToRemove = await getModFilesAsync(subModSourcePath);

    // 2. 确定剩余的激活栈 (Parent -> Sub1 -> Sub2 ...)
    // 必须按优先级/加载顺序排列。数据库查出的顺序即为加载顺序 (ORDER BY display_order ASC)
    const activeSubsRows = db.prepare('SELECT sub_mod_name FROM sub_files WHERE parent_mod_name = ? AND is_active = 1 AND sub_mod_name != ? ORDER BY display_order ASC').all(parentModName, subModToDeactivate);
    const stack = [parentModName, ...activeSubsRows.map(row => row.sub_mod_name)];

    // 3. 并行处理文件回滚
    const BATCH_SIZE = 50; // 限制并发避免 EMFILE
    const filesArray = Array.from(filesToRemove);

    for (let i = 0; i < filesArray.length; i += BATCH_SIZE) {
        const batch = filesArray.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (relPath) => {
            const destPath = path.join(activeDir, relPath);

            // 倒序查找拥有该文件的最高优先级源
            let winnerSource = null;
            for (let j = stack.length - 1; j >= 0; j--) {
                const sourceModName = stack[j];
                const sourceModPath = path.join(settings.mods_dir, sourceModName);
                const sourceFilePath = path.join(sourceModPath, relPath);

                // 检查源文件是否存在 (注意：这里使用 sync 检查或 access 即可，性能尚可)
                // 为稳健起见，使用 access
                try {
                    await fs.access(sourceFilePath);
                    winnerSource = sourceFilePath;
                    break; // 找到即为 Winner
                } catch { continue; }
            }

            if (winnerSource) {
                // 从 Winner 恢复文件
                // 确保父目录存在
                await fs.ensureDir(path.dirname(destPath));
                await fs.copy(winnerSource, destPath, { overwrite: true });
            } else {
                // 没有任何源拥有此文件 -> 删除
                await fs.remove(destPath);
            }
        }));
    }
}

ipcMain.handle('toggle-sub-mod', async (event, { parentModName, subModName, action, force }) => {
    // 以 subModName 为 key 排队，确保对同一子模块的并发操作顺序执行
    return enqueueModOperation(subModName, async () => {
        const settings = getSettings();
        const newState = action === 'activate' ? 1 : 0;

        try {
            if (action === 'activate') {
                await handleSimilarGroupConflictsAsync(subModName, settings);
            }

            db.prepare('UPDATE sub_files SET is_active = ? WHERE parent_mod_name = ? AND sub_mod_name = ?').run(newState, parentModName, subModName);

            const parentActivePath = path.join(settings.active_mods_dir, parentModName);
            if (await fs.pathExists(parentActivePath)) {
                if (action === 'activate') {
                    // 如果是激活，只需要增量复制这个子 Mod (覆盖)
                    const src = path.join(settings.mods_dir, subModName);
                    await fs.copy(src, parentActivePath, { filter: copyFilter, overwrite: true });
                } else {
                    // 优化：使用智能回滚，而不是重建整个包
                    await smartDeactivateSubModAsync(parentModName, subModName, settings);
                }
            }
            return { success: true };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });
});

// --- 批量应用预设 (高性能批处理版) ---
ipcMain.handle('batch-apply-preset', async (event, { disableSubMods, disableMods, enableMods, enableSubMods }) => {
    const settings = getSettings();
    const total = (disableSubMods?.length || 0) + (disableMods?.length || 0) + (enableMods?.length || 0) + (enableSubMods?.length || 0);
    let processed = 0;

    const sendProgress = () => {
        const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
        try { mainWindow.webContents.send('preset-progress', pct); } catch (e) { }
    };

    try {
        // 1. 并行禁用所有子模块（各操作独立，可并发）
        if (disableSubMods && disableSubMods.length > 0) {
            await Promise.all(disableSubMods.map(async ({ parent, sub }) => {
                try {
                    db.prepare('UPDATE sub_files SET is_active = 0 WHERE parent_mod_name = ? AND sub_mod_name = ?').run(parent, sub);
                    // 父模块激活目录存在时，智能回滚子模块文件
                    const parentActivePath = path.join(settings.active_mods_dir, parent);
                    if (await fs.pathExists(parentActivePath)) {
                        await smartDeactivateSubModAsync(parent, sub, settings);
                    }
                } catch (e) {
                    console.error(`[batch-apply] Failed to disable sub-mod ${parent}:${sub}`, e);
                }
                processed++;
                sendProgress();
            }));
        }

        // 2. 并行禁用所有主 Mod
        if (disableMods && disableMods.length > 0) {
            await Promise.all(disableMods.map(async (modName) => {
                try {
                    await deactivateModInternalAsync(modName, settings.active_mods_dir);
                } catch (e) {
                    console.error(`[batch-apply] Failed to disable mod ${modName}`, e);
                }
                processed++;
                sendProgress();
            }));
        }

        // 3. 顺序启用主 Mod（先处理冲突，再复制文件，顺序保证覆盖正确性）
        for (const modName of (enableMods || [])) {
            try {
                await handleSimilarGroupConflictsAsync(modName, settings);
                await reactivateModPackageAsync(modName, settings);
            } catch (e) {
                console.error(`[batch-apply] Failed to enable mod ${modName}`, e);
            }
            processed++;
            sendProgress();
        }

        // 4. 顺序启用子模块
        for (const { parent, sub } of (enableSubMods || [])) {
            try {
                await handleSimilarGroupConflictsAsync(sub, settings);
                db.prepare('UPDATE sub_files SET is_active = 1 WHERE parent_mod_name = ? AND sub_mod_name = ?').run(parent, sub);
                const parentActivePath = path.join(settings.active_mods_dir, parent);
                if (await fs.pathExists(parentActivePath)) {
                    const src = path.join(settings.mods_dir, sub);
                    await fs.copy(src, parentActivePath, { filter: copyFilter, overwrite: true });
                }
            } catch (e) {
                console.error(`[batch-apply] Failed to enable sub-mod ${parent}:${sub}`, e);
            }
            processed++;
            sendProgress();
        }

        return { success: true };
    } catch (e) {
        console.error('[batch-apply] Critical error:', e);
        return { success: false, message: e.message };
    }
});

// --- 补回的：添加子模块关系 API ---
ipcMain.handle('add-sub-mod-relation', (event, { parent_mod_name, sub_mod_names }) => {
    try {
        const insertStmt = db.prepare('INSERT INTO sub_files (parent_mod_name, sub_mod_name, is_active, display_order) VALUES (?, ?, 0, 999)');

        const transaction = db.transaction((subs) => {
            subs.forEach(subModName => {
                // 检查关系是否已存在
                const existing = db.prepare('SELECT id FROM sub_files WHERE parent_mod_name = ? AND sub_mod_name = ?').get(parent_mod_name, subModName);
                if (!existing) {
                    insertStmt.run(parent_mod_name, subModName);
                }
            });
        });

        transaction(sub_mod_names);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- 批量保存标签 ---
ipcMain.handle('batch-save-tags', (event, { selected_mods, tags_to_add, tags_to_remove }) => {
    try {
        const transaction = db.transaction(() => {
            selected_mods.forEach(modName => {
                const row = db.prepare('SELECT tags FROM mod_tags WHERE mod_name = ?').get(modName);
                // 确保 tags 存在，如果 mod 不在 mod_tags 表中（可能是新的子 mod），则先插入
                if (!row) {
                    db.prepare('INSERT OR IGNORE INTO mod_tags (mod_name, tags, display_order, priority) VALUES (?, ?, 999, 9)').run(modName, '');
                }

                let currentTags = row && row.tags ? row.tags.split(',').filter(t => t.trim()) : [];
                const currentTagsSet = new Set(currentTags);

                // 添加标签
                if (tags_to_add && tags_to_add.length > 0) {
                    tags_to_add.forEach(tag => currentTagsSet.add(tag));
                }

                // 移除标签
                if (tags_to_remove && tags_to_remove.length > 0) {
                    tags_to_remove.forEach(tag => currentTagsSet.delete(tag));
                }

                const newTagsStr = Array.from(currentTagsSet).join(',');
                db.prepare('UPDATE mod_tags SET tags = ? WHERE mod_name = ?').run(newTagsStr, modName);
            });
        });

        transaction();
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- 基础 CRUD (Updated delete-mod to use async helpers where applicable) ---
ipcMain.handle('delete-mod', async (event, { modName, isSubMod, parentModName }) => {
    const settings = getSettings();
    try {
        const groups = db.prepare('SELECT * FROM similar_mod_groups').all();
        groups.forEach(g => {
            const members = g.mod_names.split(',');
            if (members.includes(modName)) {
                const newMembers = members.filter(m => m !== modName);
                if (newMembers.length < 2) {
                    db.prepare('DELETE FROM similar_mod_groups WHERE group_id = ?').run(g.group_id);
                } else {
                    db.prepare('UPDATE similar_mod_groups SET mod_names = ? WHERE group_id = ?').run(newMembers.join(','), g.group_id);
                }
            }
        });

        if (isSubMod && parentModName) {
            db.prepare('DELETE FROM sub_files WHERE parent_mod_name = ? AND sub_mod_name = ?').run(parentModName, modName);
            const parentActivePath = path.join(settings.active_mods_dir, parentModName);
            if (await fs.pathExists(parentActivePath)) {
                await reactivateModPackageAsync(parentModName, settings);
            }
        } else {
            await deactivateModInternalAsync(modName, settings.active_mods_dir);
            const src = path.join(settings.mods_dir, modName);
            if (await fs.pathExists(src)) {
                await fs.remove(src);
            }

            db.prepare('DELETE FROM mod_tags WHERE mod_name = ?').run(modName);
            db.prepare('DELETE FROM sub_files WHERE parent_mod_name = ? OR sub_mod_name = ?').run(modName, modName);
        }
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('rename-mod', async (event, args) => {
    return await renameModLogic(args.oldName, args.newName, args.newDisplayName, args.isSubMod, args.parentModName);
});

// 优化：优先级更新接口
ipcMain.handle('update-priority', async (event, { modName, priority }) => {
    // 1. 获取 baseName (去掉旧的优先级前缀)
    const baseName = getDisplayName(modName);
    // 2. 强制应用新的优先级进行重命名
    // 参数顺序: oldName, newName, newDisplayName, isSubMod, parentModName, explicitPriority
    return await renameModLogic(modName, baseName, null, false, null, priority);
});

// --- 同类 Mod 组管理 ---
ipcMain.handle('create-similar-mod-group', (event, { group_name, mod_names }) => {
    try {
        const modsStr = mod_names.join(',');
        db.prepare('INSERT INTO similar_mod_groups (group_name, mod_names) VALUES (?, ?)').run(group_name, modsStr);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('delete-similar-mod-group', (event, { group_id }) => {
    try {
        db.prepare('DELETE FROM similar_mod_groups WHERE group_id = ?').run(group_id);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('rename-similar-mod-group', (event, { group_id, new_group_name }) => {
    try {
        db.prepare('UPDATE similar_mod_groups SET group_name = ? WHERE group_id = ?').run(new_group_name, group_id);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('add-mods-to-similar-group', (event, { group_id, mod_names }) => {
    try {
        const row = db.prepare('SELECT mod_names FROM similar_mod_groups WHERE group_id = ?').get(group_id);
        if (row) {
            const currentMods = row.mod_names.split(',');
            const newSet = new Set([...currentMods, ...mod_names]);
            const newStr = Array.from(newSet).join(',');
            db.prepare('UPDATE similar_mod_groups SET mod_names = ? WHERE group_id = ?').run(newStr, group_id);
            return { success: true };
        }
        return { success: false, message: '组不存在' };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('remove-mod-from-similar-group', (event, { group_id, mod_name }) => {
    try {
        const row = db.prepare('SELECT mod_names FROM similar_mod_groups WHERE group_id = ?').get(group_id);
        if (row) {
            const currentMods = row.mod_names.split(',');
            const newMods = currentMods.filter(m => m !== mod_name);
            if (newMods.length < 2) {
                db.prepare('DELETE FROM similar_mod_groups WHERE group_id = ?').run(group_id);
            } else {
                db.prepare('UPDATE similar_mod_groups SET mod_names = ? WHERE group_id = ?').run(newMods.join(','), group_id);
            }
            return { success: true };
        }
        return { success: false, message: '组不存在' };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- 排序保存 ---
ipcMain.handle('save-mod-order', (event, { order }) => {
    try {
        const stmt = db.prepare('UPDATE mod_tags SET display_order = ? WHERE mod_name = ?');
        const transaction = db.transaction((items) => {
            items.forEach((modName, index) => {
                stmt.run(index, modName);
            });
        });
        transaction(order);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('save-sub-mod-order', (event, { parentModName, order }) => {
    try {
        const stmt = db.prepare('UPDATE sub_files SET display_order = ? WHERE parent_mod_name = ? AND sub_mod_name = ?');
        const transaction = db.transaction((items) => {
            items.forEach((subModName, index) => {
                stmt.run(index, parentModName, subModName);
            });
        });
        transaction(order);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- 图片处理 ---
ipcMain.handle('list-background-images', () => {
    const settings = getSettings();
    if (!settings.background_images_dir) return [];
    try {
        if (!fs.existsSync(settings.background_images_dir)) return [];
        return fs.readdirSync(settings.background_images_dir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    } catch (e) {
        console.error("List background images error:", e);
        return [];
    }
});

ipcMain.handle('upload-background-image', async (event, filePath) => {
    const settings = getSettings();
    if (!settings.background_images_dir) return { success: false, message: '未设置背景图片目录' };

    const filename = path.basename(filePath);
    const dest = path.join(settings.background_images_dir, filename);

    try {
        fs.ensureDirSync(settings.background_images_dir);
        fs.copySync(filePath, dest);
        return { success: true, filename };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('delete-background-image', (event, { filename }) => {
    const settings = getSettings();
    if (!settings.background_images_dir) return { success: false, message: '未设置目录' };

    const target = path.join(settings.background_images_dir, filename);
    try {
        if (fs.existsSync(target)) {
            fs.removeSync(target);
            return { success: true };
        } else {
            return { success: false, message: '文件不存在' };
        }
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('get-mod-preview-images', (event, modName) => {
    const settings = getSettings();
    const modPath = path.join(settings.mods_dir, modName);
    if (!fs.existsSync(modPath)) return [];

    return fs.readdirSync(modPath)
        .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
        .map(f => ({
            filename: f,
            url: `media://${path.join(modPath, f)}`
        }));
});

ipcMain.handle('add-mod-preview-image', (event, { modName, filePath }) => {
    const settings = getSettings();
    const modPath = path.join(settings.mods_dir, modName);
    const filename = path.basename(filePath);
    const dest = path.join(modPath, filename);

    try {
        if (!fs.existsSync(modPath)) return { success: false, message: 'Mod 路径不存在' };
        fs.copySync(filePath, dest);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('delete-mod-preview-image', (event, { modName, filename }) => {
    const settings = getSettings();
    const target = path.join(settings.mods_dir, modName, filename);

    try {
        if (fs.existsSync(target)) fs.removeSync(target);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('list-clothing-images', () => {
    try {
        if (!fs.existsSync(CLOTHING_IMAGES_DIR)) return [];
        const files = fs.readdirSync(CLOTHING_IMAGES_DIR).filter(f => /\.(png|jpg|jpeg|gif|webp|dds)$/i.test(f));
        return files.map(filename => ({
            name: path.parse(filename).name,
            display_name: getDisplayName(path.parse(filename).name),
            url: `media://${path.join(CLOTHING_IMAGES_DIR, filename)}`
        }));
    } catch (e) {
        console.error("Error listing clothing images:", e);
        return [];
    }
});

// --- 其他功能 ---
ipcMain.handle('launch-game', () => {
    const settings = getSettings();
    if (!settings.game_exe_path || !fs.existsSync(settings.game_exe_path)) {
        return { success: false, message: '游戏路径无效。' };
    }
    shell.openPath(settings.game_exe_path);
    return { success: true, message: '游戏启动中...' };
});

ipcMain.handle('open-folder', (event, args) => {
    const settings = getSettings();
    let target = '';

    // Handle legacy calls (just in case) where args might be a string or null
    if (typeof args === 'string' || args === null) {
        target = args ? path.join(settings.mods_dir, args) : settings.mods_dir;
    } else {
        // Handle new object format
        const { type, modName } = args || {};

        if (type === 'active') {
            if (!settings.active_mods_dir) {
                return { success: false, message: '未设置游戏 Mod 文件夹路径。' };
            }
            target = settings.active_mods_dir;
        } else if (type === 'temp_downloads') {
            // New: Support opening temp downloads
            target = TEMP_DOWNLOADS_DIR;
        } else {
            // Default to 'store' (storage mods_dir)
            if (!settings.mods_dir) {
                return { success: false, message: '未设置 Mod 存储文件夹路径。' };
            }
            target = modName ? path.join(settings.mods_dir, modName) : settings.mods_dir;
        }
    }

    if (!target) return { success: false, message: '路径无效。' };

    // Create directory if it doesn't exist (optional, but good for UX)
    if (!fs.existsSync(target)) {
        try {
            fs.ensureDirSync(target);
        } catch (e) {
            return { success: false, message: `目录不存在且无法创建: ${target}` };
        }
    }

    shell.openPath(target).then(error => {
        if (error) console.error('Failed to open path:', error);
    });

    return { success: true };
});

ipcMain.handle('refresh-mods', async () => {
    const settings = getSettings();
    if (!fs.existsSync(settings.active_mods_dir)) return { success: true };

    const activeMods = await fs.readdir(settings.active_mods_dir);

    // Optimized: Parallelize refresh operations in batches
    // This significantly speeds up the process compared to sequential execution
    const concurrency = 20;
    for (let i = 0; i < activeMods.length; i += concurrency) {
        const batch = activeMods.slice(i, i + concurrency);
        await Promise.all(batch.map(async mod => {
            const modPath = path.join(settings.active_mods_dir, mod);
            try {
                const stats = await fs.lstat(modPath);
                if (stats.isDirectory()) {
                    await reactivateModPackageAsync(mod, settings);
                }
            } catch (e) {
                console.error(`Failed to refresh mod ${mod}:`, e);
                // Continue with other mods even if one fails
            }
        }));
    }
    return { success: true };
});

ipcMain.handle('auto-detect-paths', async () => {
    // 助手函数：检测指定路径是否为有效的游戏目录
    const checkPath = (dir) => {
        try {
            if (activeGameId === 'KCD2') {
                if (fs.existsSync(path.join(dir, 'Bin', 'Win64MasterMasterSteamPGO', 'KingdomCome.exe'))) return true;
            } else {
                // Stellar Blade Logic (Default)
                if (fs.existsSync(path.join(dir, 'SB.exe'))) return true;
                if (fs.existsSync(path.join(dir, 'StellarBlade', 'SB.exe'))) return 'nested';
            }
        } catch (e) { }
        return false;
    };

    // 1. 尝试通过注册表查找 Steam 路径
    let steamPath = null;
    if (process.platform === 'win32') {
        try {
            await new Promise((resolve) => {
                exec('reg query "HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam" /v InstallPath', (error, stdout) => {
                    if (!error && stdout) {
                        const match = stdout.match(/InstallPath\s+REG_SZ\s+(.*)/);
                        if (match && match[1]) steamPath = match[1].trim();
                    }
                    resolve();
                });
            });
        } catch (e) {
            console.error('Registry check failed:', e);
        }
    }

    // Determine Folder Name to search for based on Game
    let targetFolderName = 'StellarBlade';
    if (activeGameId === 'KCD2') {
        targetFolderName = 'KingdomComeDeliverance2';
    }

    // 2. 如果找到了 Steam，检查库文件夹
    if (steamPath) {
        const potentialLibs = [steamPath]; // 包含 Steam 安装目录本身

        // 解析 libraryfolders.vdf
        const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
        if (fs.existsSync(vdfPath)) {
            try {
                const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
                // 简单的正则匹配 "path" "..."
                const pathMatches = [...vdfContent.matchAll(/"path"\s+"(.*)"/g)];
                pathMatches.forEach(m => {
                    if (m[1]) {
                        // VDF 中的路径通常是反斜杠转义的，或者正斜杠
                        let libPath = m[1].replace(/\\\\/g, '\\');
                        if (!potentialLibs.includes(libPath)) potentialLibs.push(libPath);
                    }
                });
            } catch (e) {
                console.error('VDF parsing warning:', e);
            }
        }

        // 遍历所有库
        for (const lib of potentialLibs) {
            const gameDir = path.join(lib, 'steamapps', 'common', targetFolderName);
            const check = checkPath(gameDir);
            if (check === true) return { success: true, game_path: gameDir };
            if (check === 'nested') return { success: true, game_path: path.join(gameDir, targetFolderName) };
        }
    }

    // 3. Fallback: 暴力扫描常见路径（保留原有逻辑作为兜底）
    const drives = [];
    if (process.platform === 'win32') {
        for (let i = 67; i <= 90; i++) { // C to Z
            drives.push(String.fromCharCode(i) + ':');
        }
    } else {
        drives.push('/');
    }

    const commonPaths = [
        `Program Files (x86)/Steam/steamapps/common/${targetFolderName}`,
        `Steam/steamapps/common/${targetFolderName}`,
        `SteamLibrary/steamapps/common/${targetFolderName}`,
        `steamapps/common/${targetFolderName}`,
        `Games/${targetFolderName}`,
        targetFolderName
    ];

    for (const drive of drives) {
        for (const p of commonPaths) {
            const fullPath = path.join(drive, p);
            const check = checkPath(fullPath);
            if (check === true) return { success: true, game_path: fullPath };
            if (check === 'nested') return { success: true, game_path: path.join(fullPath, targetFolderName) };
        }
    }



    return { success: false };
});

// --- 预设功能 IPC Handlers ---

ipcMain.handle('get-presets', async () => {
    try {
        const gamePresetDir = path.join(PRESETS_DIR, activeGameId);
        await fs.ensureDir(gamePresetDir);

        const files = await fs.readdir(gamePresetDir);
        const presets = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const presetData = await fs.readJson(path.join(gamePresetDir, file));
                    presets.push(presetData);
                } catch (e) { /* ignore read error for single files */ }
            }
        }
        // 按创建时间降序排序
        return presets.sort((a, b) => b.created_at - a.created_at);
    } catch (e) {
        console.error('Failed to get presets:', e);
        return [];
    }
});

ipcMain.handle('save-preset', async (event, { name, color, activeMods, activeSubMods }) => {
    try {
        if (!name) return { success: false, message: '预设名称不能为空。' };

        const gamePresetDir = path.join(PRESETS_DIR, activeGameId);
        await fs.ensureDir(gamePresetDir);

        const id = require('crypto').randomUUID();
        const now = Date.now();
        const presetPath = path.join(gamePresetDir, `${id}.json`);

        const presetData = {
            id: id,
            name: name,
            color: color || '#7aa2f7',
            mods: activeMods || [],
            sub_mods: activeSubMods || [],
            created_at: now
        };

        await fs.writeJson(presetPath, presetData, { spaces: 2 });

        return { success: true };
    } catch (e) {
        console.error('Failed to save preset:', e);
        return { success: false, message: e.message };
    }
});

ipcMain.handle('update-preset', async (event, { id, name, color }) => {
    try {
        if (!name) return { success: false, message: '预设名称不能为空。' };

        const gamePresetDir = path.join(PRESETS_DIR, activeGameId);
        const presetPath = path.join(gamePresetDir, `${id}.json`);

        if (await fs.pathExists(presetPath)) {
            const presetData = await fs.readJson(presetPath);
            presetData.name = name;
            presetData.color = color;
            await fs.writeJson(presetPath, presetData, { spaces: 2 });
            return { success: true };
        } else {
            return { success: false, message: '预设文件不存在' };
        }
    } catch (e) {
        console.error('Failed to update preset:', e);
        return { success: false, message: e.message };
    }
});

ipcMain.handle('delete-preset', async (event, id) => {
    try {
        const gamePresetDir = path.join(PRESETS_DIR, activeGameId);
        const presetPath = path.join(gamePresetDir, `${id}.json`);

        if (await fs.pathExists(presetPath)) {
            await fs.remove(presetPath);
        }
        return { success: true };
    } catch (e) {
        console.error('Failed to delete preset:', e);
        return { success: false, message: e.message };
    }
});

ipcMain.handle('get-preset-by-id', async (event, id) => {
    try {
        const gamePresetDir = path.join(PRESETS_DIR, activeGameId);
        const presetPath = path.join(gamePresetDir, `${id}.json`);

        if (await fs.pathExists(presetPath)) {
            return await fs.readJson(presetPath);
        }
        return null;
    } catch (e) {
        console.error('Failed to get preset by id:', e);
        return null;
    }
});

