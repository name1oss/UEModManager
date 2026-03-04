function registerGameAndWindowHandlers({
    ipcMain,
    dialog,
    fs,
    path,
    getDb,
    dataDir,
    gameCoverDir,
    stateFile,
    rendererDir,
    validateGameConfig,
    ensureSettingsRow,
    getMainWindow,
    getActiveGameId,
    setActiveGameId,
}) {
    const gamesJsonPath = path.join(dataDir, 'games.json');
    const gameJsonDir = path.join(dataDir, 'game');
    fs.ensureDirSync(gameJsonDir);

    function migrateLegacyGamesData() {
        if (!fs.existsSync(gamesJsonPath)) {
            return;
        }

        try {
            const legacyGames = fs.readJsonSync(gamesJsonPath);
            legacyGames.forEach(game => {
                const gamePath = path.join(gameJsonDir, `${game.id}.json`);
                if (!fs.existsSync(gamePath)) {
                    fs.outputJsonSync(gamePath, game, { spaces: 2 });
                }
            });
            fs.renameSync(gamesJsonPath, path.join(dataDir, 'games_backup.json'));
        } catch (error) {
            console.error('Failed to migrate legacy games.json', error);
        }
    }

    function getGamesData() {
        try {
            migrateLegacyGamesData();

            const games = [];
            const files = fs.readdirSync(gameJsonDir);
            files.forEach(file => {
                if (!file.toLowerCase().endsWith('.json')) {
                    return;
                }

                try {
                    const gameData = fs.readJsonSync(path.join(gameJsonDir, file));
                    const validationErrors = validateGameConfig(gameData, file);
                    if (validationErrors.length > 0) {
                        validationErrors.forEach(err => console.error(`[GameConfig] Validation failed: ${err}`));
                        return;
                    }
                    games.push(gameData);
                } catch (error) {
                    console.error(`[GameConfig] Parse failed: ${file}`, error.message);
                }
            });

            if (fs.existsSync(gameCoverDir)) {
                try {
                    const coverFiles = fs.readdirSync(gameCoverDir);
                    games.forEach(game => {
                        const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
                        const matchingFile = coverFiles.find(file => {
                            const parsed = path.parse(file);
                            return parsed.name === game.name && validExtensions.includes(parsed.ext.toLowerCase());
                        });
                        if (matchingFile) {
                            game.cover_image = path.join(gameCoverDir, matchingFile);
                        }
                    });
                } catch (error) {
                    console.error('Error scanning game cover directory:', error);
                }
            }

            return games;
        } catch (error) {
            console.error('Failed to load games data:', error);
            return [];
        }
    }

    function sanitizeGameId(rawId) {
        return String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    }

    function buildGameId(inputId, gameName) {
        const normalizedInputId = sanitizeGameId(inputId);
        if (normalizedInputId) {
            return normalizedInputId;
        }

        const fromName = sanitizeGameId(String(gameName || '').replace(/\s+/g, ''));
        if (fromName) {
            return fromName;
        }

        return `Game${Date.now()}`;
    }

    function getNextSettingsId() {
        const db = getDb();
        const games = getGamesData();
        const usedFromGameConfig = games
            .map(g => Number(g.settings_id))
            .filter(v => Number.isInteger(v) && v > 0);

        const settingsMaxRow = db.prepare('SELECT MAX(id) as max_id FROM settings').get();
        const maxFromSettingsTable = Number(settingsMaxRow?.max_id) || 0;
        const maxUsed = Math.max(maxFromSettingsTable, ...usedFromGameConfig, 0);

        return maxUsed + 1;
    }

    ipcMain.handle('window-minimize', () => {
        const win = getMainWindow();
        if (!win) return { success: false };
        win.minimize();
        return { success: true };
    });

    ipcMain.handle('window-maximize', () => {
        const win = getMainWindow();
        if (!win) return { success: false };
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        return { success: true };
    });

    ipcMain.handle('window-close', () => {
        const win = getMainWindow();
        if (!win) return { success: false };
        win.close();
        return { success: true };
    });

    ipcMain.handle('select-game', async (event, gameId) => {
        const games = getGamesData();
        const game = games.find(g => g.id === gameId);
        if (!game) {
            return { success: false, message: 'Game not found' };
        }

        setActiveGameId(gameId);
        try {
            fs.writeJsonSync(stateFile, { activeGameId: gameId });
        } catch (error) {
            console.error('Failed to save state:', error);
        }

        const win = getMainWindow();
        if (win) {
            win.loadFile(path.join(rendererDir, 'index.html'));
        }

        return { success: true };
    });

    ipcMain.handle('get-active-game-id', () => getActiveGameId());

    ipcMain.handle('return-to-game-select', () => {
        const win = getMainWindow();
        if (win) {
            win.loadFile(path.join(rendererDir, 'game-selector.html'));
        }
        return { success: true };
    });

    ipcMain.handle('get-games-list', () => getGamesData());

    ipcMain.handle('update-game-details', (event, { id, name, description, cover_image }) => {
        try {
            const gamePath = path.join(gameJsonDir, `${id}.json`);
            let gameData = {};

            if (fs.existsSync(gamePath)) {
                gameData = fs.readJsonSync(gamePath);
            } else {
                const existing = getGamesData().find(g => g.id === id);
                if (!existing) {
                    return { success: false, message: 'Game not found' };
                }
                gameData = existing;
            }

            gameData.name = name;
            gameData.description = description;
            gameData.cover_image = cover_image;
            fs.outputJsonSync(gamePath, gameData, { spaces: 2 });

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
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

            const duplicated = getGamesData().some(g => String(g.id).toLowerCase() === gameId.toLowerCase());
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
                    clothingList: false,
                },
                uiConfig: {
                    windowTitle: `${gameName} Mod Manager`,
                    launchButtonText: 'Launch Game',
                    gamePathLabel: `${gameName} Game Root Directory:`,
                },
            };

            const validationErrors = validateGameConfig(gameData, `${gameId}.json`);
            if (validationErrors.length > 0) {
                return { success: false, message: validationErrors.join('; ') };
            }

            fs.outputJsonSync(path.join(gameJsonDir, `${gameId}.json`), gameData, { spaces: 2 });
            ensureSettingsRow(settingsId);

            return { success: true, game: gameData };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('select-image-file', async () => {
        const win = getMainWindow();
        const result = await dialog.showOpenDialog(win, {
            title: 'Select Image',
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'webp'] }],
            properties: ['openFile'],
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, path: result.filePaths[0] };
        }

        return { success: false };
    });

    return {
        getGamesData,
    };
}

module.exports = {
    registerGameAndWindowHandlers,
};
