function registerUiSystemHandlers({
    ipcMain,
    fs,
    path,
    shell,
    exec,
    getSettings,
    getActiveGameId,
    clothingImagesDir,
    tempDownloadsDir,
    reactivateModPackageAsync,
    getDisplayName,
}) {
    ipcMain.handle('list-background-images', () => {
        const settings = getSettings();
        if (!settings.background_images_dir) return [];
        try {
            if (!fs.existsSync(settings.background_images_dir)) return [];
            return fs.readdirSync(settings.background_images_dir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
        } catch (e) {
            console.error('List background images error:', e);
            return [];
        }
    });

    ipcMain.handle('upload-background-image', async (event, filePath) => {
        const settings = getSettings();
        if (!settings.background_images_dir) {
            return { success: false, message: 'Background images directory is not configured.' };
        }
        if (!filePath) {
            return { success: false, message: 'Invalid file path.' };
        }

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
        if (!settings.background_images_dir) {
            return { success: false, message: 'Background images directory is not configured.' };
        }

        const target = path.join(settings.background_images_dir, filename);
        try {
            if (fs.existsSync(target)) {
                fs.removeSync(target);
                return { success: true };
            }
            return { success: false, message: 'File does not exist.' };
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
                url: `media://${path.join(modPath, f)}`,
            }));
    });

    ipcMain.handle('add-mod-preview-image', (event, { modName, filePath }) => {
        const settings = getSettings();
        const modPath = path.join(settings.mods_dir, modName);
        const filename = path.basename(filePath || '');
        const dest = path.join(modPath, filename);

        try {
            if (!fs.existsSync(modPath)) {
                return { success: false, message: 'Mod directory does not exist.' };
            }
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
            if (!fs.existsSync(clothingImagesDir)) return [];
            const files = fs.readdirSync(clothingImagesDir).filter(f => /\.(png|jpg|jpeg|gif|webp|dds)$/i.test(f));
            return files.map(filename => ({
                name: path.parse(filename).name,
                display_name: getDisplayName(path.parse(filename).name),
                url: `media://${path.join(clothingImagesDir, filename)}`,
            }));
        } catch (e) {
            console.error('Error listing clothing images:', e);
            return [];
        }
    });

    ipcMain.handle('launch-game', async () => {
        const settings = getSettings();
        if (!settings.game_exe_path || !fs.existsSync(settings.game_exe_path)) {
            return { success: false, message: 'Game executable path is invalid.' };
        }

        const error = await shell.openPath(settings.game_exe_path);
        if (error) {
            return { success: false, message: error };
        }
        return { success: true, message: 'Game launched.' };
    });

    ipcMain.handle('open-folder', async (event, args) => {
        const settings = getSettings();
        let target = '';

        if (typeof args === 'string' || args === null) {
            target = args ? path.join(settings.mods_dir, args) : settings.mods_dir;
        } else {
            const { type, modName } = args || {};

            if (type === 'active') {
                if (!settings.active_mods_dir) {
                    return { success: false, message: 'Active mods folder is not configured.' };
                }
                target = settings.active_mods_dir;
            } else if (type === 'temp_downloads') {
                target = tempDownloadsDir;
            } else {
                if (!settings.mods_dir) {
                    return { success: false, message: 'Mods directory is not configured.' };
                }
                target = modName ? path.join(settings.mods_dir, modName) : settings.mods_dir;
            }
        }

        if (!target) {
            return { success: false, message: 'Invalid target folder.' };
        }

        if (!fs.existsSync(target)) {
            try {
                fs.ensureDirSync(target);
            } catch (e) {
                return { success: false, message: e.message };
            }
        }

        const error = await shell.openPath(target);
        if (error) {
            return { success: false, message: error };
        }
        return { success: true };
    });

    ipcMain.handle('refresh-mods', async () => {
        const settings = getSettings();
        if (!fs.existsSync(settings.active_mods_dir)) return { success: true };

        const activeMods = await fs.readdir(settings.active_mods_dir);
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
                }
            }));
        }
        return { success: true };
    });

    ipcMain.handle('auto-detect-paths', async () => {
        const activeGameId = getActiveGameId();

        const checkPath = (dir) => {
            try {
                if (activeGameId === 'KCD2') {
                    if (fs.existsSync(path.join(dir, 'Bin', 'Win64MasterMasterSteamPGO', 'KingdomCome.exe'))) return true;
                } else {
                    if (fs.existsSync(path.join(dir, 'SB.exe'))) return true;
                    if (fs.existsSync(path.join(dir, 'StellarBlade', 'SB.exe'))) return 'nested';
                }
            } catch (e) {
                return false;
            }
            return false;
        };

        const steamPath = await new Promise((resolve) => {
            if (process.platform !== 'win32') {
                resolve(null);
                return;
            }

            exec('reg query "HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam" /v InstallPath', (error, stdout) => {
                if (error || !stdout) {
                    resolve(null);
                    return;
                }
                const match = stdout.match(/InstallPath\s+REG_SZ\s+(.*)/);
                resolve(match && match[1] ? match[1].trim() : null);
            });
        });

        let targetFolderName = 'StellarBlade';
        if (activeGameId === 'KCD2') {
            targetFolderName = 'KingdomComeDeliverance2';
        }

        if (steamPath) {
            const potentialLibs = [steamPath];
            const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
            if (fs.existsSync(vdfPath)) {
                try {
                    const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
                    const pathMatches = [...vdfContent.matchAll(/"path"\s+"(.*)"/g)];
                    pathMatches.forEach(m => {
                        if (m[1]) {
                            const libPath = m[1].replace(/\\\\/g, '\\');
                            if (!potentialLibs.includes(libPath)) {
                                potentialLibs.push(libPath);
                            }
                        }
                    });
                } catch (e) {
                    console.error('VDF parsing warning:', e);
                }
            }

            for (const lib of potentialLibs) {
                const gameDir = path.join(lib, 'steamapps', 'common', targetFolderName);
                const check = checkPath(gameDir);
                if (check === true) return { success: true, game_path: gameDir };
                if (check === 'nested') return { success: true, game_path: path.join(gameDir, targetFolderName) };
            }
        }

        const drives = [];
        if (process.platform === 'win32') {
            for (let i = 67; i <= 90; i++) {
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
            targetFolderName,
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
}

module.exports = {
    registerUiSystemHandlers,
};
