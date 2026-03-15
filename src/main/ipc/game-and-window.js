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
                    const filePath = path.join(gameJsonDir, file);
                    migrateGameConfigFile(filePath);
                    const gameData = fs.readJsonSync(filePath);
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

            games.sort((a, b) => {
                const aOrder = Number(a?.sort_order);
                const bOrder = Number(b?.sort_order);
                const hasA = Number.isFinite(aOrder);
                const hasB = Number.isFinite(bOrder);

                if (hasA && hasB && aOrder !== bOrder) {
                    return aOrder - bOrder;
                }
                if (hasA && !hasB) return -1;
                if (!hasA && hasB) return 1;

                const aName = String(a?.name || a?.id || '');
                const bName = String(b?.name || b?.id || '');
                return aName.localeCompare(bName, 'zh-CN');
            });

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

    function normalizeFeatures(featuresInput) {
        const source = (featuresInput && typeof featuresInput === 'object' && !Array.isArray(featuresInput))
            ? featuresInput
            : {};

        return {
            ...source,
            clothingList: Boolean(source.clothingList),
        };
    }

    function stripDerivedGameFields(gameData) {
        if (!gameData || typeof gameData !== 'object' || Array.isArray(gameData)) {
            return false;
        }

        let changed = false;

        if (Object.prototype.hasOwnProperty.call(gameData, 'displayName')) {
            delete gameData.displayName;
            changed = true;
        }

        if (Object.prototype.hasOwnProperty.call(gameData, 'uiConfig')) {
            const uiConfig = gameData.uiConfig;
            if (uiConfig && typeof uiConfig === 'object' && !Array.isArray(uiConfig)) {
                const beforeCount = Object.keys(uiConfig).length;
                delete uiConfig.windowTitle;
                delete uiConfig.launchButtonText;
                delete uiConfig.gamePathLabel;
                const afterCount = Object.keys(uiConfig).length;

                if (beforeCount !== afterCount) {
                    changed = true;
                }

                if (afterCount === 0) {
                    delete gameData.uiConfig;
                    changed = true;
                }
            } else {
                delete gameData.uiConfig;
                changed = true;
            }
        }

        return changed;
    }

    function migrateGameConfigFile(filePath) {
        try {
            const gameData = fs.readJsonSync(filePath);
            const changed = stripDerivedGameFields(gameData);
            if (changed) {
                fs.outputJsonSync(filePath, gameData, { spaces: 2 });
            }
        } catch (error) {
            console.error(`[GameConfig] Migration failed: ${path.basename(filePath)}`, error.message);
        }
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

    function getNextGameSortOrder() {
        const games = getGamesData();
        const maxSortOrder = games.reduce((max, game) => {
            const value = Number(game?.sort_order);
            return Number.isFinite(value) ? Math.max(max, value) : max;
        }, 0);
        return maxSortOrder + 1;
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

    ipcMain.handle('update-game-details', (event, payload = {}) => {
        try {
            const {
                id,
                name,
                description,
                cover_image,
                executable,
                nexusUrl,
                features,
            } = payload;
            const gameName = String(name || '').trim();
            if (!id || !gameName) {
                return { success: false, message: 'Game ID or name is invalid' };
            }

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

            gameData.name = gameName;
            gameData.description = String(description || '').trim();
            gameData.cover_image = String(cover_image || '').trim();
            gameData.executable = String(executable || '').trim() || String(gameData.executable || '').trim() || `${gameData.id}.exe`;
            gameData.nexusUrl = nexusUrl === undefined
                ? String(gameData.nexusUrl || '').trim()
                : String(nexusUrl || '').trim();
            gameData.features = normalizeFeatures(features !== undefined ? features : gameData.features);
            const currentSortOrder = Number(gameData.sort_order);
            if (!Number.isFinite(currentSortOrder)) {
                gameData.sort_order = getNextGameSortOrder();
            }

            // These labels are derived from game name and i18n at runtime; no longer persist them in JSON.
            stripDerivedGameFields(gameData);

            const currentSettingsId = Number(gameData.settings_id);
            if (!Number.isInteger(currentSettingsId) || currentSettingsId <= 0) {
                gameData.settings_id = getNextSettingsId();
            }

            const validationErrors = validateGameConfig(gameData, `${id}.json`);
            if (validationErrors.length > 0) {
                return { success: false, message: validationErrors.join('; ') };
            }

            fs.outputJsonSync(gamePath, gameData, { spaces: 2 });
            ensureSettingsRow(gameData.settings_id);

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('add-game', (event, { id, name, description, executable, cover_image, nexusUrl }) => {
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
                sort_order: getNextGameSortOrder(),
                nexusUrl: String(nexusUrl || '').trim(),
                features: normalizeFeatures({}),
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

    ipcMain.handle('save-games-order', (event, payload = {}) => {
        try {
            const order = Array.isArray(payload.order)
                ? payload.order.map(id => String(id || '').trim()).filter(Boolean)
                : [];

            if (!order.length) {
                return { success: false, message: 'Order list is empty' };
            }

            const games = getGamesData();
            const gameById = new Map(games.map(game => [String(game.id), game]));
            const visited = new Set();
            let rank = 1;

            for (const id of order) {
                const game = gameById.get(id);
                if (!game || visited.has(id)) continue;
                game.sort_order = rank++;
                fs.outputJsonSync(path.join(gameJsonDir, `${game.id}.json`), game, { spaces: 2 });
                visited.add(id);
            }

            for (const game of games) {
                const id = String(game.id);
                if (visited.has(id)) continue;
                game.sort_order = rank++;
                fs.outputJsonSync(path.join(gameJsonDir, `${game.id}.json`), game, { spaces: 2 });
            }

            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    return {
        getGamesData,
    };
}

module.exports = {
    registerGameAndWindowHandlers,
};
