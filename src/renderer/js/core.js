"use strict";

// ==========================================================================
// CORE
// ==========================================================================

const { ipcRenderer, shell } = require('electron');
const path = require('path');

function tr(keyOrText, vars = {}) {
    if (typeof keyOrText !== 'string') return String(keyOrText ?? '');
    if (typeof t === 'function') return t(keyOrText, vars);
    return keyOrText.replace(/\{(\w+)\}/g, (_, k) =>
        Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
    );
}

// --- Global State Variables ---
let currentParentMod = null;
let lastCheckedMod = null;
let currentSelectedTags = new Set();
let currentSearchQuery = '';
let currentActivationFilter = 'all';
let selectedModNames = new Set();
let isFetchingClothingImages = false;
let allClothingImages = [];
let globalModDetails = [];
let allSubModDetails = [];
let allSimilarGroups = [];
let allAvailableSubMods = [];
let allSimilarGroupsForAdding = [];
let activeSimilarMods = new Set();
let tooltipTimeout;
let contextMenuHideTimeout;
var currentPreviewModImages = [];
var currentPreviewImageIndex = 0;
var previewSlideshowInterval = null;
var draggedItems = [];
var currentSortMethod = 'default';
var isLaunchingGame = false;
var scrollAnimationId = null;
window.SCROLL_ZONE_SIZE = 100;
var MAX_AUTO_SCROLL_SPEED = 25;
var currentScrollSpeed = 0;
var previewTimeout = null;
let PREVIEW_DELAY_MS = 600;
let SLIDESHOW_INTERVAL_MS = 2000;
let debounceTimer;
const DEBOUNCE_DELAY = 300;
let currentSimilarGroupId = null;
let currentSimilarGroupName = null;
let currentSimilarGroupSearchQuery = '';
let renderedItemOrder = [];
let isFileDialogOpen = false;

// Appearance Settings State
let currentTheme = 'tokyo-night';
let currentColorPreset = 'default';
let currentSelectedBackgroundImage = '';
let currentBackgroundOpacity = 1.0;
let currentBackgroundBlur = 0.0;
let isBackgroundImagesLoaded = false;
let lastSavedBgImagesDir = '';
let globalBgImagesDir = '';

let modNameForPreviewManagement = '';
let currentGroupIdForAddingMods = null;

let allModsForAddingToGroup = [];
let draggedSubMod = null;
let windowControlsBound = false;

// --- Electron Window Controls ---
function setupWindowControls() {
    if (windowControlsBound) return;

    document.getElementById('min-btn')?.addEventListener('click', () => {
        ipcRenderer.invoke('window-minimize');
    });
    document.getElementById('max-btn')?.addEventListener('click', () => {
        ipcRenderer.invoke('window-maximize');
    });
    document.getElementById('close-btn')?.addEventListener('click', () => {
        ipcRenderer.invoke('window-close');
    });
    windowControlsBound = true;
}

// --- IPC Wrapper ---
async function callIPC(channel, args = {}, onSuccess = null, buttonElement = null, suppressGlobalLoader = false) {
    let showGlobalLoader = true;

    // If a button is provided, show loading state on the button only.
    if (buttonElement) {
        showGlobalLoader = false;
        buttonElement.disabled = true;
        buttonElement.classList.add('loading');
        if (!buttonElement.dataset.originalContent) {
            buttonElement.dataset.originalContent = buttonElement.innerHTML;
        }
        // Keep width stable to avoid layout shift.
        const rect = buttonElement.getBoundingClientRect();
        buttonElement.style.minWidth = `${rect.width}px`;
        buttonElement.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i>`;
    } else if (suppressGlobalLoader) {
        showGlobalLoader = false;
    } else {
        showLoadingOverlay();
    }

    try {
        const result = await ipcRenderer.invoke(channel, args);

        if (result && result.success !== false) {
            if (onSuccess) onSuccess(result);
        } else {
            if (result.is_locked) {
                showToast(result.message, 'error', 5000);
            } else if (result.conflict_type === 'file') {
                if (onSuccess) onSuccess(result);
                else showToast(result.message || t('toast.operation.failed'), 'error');
            } else {
                if (result.message !== t('dialog.no_folder_selected')) {
                    showToast(result.message || t('toast.operation.failed'), 'error');
                }
            }
        }
    } catch (error) {
        console.error(`IPC Error [${channel}]:`, error);
        showToast('toast.system.error', 'error', 3000, { message: error.message });
    } finally {
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.classList.remove('loading');
            buttonElement.style.minWidth = '';
            if (buttonElement.dataset.originalContent) {
                buttonElement.innerHTML = buttonElement.dataset.originalContent;
            }
        }
        if (showGlobalLoader) {
            hideLoadingOverlay();
        }
    }
}

// --- Toast & Modal ---
function showToast(message, type = 'info', duration = 3000, vars = {}) {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let iconClass = 'fas fa-info-circle';
    let iconColor = 'var(--accent-blue)';

    if (type === 'success') { iconClass = 'fas fa-check-circle'; iconColor = 'var(--accent-green)'; }
    if (type === 'error') { iconClass = 'fas fa-times-circle'; iconColor = 'var(--accent-red)'; }
    if (type === 'warning') { iconClass = 'fas fa-exclamation-triangle'; iconColor = 'var(--accent-yellow)'; }

    toast.innerHTML = `<i class="${iconClass}" style="color: ${iconColor}; font-size: 1.2em;"></i><span style="flex:1;">${tr(message, vars)}</span>`;
    toastContainer.appendChild(toast);

    void toast.offsetWidth; // Trigger reflow
    toast.style.transform = 'translateX(0)';
    toast.style.opacity = '1';

    if (duration > 0) {
        setTimeout(() => { dismissToast(toast); }, duration);
    }
    return toast;
}

function dismissToast(toastElement) {
    if (toastElement) {
        toastElement.style.transform = 'translateX(100%)';
        toastElement.style.opacity = '0';
        toastElement.addEventListener('transitionend', () => toastElement.remove());
    }
}

function showMessage(title, message, vars = {}) {
    const modal = document.getElementById('messageModal');
    document.getElementById('messageModalTitle').textContent = tr(title, vars);
    document.getElementById('messageModalContent').innerHTML = tr(message, vars);
    modal.style.display = 'flex';
}

function showConfirm(title, message, vars = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmModalTitle').textContent = tr(title, vars);
        document.getElementById('confirmModalContent').innerHTML = tr(message, vars);
        const confirmBtn = document.getElementById('confirmModalConfirmBtn');
        const cancelBtn = document.getElementById('confirmModalCancelBtn');

        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

        newConfirmBtn.addEventListener('click', () => { closeModal('confirmModal'); resolve(true); });
        newCancelBtn.addEventListener('click', () => { closeModal('confirmModal'); resolve(false); });
        modal.style.display = 'flex';
    });
}

// --- Core Utility Functions (Moved from ui-interactions.js to ensure global access for all files) ---

function normalize_string(s) {
    if (typeof s !== 'string') return '';
    s = s.replace(/^\d+[_\- ]*/, '');
    return s.replace(/[() ]/g, '').toLowerCase();
}

// Convert local path to media URL.
function formatLocalPathForUrl(url) {
    if (!url) return '';
    let cleanPath = url.replace(/^media:\/\//, '');
    cleanPath = cleanPath.replace(/\\/g, '/');
    const encodedPath = cleanPath.split('/').map(part => encodeURIComponent(part)).join('/');
    return `media://${encodedPath}`;
}

function showLoadingOverlay(message = 'loading.processing') {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    const loadingText = overlay.querySelector('.loading-text');
    if (loadingText) {
        loadingText.textContent = tr(message);
    }
    overlay.classList.add('show');
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    // Reset to default message
    const loadingText = overlay.querySelector('.loading-text');
    if (loadingText) {
        loadingText.textContent = tr('loading.processing');
    }
}

// --- Keyboard Shortcuts ---
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore shortcuts when typing in input fields (except Escape)
        const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

        // Escape: Close modals or clear selection
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal[style*="display: flex"], .modal[style*="display:flex"]');
            if (openModal) {
                const modalId = openModal.id;
                closeModal(modalId);
            } else if (selectedModNames.size > 0) {
                clearAllSelections();
            }
            return;
        }

        // Don't process other shortcuts if typing in input
        if (isInputFocused && e.key !== 'Escape') return;

        // Ctrl+F: Focus search
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }

        // Ctrl+Z: Undo last action
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            if (window.undoManager) {
                window.undoManager.undo();
            }
        }

        // Ctrl+A: Select all visible mods
        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            document.querySelectorAll('.mod-item:not(.sub-mod-item)').forEach(item => {
                const modName = item.dataset.modName;
                const checkbox = item.querySelector('.mod-checkbox');
                if (modName && checkbox) {
                    selectedModNames.add(modName);
                    checkbox.checked = true;
                }
            });
            updateAllVisualSelections();
            updateSelectionDependentButtons();
        }

        // Delete: Delete selected mods (with confirmation)
        if (e.key === 'Delete' && selectedModNames.size > 0) {
            e.preventDefault();
            const selectedArray = Array.from(selectedModNames);
            if (selectedArray.length === 1) {
                deleteMod(selectedArray[0]);
            } else {
                showConfirm('confirm.batch_delete.title', 'confirm.batch_delete.msg', { count: selectedArray.length }).then(confirmed => {
                    if (confirmed) {
                        // Delete mods sequentially
                        let deleteCount = 0;
                        selectedArray.forEach(modName => {
                            callIPC('delete-mod', { modName, isSubMod: false, parentModName: null }, (result) => {
                                deleteCount++;
                                if (deleteCount === selectedArray.length) {
                                    showToast('toast.batch_delete.success', 'success', 3000, { count: deleteCount });
                                    selectedModNames.clear();
                                    loadAndRenderModList();
                                    refreshTagFilters();
                                }
                            }, null, true);
                        });
                    }
                });
            }
        }

        // Space: Toggle activation of selected mod (if only one selected)
        if (e.key === ' ' && selectedModNames.size === 1 && !isInputFocused) {
            e.preventDefault();
            const modName = Array.from(selectedModNames)[0];
            const modItem = document.querySelector(`.mod-item[data-mod-name="${modName}"]`);
            if (modItem) {
                const isActive = modItem.dataset.isActive === 'true';
                toggleModActivation(modName, isActive);
            }
        }
    });
}

// --- Initialization ---

// Note: Functions like toggleModActivation, openBatchTaggingModal, etc. 
// are now expected to be defined in ui-modals.js and ui-preview-drag-and-drop.js

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', handler);
        };

        // --- i18n: translate all [data-i18n] elements and highlight active language ---
        if (typeof applyI18n === 'function') {
            applyI18n();
        }
        // Highlight the currently active language button in Settings
        const currentLang = typeof getCurrentLang === 'function' ? getCurrentLang() : 'zh-CN';
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === currentLang);
        });

        // Step 1: Setup window controls
        setupWindowControls();

        // Step 2: Initialize Game Manager and UI Manager
        if (!window.gameManager) {
            throw new Error('GameManager not initialized! Ensure game-config.js is loaded.');
        }

        window.gameManager.initializeUIManager();

        // 2) Load games data from JSON configs through backend
        if (!window.gameManager.isLoaded) {
            await window.gameManager.loadGamesFromBackend();
        }

        // Step 3: Show loading state
        showLoadingOverlay('loading.game_config');

        // 3) Retrieve last active game ID
        const gameId = await window.gameManager.determineActiveGame();

        if (!gameId) {
            throw new Error(t('error.active_game.unknown'));
        }

        console.log(`Active game determined: ${gameId}`);

        // Step 5: Validate game configuration
        const activeConfig = window.gameManager.getActiveGameConfig();
        if (activeConfig) {
            const validation = activeConfig.validateConfig();
            if (!validation.valid) {
                console.warn('Active game config has validation issues:', validation.errors);
            }
        }

        // Hide loading overlay before continuing with other initializations
        hideLoadingOverlay();

        // Event listeners are updated to use globally available functions
        const sidebarEditTagsBtn = document.getElementById('sidebarEditTagsBtn');
        if (sidebarEditTagsBtn) {
            sidebarEditTagsBtn.addEventListener('click', () => {
                if (typeof openBatchTaggingModal === 'function') {
                    openBatchTaggingModal();
                } else {
                    console.error('openBatchTaggingModal function not found. Check if mod-manager.js is loaded.');
                    showToast('feature.tags_unavailable', 'error');
                }
            });
        }
        const sidebarAddSubModBtn = document.getElementById('sidebarAddSubModBtn');
        if (sidebarAddSubModBtn) {
            sidebarAddSubModBtn.addEventListener('click', () => {
                if (typeof openAddSubModModal === 'function') {
                    openAddSubModModal();
                } else {
                    console.error('openAddSubModModal function not found.');
                    showToast('feature.add_submod_unavailable', 'error');
                }
            });
        }
        const sidebarAddToSimilarModBtn = document.getElementById('sidebarAddToSimilarModBtn');
        if (sidebarAddToSimilarModBtn) {
            sidebarAddToSimilarModBtn.addEventListener('click', () => {
                if (typeof openAddToSimilarModGroupModal === 'function') {
                    openAddToSimilarModGroupModal();
                } else {
                    console.error('openAddToSimilarModGroupModal function not found.');
                    showToast('feature.add_to_group_unavailable', 'error');
                }
            });
        }
        const sidebarCreateSimilarModGroupBtn = document.getElementById('sidebarCreateSimilarModGroupBtn');
        if (sidebarCreateSimilarModGroupBtn) {
            sidebarCreateSimilarModGroupBtn.addEventListener('click', () => {
                if (typeof openSimilarModManagementModal === 'function') {
                    openSimilarModManagementModal();
                } else {
                    console.error('openSimilarModManagementModal function not found.');
                    showToast('feature.group_manage_unavailable', 'error');
                }
            });
        }
        bindClick('settingsBtn', openSettingsModal);
        bindClick('addModBtn', addModFolder);
        bindClick('sidebarManageSimilarModsBtn', openSimilarModManagementModal);
        bindClick('launchGameBtn', launchGame);
        bindClick('refreshModsBtn', refreshAllMods);

        // --- Modified Nexus Mods Button Logic (In-App Browser) ---
        const openNexusBtn = document.getElementById('openNexusBtn');
        if (openNexusBtn) {
            openNexusBtn.addEventListener('click', async () => {
                const modal = document.getElementById('webBrowserModal');
                const webview = document.getElementById('nexusWebview');
                const loader = document.getElementById('webviewLoading');

                if (modal && webview) {
                    modal.style.display = 'flex';

                    const config = window.gameManager ? window.gameManager.getActiveGameConfig() : null;
                    const targetUrl = config ? config.nexusUrl : 'https://www.nexusmods.com/stellarblade/mods/';
                    const gameId = config ? config.id : 'StellarBlade';

                    const currentUrl = webview.getAttribute('src');

                    if (!currentUrl || currentUrl === 'about:blank') {
                        webview.setAttribute('src', targetUrl);
                        webview.dataset.lastGameId = gameId;
                    } else {
                        const lastGame = webview.dataset.lastGameId;
                        if (lastGame !== gameId) {
                            webview.setAttribute('src', targetUrl);
                            webview.dataset.lastGameId = gameId; // Update state
                        }
                    }

                    if (!webview.dataset.listenersAttached) {
                        webview.addEventListener('did-start-loading', () => {
                            if (loader) loader.style.display = 'flex';
                        });
                        webview.addEventListener('did-stop-loading', () => {
                            if (loader) loader.style.display = 'none';
                        });

                        webview.addEventListener('new-window', (e) => {
                            const { protocol } = new URL(e.url);
                            if (protocol === 'http:' || protocol === 'https:') {
                                webview.setAttribute('src', e.url);
                            }
                        });

                        webview.dataset.listenersAttached = 'true';
                    }
                }
            });
        }

        // Preview image controls now call the functions in ui-preview-drag-and-drop.js
        bindClick('prevImageBtn', showPreviousPreviewImage);
        bindClick('nextImageBtn', showNextPreviewImage);

        // --- IPC Event Listeners for Download Handling ---
        // Listen for download events from the backend (main.js)
        ipcRenderer.on('download-started', (event, data) => {
            // Main Popup
            const popup = document.getElementById('downloadProgressPopup');
            const fileNameEl = document.getElementById('downloadFileNameProgress');
            const percentEl = document.getElementById('downloadPercent');
            const progressBar = document.getElementById('downloadProgressBar');

            // Nexus Popup
            const popupNexus = document.getElementById('downloadProgressPopupNexus');
            const fileNameElNexus = document.getElementById('downloadFileNameProgressNexus');
            const percentElNexus = document.getElementById('downloadPercentNexus');
            const progressBarNexus = document.getElementById('downloadProgressBarNexus');

            if (popup && fileNameEl && percentEl && progressBar) {
                fileNameEl.textContent = data.filename;
                percentEl.textContent = '0%';
                progressBar.style.width = '0%';
                popup.style.display = 'flex';
            }

            if (popupNexus && fileNameElNexus && percentElNexus && progressBarNexus) {
                fileNameElNexus.textContent = data.filename;
                percentElNexus.textContent = '0%';
                progressBarNexus.style.width = '0%';
                popupNexus.style.display = 'flex';
            }
        });

        ipcRenderer.on('download-progress', (event, data) => {
            const percentEl = document.getElementById('downloadPercent');
            const progressBar = document.getElementById('downloadProgressBar');

            const percentElNexus = document.getElementById('downloadPercentNexus');
            const progressBarNexus = document.getElementById('downloadProgressBarNexus');

            const percent = Math.round(data.progress * 100);

            if (percentEl && progressBar) {
                percentEl.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
            }

            if (percentElNexus && progressBarNexus) {
                percentElNexus.textContent = `${percent}%`;
                progressBarNexus.style.width = `${percent}%`;
            }
        });

        ipcRenderer.on('download-complete-selection', (event, data) => {
            // Hide progress popups
            const popup = document.getElementById('downloadProgressPopup');
            const popupNexus = document.getElementById('downloadProgressPopupNexus');
            if (popup) popup.style.display = 'none';
            if (popupNexus) popupNexus.style.display = 'none';

            // Show file selection modal
            // openDownloadSelectionModal is defined in ui-interactions.js
            if (typeof openDownloadSelectionModal === 'function') {
                openDownloadSelectionModal(data);
            } else {
                console.error('openDownloadSelectionModal function not found');
                showToast('download.toast.selection_ui_failed', 'error');
            }
        });

        ipcRenderer.on('download-complete-single', (event, data) => {
            // Hide progress popups
            const popup = document.getElementById('downloadProgressPopup');
            const popupNexus = document.getElementById('downloadProgressPopupNexus');
            if (popup) popup.style.display = 'none';
            if (popupNexus) popupNexus.style.display = 'none';

            // For non-archive files, show a simple notification
            showToast('download.toast.file_completed', 'info', 5000, { filename: data.originalFilename });
        });

        ipcRenderer.on('download-failed', (event, data) => {
            const popup = document.getElementById('downloadProgressPopup');
            const popupNexus = document.getElementById('downloadProgressPopupNexus');
            if (popup) popup.style.display = 'none';
            if (popupNexus) popupNexus.style.display = 'none';

            showToast('download.toast.failed', 'error', 3000, { filename: data.filename });
        });

        ipcRenderer.on('download-interrupted', (event, data) => {
            const popup = document.getElementById('downloadProgressPopup');
            const popupNexus = document.getElementById('downloadProgressPopupNexus');
            if (popup) popup.style.display = 'none';
            if (popupNexus) popupNexus.style.display = 'none';

            showToast('download.toast.interrupted', 'warning', 3000, { filename: data.filename });
        });

        ipcRenderer.on('download-error', (event, data) => {
            const popup = document.getElementById('downloadProgressPopup');
            if (popup) popup.style.display = 'none';

            // Use message modal for multi-line details.
            if (data.message && data.message.includes('\n')) {
                showMessage('download.error.title', data.message.replace(/\n/g, '<br>'));
            } else {
                showToast(data.message || t('download.toast.error_generic'), 'error');
            }
        });

        // This function remains here but relies on functions defined in other files
        setupModListEventListeners();
        // This function is moved to ui-preview-drag-and-drop.js
        setupDropdownMenu();
        // This function is moved to ui-preview-drag-and-drop.js
        setupContextMenuEventListeners();

        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            // changeSortOrder is in ui-preview-drag-and-drop.js
            sortSelect.addEventListener('change', (e) => changeSortOrder(e.target.value));
            sortSelect.value = currentSortMethod;
        }

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = currentSearchQuery;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(performSearch, DEBOUNCE_DELAY);
            });
        }

        document.body.addEventListener('click', (e) => {
            // hideContextMenu is in ui-preview-drag-and-drop.js
            if (!e.target.closest('#contextMenu')) hideContextMenu();
            // clearAllSelections is in mod-manager.js
            if (!e.target.closest('.mod-list, .sidebar, .modal, .main-header, #backToTopBtn, #sortSelect, #contextMenu, .dropdown')) {
                clearAllSelections();
            }
        });

        // handleContextMenu is in ui-preview-drag-and-drop.js
        document.addEventListener('contextmenu', handleContextMenu);

        // Back-to-top behavior.
        const scrollContainer = document.querySelector('.mod-list-scroll-area');
        const backToTopBtn = document.getElementById("backToTopBtn");

        if (scrollContainer && backToTopBtn) {
            let isScrolling = false;

            scrollContainer.addEventListener('scroll', () => {
                if (!isScrolling) {
                    window.requestAnimationFrame(() => {
                        if (scrollContainer.scrollTop > 300) {
                            backToTopBtn.classList.add('show');
                        } else {
                            backToTopBtn.classList.remove('show');
                        }
                        isScrolling = false;
                    });
                    isScrolling = true;
                }
            }, { passive: true });

            backToTopBtn.onclick = () => {
                scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }

        // initializeAppearance is in ui-modals.js
        await initializeAppearance();
        // setupAppearanceControlListeners is in ui-modals.js
        setupAppearanceControlListeners();
        // Setup keyboard shortcuts
        setupKeyboardShortcuts();
        document.addEventListener('keydown', handleEscapeKey);

        // updateReturnAllModsButtonVisibility is in mod-manager.js
        updateReturnAllModsButtonVisibility();

        // loadAndRenderModList, refreshTagFilters are in mod-manager.js
        await loadAndRenderModList();
        await refreshTagFilters();

        // checkGamePathValidity is in ui-modals.js
        await checkGamePathValidity();

        // handleNewPreviewImageSelect is in ui-preview-drag-and-drop.js
        const previewImageUploadInput = document.getElementById('previewImageUploadInput');
        if (previewImageUploadInput) {
            previewImageUploadInput.addEventListener('change', handleNewPreviewImageSelect);
        }
    } catch (error) {
        console.error('App initialization failed:', error);
        hideLoadingOverlay();
        showToast('app.init.failed', 'error', 10000);
    }
});

function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        if (document.getElementById('contextMenu').style.display === 'block') {
            // hideContextMenu is in ui-preview-drag-and-drop.js
            hideContextMenu();
            return;
        }
        const modals = document.querySelectorAll('.modal');
        for (let i = modals.length - 1; i >= 0; i--) {
            if (modals[i].style.display === 'flex' || modals[i].style.display === 'block') {
                if (modals[i].id === 'modPreviewModal') {
                    // Keep selection when closing preview.
                } else {
                    // Other modals can keep default close behavior.
                }
                // closeModal is in ui-modals.js
                closeModal(modals[i].id);
                break;
            }
        }
    }
}

// --- Logic (Mod List Event Listeners - Relies on functions in other files) ---

function setupModListEventListeners() {
    const modListContainer = document.querySelector('.mod-list');
    if (!modListContainer) return;

    modListContainer.addEventListener('click', (e) => {
        const target = e.target;
        const statusButton = target.closest('.mod-status, .sub-mod-status');
        const toggleIcon = target.closest('.toggle-icon');
        const clickedItem = target.closest('.mod-item, .sub-mod-item');

        // Click empty area to clear selection.
        if (!clickedItem) {
            clearAllSelections();
            return;
        }

        const modItem = clickedItem.closest('.mod-item');

        if (toggleIcon && modItem) {
            e.stopPropagation();
            // toggleSubMods is in mod-manager.js
            toggleSubMods(modItem.dataset.modName);
        } else if (statusButton) {
            e.stopPropagation();
            const subModItem = target.closest('.sub-mod-item');
            if (subModItem && modItem) {
                if (modItem.dataset.isActive === 'true') {
                    // toggleSubModStatus is in mod-manager.js
                    toggleSubModStatus(modItem.dataset.modName, subModItem.dataset.subModName, statusButton);
                } else {
                    showToast('toast.submod.require_parent_active', 'warning');
                }
            } else if (modItem) {
                // toggleModActivation is in mod-manager.js
                toggleModActivation(modItem.dataset.modName, modItem.dataset.isActive === 'true', statusButton);
            }
        } else {
            // handleSelectionClick is in mod-manager.js
            handleSelectionClick(e, clickedItem);
        }
    });

    // OPTIMIZED: Track current hovered item to prevent flickering
    let currentHoveredMod = null;

    modListContainer.addEventListener('mouseover', (e) => {
        const item = e.target.closest('.mod-item, .sub-mod-item');
        if (item) {
            // Optimization: If we are already hovering this item, ignore bubbling events from children
            if (currentHoveredMod === item) return;

            currentHoveredMod = item;
            // handleModMouseEnter is in ui-interactions.js
            handleModMouseEnter(e, item);
        }
    });

    modListContainer.addEventListener('mouseout', (e) => {
        const item = e.target.closest('.mod-item, .sub-mod-item');
        if (item) {
            // Crucial Fix: Check if we are moving TO a child element of the same item (e.relatedTarget)
            // or if we are moving FROM a child element to the parent.
            // "contains" handles checking if the new target is inside the item.
            if (e.relatedTarget && item.contains(e.relatedTarget)) {
                return;
            }

            // We have truly left the item
            currentHoveredMod = null;
            // handleModMouseLeave is in ui-interactions.js
            handleModMouseLeave();
        }
    });

    // Track mouse movement to update preview position.
    modListContainer.addEventListener('mousemove', (e) => {
        const container = document.getElementById('modPreviewContainer');
        // Ensure preview container exists and is visible.
        if (container && container.classList.contains('visible')) {
            // updatePreviewPosition is defined in ui-interactions.js.
            if (typeof updatePreviewPosition === 'function') {
                updatePreviewPosition(e);
            }
        }
    });
}

// --- Functions that remain in core.js and are called elsewhere ---

function refreshAllMods() {
    // refreshAllMods relies on showConfirm and loadAndRenderModList from mod-manager.js
    // and callIPC, showToast from core.js. It remains here to encapsulate the high-level refresh logic.
    showConfirm('refresh.confirm.title', 'refresh.confirm.msg').then(confirmed => {
        if (confirmed) {
            callIPC('refresh-mods', {}, () => {
                showToast('toast.refresh.success', 'success');
                loadAndRenderModList();
                refreshTagFilters();
            }, document.getElementById('refreshModsBtn'));
        }
    });
}

async function addModFolder() {
    // addModFolder relies on callIPC, showToast from core.js and loadAndRenderModList, refreshTagFilters from mod-manager.js
    if (isFileDialogOpen) return;
    isFileDialogOpen = true;

    const buttonElement = document.getElementById('addModBtn');

    // Manually control button loading state so it is reset in finally.
    if (buttonElement) {
        buttonElement.disabled = true;
        if (!buttonElement.dataset.originalContent) {
            buttonElement.dataset.originalContent = buttonElement.innerHTML;
        }
        const rect = buttonElement.getBoundingClientRect();
        buttonElement.style.minWidth = `${rect.width}px`;
        buttonElement.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i>`;
    }

    try {
        const result = await ipcRenderer.invoke('add-mod-folder', {});

        if (result.success) {
            showToast(result.message, 'success', 6000);
            loadAndRenderModList();
            refreshTagFilters();
        } else if (result.message !== t('dialog.no_folder_selected')) {
            showToast(result.message, 'warning');
        }
    } catch (error) {
        console.error('Error adding mod folder:', error);
        showToast('toast.system.error', 'error', 3000, { message: error.message });
    } finally {
        // Always reset the dialog-open flag.
        isFileDialogOpen = false;
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.style.minWidth = '';
            if (buttonElement.dataset.originalContent) {
                buttonElement.innerHTML = buttonElement.dataset.originalContent;
            }
        }
    }
}

// Preset apply progress listener.
ipcRenderer.on('preset-progress', (event, pct) => {
    const loader = document.querySelector('#loadingOverlay .loading-text');
    if (loader) loader.textContent = t('loading.preset_apply', { pct });
});
