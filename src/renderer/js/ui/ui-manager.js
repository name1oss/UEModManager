"use strict";

/**
 * UI Manager
 * Centralized management of UI elements that need to update based on game configuration
 */
class UIManager {
    constructor() {
        this.elements = new Map();
        this.elementCache = new Map();
        this.registerElements();
        this.cacheElements();
    }

    /**
     * Register all UI elements that need dynamic updates
     */
    registerElements() {
        // Window Title
        this.elements.set('windowTitle', {
            selector: '#window-title-text',
            updateFn: (el, config) => {
                if (el && config.uiConfig && config.uiConfig.windowTitle) {
                    el.textContent = config.uiConfig.windowTitle;
                }
            }
        });

        // Clothing List Button
        this.elements.set('clothingButton', {
            selector: '.btn-color-clothing',
            updateFn: (el, config) => {
                if (el && config.features) {
                    el.style.display = config.features.clothingList ? 'flex' : 'none';
                }
            }
        });

        // Nexus Mods Button
        this.elements.set('nexusButton', {
            selector: '#openNexusBtn',
            updateFn: (el, config) => {
                if (el && config.nexusUrl) {
                    el.dataset.nexusUrl = config.nexusUrl;
                }
            }
        });

        // Launch Game Button
        this.elements.set('launchButton', {
            selector: '#launchGameBtn',
            updateFn: (el, config) => {
                if (!el) return;

                const icon = el.querySelector('i');
                const iconHtml = icon ? icon.outerHTML : '<i class="fas fa-gamepad"></i>';
                const translatedDefault = (typeof window.t === 'function')
                    ? window.t('sidebar.btn.launch')
                    : 'Launch Game';

                let launchText = translatedDefault;
                if (config && config.uiConfig) {
                    const launchKey = config.uiConfig.launchButtonTextKey || config.uiConfig.launchButtonI18nKey;
                    if (launchKey && typeof window.t === 'function') {
                        launchText = window.t(launchKey);
                    } else if (!translatedDefault || translatedDefault === 'sidebar.btn.launch') {
                        launchText = config.uiConfig.launchButtonText || translatedDefault;
                    }
                }

                el.innerHTML = `${iconHtml} <span>${launchText}</span>`;
            }
        });

        // Game Path Label in Settings
        this.elements.set('gamePathLabel', {
            selector: 'label[for="game_path"]',
            updateFn: (el, config) => {
                if (el && config.uiConfig && config.uiConfig.gamePathLabel) {
                    el.textContent = config.uiConfig.gamePathLabel;
                }
            }
        });
    }

    /**
     * Cache DOM elements to avoid repeated queries
     */
    cacheElements() {
        this.elementCache.clear();
        this.elements.forEach((elementConfig, key) => {
            const el = document.querySelector(elementConfig.selector);
            if (el) {
                this.elementCache.set(key, el);
            } else {
                console.debug(`UIManager: Element not found during caching: ${key} (${elementConfig.selector})`);
            }
        });
        console.log(`UIManager: Cached ${this.elementCache.size} DOM elements`);
    }

    /**
     * Update all registered UI elements based on game configuration
     * @param {GameConfig} gameConfig - The active game configuration
     */
    updateAll(gameConfig) {
        if (!gameConfig) {
            console.warn('UIManager: No game config provided for UI update');
            return;
        }

        console.log(`UIManager: Updating UI for game: ${gameConfig.displayName}`);

        // Use requestAnimationFrame for smooth batch updates
        requestAnimationFrame(() => {
            this.elements.forEach((elementConfig, key) => {
                try {
                    // Try to get from cache first
                    let el = this.elementCache.get(key);

                    // If not in cache, query and update cache
                    if (!el) {
                        el = document.querySelector(elementConfig.selector);
                        if (el) {
                            this.elementCache.set(key, el);
                        }
                    }

                    if (el && elementConfig.updateFn) {
                        elementConfig.updateFn(el, gameConfig);
                    } else if (!el) {
                        console.debug(`UIManager: Element not found for key: ${key} (selector: ${elementConfig.selector})`);
                    }
                } catch (error) {
                    console.error(`UIManager: Error updating element ${key}:`, error);
                }
            });
        });
    }

    /**
     * Register a custom UI element
     * @param {string} key - Unique identifier for this element
     * @param {string} selector - CSS selector
     * @param {Function} updateFn - Function to update the element (el, config) => void
     */
    registerCustomElement(key, selector, updateFn) {
        this.elements.set(key, { selector, updateFn });
    }

    /**
     * Update a single UI element by key
     * @param {string} key - The element key
     * @param {GameConfig} gameConfig - The active game configuration
     */
    updateElement(key, gameConfig) {
        const elementConfig = this.elements.get(key);
        if (!elementConfig) {
            console.warn(`UIManager: No element registered with key: ${key}`);
            return;
        }

        try {
            const el = document.querySelector(elementConfig.selector);
            if (el && elementConfig.updateFn) {
                elementConfig.updateFn(el, gameConfig);
            }
        } catch (error) {
            console.error(`UIManager: Error updating element ${key}:`, error);
        }
    }
}

// Export to global scope
window.UIManager = UIManager;
