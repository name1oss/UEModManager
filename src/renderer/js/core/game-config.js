"use strict";

const gcI18n = (key, vars = {}) => {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
        return window.t(key, vars);
    }
    return key;
};

/**
 * Game Configuration Class
 * Defines the specific behavior and settings for a supported game.
 */
class GameConfig {
    constructor(data) {
        this.id = data.id;
        this.name = data.name || data.displayName || this.id;

        // Merge with defaults to ensure all required properties exist
        const defaults = GameConfig.getDefaults();
        this.displayName = this.name;
        this.nexusUrl = data.nexusUrl || "";
        this.features = { ...defaults.features, ...(data.features || {}) };
        this.uiConfig = {
            ...defaults.uiConfig,
            windowTitle: `${this.name} ${gcI18n('app.window_title_suffix')}`,
            gamePathLabel: `${this.name} ${gcI18n('settings.paths.game.root_label')}`,
            ...(data.uiConfig || {})
        };

        // Custom properties like nameLookupData
        if (data.nameLookupData) {
            this.nameLookupData = data.nameLookupData;
        }
    }

    /**
     * Get default configuration values
     * @returns {Object} Default configuration object
     */
    static getDefaults() {
        return {
            features: {
                clothingList: false,
            },
            uiConfig: {
                windowTitle: gcI18n('app.window_title_suffix'),
                launchButtonText: gcI18n('sidebar.btn.launch'),
                gamePathLabel: gcI18n('settings.paths.game.root_label'),
            }
        };
    }

    /**
     * Validate the game configuration
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validateConfig() {
        const errors = [];

        if (!this.id || typeof this.id !== 'string') {
            errors.push('Invalid or missing game ID');
        }

        if (!this.displayName || typeof this.displayName !== 'string') {
            errors.push('Invalid or missing display name');
        }

        if (!this.uiConfig || typeof this.uiConfig !== 'object') {
            errors.push('Missing UI configuration');
        } else {
            if (!this.uiConfig.windowTitle) errors.push('Missing window title in UI config');
            if (!this.uiConfig.launchButtonText) errors.push('Missing launch button text in UI config');
            if (!this.uiConfig.gamePathLabel) errors.push('Missing game path label in UI config');
        }

        if (!this.features || typeof this.features !== 'object') {
            errors.push('Missing features configuration');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Called when this game is selected.
     * Use this to operate on any non-UI logic if needed.
     */
    activate() {
        const validation = this.validateConfig();
        if (!validation.valid) {
            console.warn(`Game config validation warnings for ${this.id}:`, validation.errors);
        }
        console.log(`Activating game configuration for: ${this.displayName}`);
    }

    /**
     * Auto-detect game paths.
     * Default implementation simply calls the generic IPC with gameId.
     * @returns {Promise<Object>} result object { success, game_path, mods_dir, ... }
     */
    async autoDetectPath() {
        // Default implementation or throw error if must be overridden
        // Passing gameId allows backend to distinct strategy
        return await ipcRenderer.invoke('auto-detect-paths', { gameId: this.id });
    }

    /**
     * Validate if current settings are sufficient for this game.
     * @param {Object} settings - All settings object
     * @returns {boolean} true if valid
     */
    validatePaths(settings) {
        // Default: just check generic keys. 
        // Future improvements: check specific keys like `game_path_${this.id}`
        return settings.game_path && settings.mods_dir;
    }
}

/**
 * Game Manager Registry
 * Singleton to manage available games and the current active game.
 */
class GameManager {
    constructor() {
        this.games = new Map();
        this.activeGameId = null;
        this.uiManager = null; // Will be initialized when UIManager is available
        this.isLoaded = false;
    }

    /**
     * Fetch all games from backend and populate the registry
     */
    async loadGamesFromBackend() {
        try {
            console.log('Fetching games from backend...');
            const gamesData = await ipcRenderer.invoke('get-games-list');
            if (gamesData && Array.isArray(gamesData)) {
                gamesData.forEach(data => {
                    this.registerGame(new GameConfig(data));
                });
            } else {
                console.warn('Received empty or invalid games list from backend.');
            }
            this.isLoaded = true;
        } catch (error) {
            console.error('Error fetching games list from backend:', error);
        }
    }

    /**
     * Initialize UI Manager (called after DOM is ready)
     */
    initializeUIManager() {
        if (window.UIManager) {
            this.uiManager = new window.UIManager();
            console.log('GameManager: UI Manager initialized');
        } else {
            console.warn('GameManager: UIManager class not available');
        }
    }

    registerGame(config) {
        if (!(config instanceof GameConfig)) {
            console.error("Invalid game config registered");
            return;
        }
        this.games.set(config.id, config);
        console.log(`Registered game: ${config.id}`);
    }

    getGame(id) {
        return this.games.get(id);
    }

    /**
     * Switch to a different game with validation and error handling
     * @param {string} gameId - The ID of the game to switch to
     * @returns {Promise<boolean>} true if switch was successful
     */
    async switchGame(gameId) {
        const config = this.games.get(gameId);
        if (!config) {
            console.error(`Game not found: ${gameId}`);
            return false;
        }

        // Validate configuration
        const validation = config.validateConfig();
        if (!validation.valid) {
            console.error(`Invalid game config for ${gameId}:`, validation.errors);
            return false;
        }

        // Save current game state for rollback
        const previousGameId = this.activeGameId;

        try {
            // Update active game
            this.activeGameId = gameId;
            config.activate();

            // Update UI
            if (this.uiManager) {
                await this.uiManager.updateAll(config);
            }

            // Persist to backend
            await ipcRenderer.invoke('set-active-game', { gameId });

            console.log(`Successfully switched to game: ${gameId}`);
            return true;
        } catch (error) {
            console.error(`Failed to switch to game ${gameId}:`, error);

            // Rollback to previous game
            this.activeGameId = previousGameId;
            const previousConfig = this.games.get(previousGameId);
            if (previousConfig && this.uiManager) {
                await this.uiManager.updateAll(previousConfig);
            }

            return false;
        }
    }

    async determineActiveGame() {
        try {
            // Retrieve active game ID from main process via IPC
            let gameId = await ipcRenderer.invoke('get-active-game-id');

            // Fallback to StellarBlade if no game ID is returned
            if (!gameId) {
                console.log("No active game ID returned. Defaulting to StellarBlade.");
                gameId = 'StellarBlade';
            }

            this.activeGameId = gameId;

            let config = this.games.get(gameId);

            // Fallback: if the returned gameId has no config, try StellarBlade
            if (!config) {
                console.warn(`No configuration found for game ID: ${gameId}. Attempting fallback to StellarBlade.`);
                config = this.games.get('StellarBlade');
                if (config) {
                    this.activeGameId = 'StellarBlade';
                }
            }

            if (config) {
                // Validate config before activation
                const validation = config.validateConfig();
                if (!validation.valid) {
                    console.warn(`Config validation issues for ${gameId}:`, validation.errors);
                }

                config.activate();

                // Use UI Manager if available
                if (this.uiManager) {
                    this.uiManager.updateAll(config);
                }
            } else {
                console.error(`Critical: No configuration found for game ID: ${gameId} and fallback failed.`);
            }
            return this.activeGameId;
        } catch (error) {
            console.error("Failed to determine active game:", error);
            // Even on error, try to set a safe default if possible
            if (this.games.has('StellarBlade')) {
                this.activeGameId = 'StellarBlade';
                const config = this.games.get('StellarBlade');
                config.activate();
                if (this.uiManager) {
                    this.uiManager.updateAll(config);
                }
                return 'StellarBlade';
            }
            return null;
        }
    }

    getActiveGameConfig() {
        return this.games.get(this.activeGameId);
    }
}

// Global instance
window.gameManager = new GameManager();
