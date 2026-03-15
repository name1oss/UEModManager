// ==========================================================================
// UI MODALS & SETTINGS LOGIC
// ==========================================================================

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
    if (['renameModal', 'batchTaggingModal', 'addSubModModal', 'similarModManagementModal', 'addToSimilarModGroupModal', 'editPreviewImageModal', 'modPreviewModal', 'addModsToGroupModal', 'clothingImageModal', 'downloadSelectionModal'].includes(modalId)) {
        // Fix: Do NOT clear selections on close. Selections should only be cleared on SUCCESSFUL operations.
        // clearAllSelections();
    }
    if (modalId === 'modPreviewModal') {
        currentPreviewModImages = [];
        currentPreviewImageIndex = 0;
        const container = document.getElementById('modPreviewImagesContainer');
        if (container) container.innerHTML = '';
    }
    if (modalId === 'fileConflictModal') {
        const forceActivateBtn = document.getElementById('fileConflictModalForceActivateBtn');
        if (forceActivateBtn) forceActivateBtn.classList.add('hidden');
    }
    if (modalId === 'editPreviewImageModal') {
        const fileInput = document.getElementById('previewImageUploadInput');
        if (fileInput) fileInput.value = '';
        modNameForPreviewManagement = '';
        document.getElementById('uploadPreviewBtn').style.display = 'none';
        document.getElementById('selectedFileName').textContent = '';
    }

    // 下载模态框的清�?
    if (modalId === 'downloadSelectionModal') {
        currentDownloadData = null;
        const treeContainer = document.getElementById('downloadFileTree');
        if (treeContainer) treeContainer.innerHTML = '';
    }
    hideLoadingOverlay();
}

function applyTagColors() {
    const tagColorClasses = Array.from({ length: 6 }, (_, i) => `tag-color-${i}`); // Matches CSS 0-5
    const tagColorMap = new Map();
    let colorIndex = 0;
    const getColorClass = (tagName) => {
        if (!tagColorMap.has(tagName)) {
            tagColorMap.set(tagName, tagColorClasses[colorIndex % tagColorClasses.length]);
            colorIndex++;
        }
        return tagColorMap.get(tagName);
    };
    document.querySelectorAll('.tag[data-tag-name]').forEach(tagEl => {
        // Clear previous color classes
        tagColorClasses.forEach(c => tagEl.classList.remove(c));
        tagEl.classList.add(getColorClass(tagEl.dataset.tagName));
    });
}

function clearAllSelections() {
    selectedModNames.clear();
    updateAllVisualSelections();
    updateSelectionDependentButtons();
    lastCheckedMod = null;
}



function refreshAllMods() {
    showConfirm('refresh.confirm.title', 'refresh.confirm.msg').then(confirmed => {
        if (confirmed) {
            // 设置加载提示文本为“刷新中...�?
            const loadingTextEl = document.querySelector('#loadingOverlay .loading-text');
            const originalText = loadingTextEl ? loadingTextEl.textContent : t('loading.processing');
            if (loadingTextEl) loadingTextEl.textContent = t('loading.refreshing');

            // 传入 null 作为 buttonElement 以触发全局加载遮罩
            callIPC('refresh-mods', {}, () => {
                showToast('toast.refresh.success', 'success');
                loadAndRenderModList();
                refreshTagFilters();
                // 恢复默认文本
                if (loadingTextEl) loadingTextEl.textContent = t('loading.processing');
            }, null);
        }
    });
}

// --- Appearance & Background Logic ---

async function initializeAppearance() {
    const settings = await ipcRenderer.invoke('get-all-settings');
    currentTheme = normalizeThemeSelection(settings.theme);
    persistThemePreference(currentTheme);

    currentSelectedBackgroundImage = settings.background_image_name || '';

    // 修复�? 被视�?falsy 值导�?|| 1.0 生效的问�?
    // 如果 settings.background_opacity 存在且不�?null，则使用该值，否则默认�?1.0
    currentBackgroundOpacity = (settings.background_opacity !== undefined && settings.background_opacity !== null) ? settings.background_opacity : 1.0;

    currentBackgroundBlur = settings.background_blur || 0.0;

    // 初始化全局目录缓存
    globalBgImagesDir = settings.background_images_dir || '';
    // 记录初始路径
    lastSavedBgImagesDir = globalBgImagesDir;

    // Apply Theme
    document.body.dataset.theme = currentTheme;

    // Load Interaction Settings
    if (settings.preview_delay !== undefined) PREVIEW_DELAY_MS = settings.preview_delay;
    if (settings.preview_interval !== undefined) SLIDESHOW_INTERVAL_MS = settings.preview_interval;

    // Load Scroll Settings
    if (settings.scroll_trigger_distance !== undefined) window.SCROLL_ZONE_SIZE = parseInt(settings.scroll_trigger_distance, 10);
    const scrollDistInput = document.getElementById('scrollTriggerDistanceInput');
    if (scrollDistInput) {
        scrollDistInput.value = window.SCROLL_ZONE_SIZE;
        document.getElementById('scrollTriggerDistanceValue').textContent = window.SCROLL_ZONE_SIZE + 'px';
    }

    // Apply initial dynamic styles
    applyDynamicStyles();

    updateThemeToggleUI();

    // Validating and Setting Background Opacity UI
    const bgTransparency = Math.round((1 - currentBackgroundOpacity) * 100);
    const bgOpacitySlider = document.getElementById('backgroundOpacity');
    if (document.activeElement !== bgOpacitySlider) {
        bgOpacitySlider.value = bgTransparency;
    }
    document.getElementById('opacityValue').textContent = `${bgTransparency}%`;

    document.getElementById('backgroundBlur').value = currentBackgroundBlur;
    document.getElementById('blurValue').textContent = `${currentBackgroundBlur}px`;

    // Re-apply styles now that DOM is set
    applyDynamicStyles();

    // Ensure listeners are attached (idempotent, safe to call multiple times)
    setupAppearanceControlListeners();
}

function setupAppearanceControlListeners() {
    const opacitySlider = document.getElementById('backgroundOpacity');
    const blurSlider = document.getElementById('backgroundBlur');
    const fgSlider = document.getElementById('foregroundTransparency');
    const opacityValueSpan = document.getElementById('opacityValue');
    const blurValueSpan = document.getElementById('blurValue');
    const fgValueSpan = document.getElementById('fgOpacityValue');

    if (opacitySlider && opacityValueSpan) {
        opacitySlider.oninput = function () {
            opacityValueSpan.textContent = this.value + '%';
            applyDynamicStyles();
            saveSettingsOnChange();
        };
    }

    if (blurSlider && blurValueSpan) {
        blurSlider.oninput = function () {
            blurValueSpan.textContent = this.value + 'px';
            applyDynamicStyles();
            saveSettingsOnChange();
        };
    }

    const themeToggleButton = document.getElementById('themeToggleButton');
    if (themeToggleButton) {
        themeToggleButton.onclick = () => {
            currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.body.dataset.theme = currentTheme;
            persistThemePreference(currentTheme);
            updateThemeToggleUI();
            saveSettingsOnChange(true);
        };
    }
}

async function loadBackgroundImages() {
    const thumbnailsContainer = document.getElementById('backgroundImageThumbnails');
    thumbnailsContainer.innerHTML = '<div style="grid-column:1/-1; display:flex; justify-content:center; padding:1rem;"><div class="simple-spinner"></div></div>';

    const images = await ipcRenderer.invoke('list-background-images');
    // 重新获取设置以确保路径正�?
    const settings = await ipcRenderer.invoke('get-all-settings');
    const bgDir = settings.background_images_dir;
    // 更新全局缓存
    globalBgImagesDir = bgDir;

    thumbnailsContainer.innerHTML = '';

    // 1. Render "No Background" Option
    const noBgThumbnail = document.createElement('div');
    noBgThumbnail.className = 'thumbnail-item';
    noBgThumbnail.innerHTML = `<div class="no-bg-placeholder"><i class="fas fa-ban"></i><span>${t('background.none')}</span></div>`;
    noBgThumbnail.dataset.imageName = '';
    if (currentSelectedBackgroundImage === '') noBgThumbnail.classList.add('selected');
    noBgThumbnail.onclick = () => selectThumbnail('');
    thumbnailsContainer.appendChild(noBgThumbnail);

    // 2. Render Image List
    if (images.length > 0) {
        let scrollTarget = null;

        images.forEach(imageName => {
            const thumbnailItem = document.createElement('div');
            thumbnailItem.className = 'thumbnail-item';
            thumbnailItem.dataset.imageName = imageName;

            const fullPath = formatLocalPathForUrl(path.join(bgDir, imageName));
            const img = document.createElement('img');
            img.alt = imageName;
            img.src = fullPath; // Load directly
            img.loading = "lazy";

            // Image Load Handling
            img.onload = () => {
                // Ensure layout stability after load
            };

            img.onerror = () => {
                thumbnailItem.innerHTML = `<div class="error-placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; font-size:0.8rem; color:var(--accent-red);"><i class="fas fa-exclamation-circle"></i><span>${t('background.load_failed')}</span></div>`;
            };

            thumbnailItem.appendChild(img);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = imageName;
            thumbnailItem.appendChild(nameSpan);

            // Delete Button Overlay
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'delete-bg-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
            deleteBtn.title = t('background.delete.this');
            deleteBtn.onclick = (e) => {
                e.stopPropagation(); // Stop bubble so we don't select the image
                deleteBackgroundImage(imageName);
            };
            thumbnailItem.appendChild(deleteBtn);

            // Selection Logic
            if (imageName === currentSelectedBackgroundImage) {
                thumbnailItem.classList.add('selected');
                scrollTarget = thumbnailItem;
            }

            thumbnailItem.onclick = () => selectThumbnail(imageName);
            thumbnailsContainer.appendChild(thumbnailItem);
        });

        // 3. Auto Scroll to Selected
        if (scrollTarget) {
            setTimeout(() => {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    // 标记加载完成
    isBackgroundImagesLoaded = true;
}

async function deleteBackgroundImage(imageName) {
    if (await showConfirm('background.delete.confirm.title', 'background.delete.confirm.msg', { name: imageName })) {
        callIPC('delete-background-image', { filename: imageName }, (result) => {
            if (result.success) {
                showToast('background.delete.success', 'success');
                // 如果删除的是当前选中的背景，重置为无背景
                if (currentSelectedBackgroundImage === imageName) {
                    clearBackgroundImage();
                }
                // 删除图片后，需要重新加载列�?
                isBackgroundImagesLoaded = false;
                loadBackgroundImages();
            } else {
                showToast(result.message || t('background.delete.failed'), 'error');
            }
        });
    }
}

function selectThumbnail(imageName) {
    // 优化：如果选中的已经是当前背景，则不执行任何操作，防止闪烁
    if (currentSelectedBackgroundImage === imageName) return;

    document.querySelectorAll('.thumbnail-item').forEach(item => item.classList.remove('selected'));

    // Find item by attribute to handle cases where DOM might have refreshed
    const selectedThumbnail = document.querySelector(`.thumbnail-item[data-image-name="${CSS.escape(imageName)}"]`);
    if (selectedThumbnail) selectedThumbnail.classList.add('selected');

    currentSelectedBackgroundImage = imageName;
    applyDynamicStyles();
    saveSettingsOnChange();
}

function clearBackgroundImage() {
    selectThumbnail('');
}

function applyDynamicStyles() {
    const opacityInput = document.getElementById('backgroundOpacity');
    const blurInput = document.getElementById('backgroundBlur');
    if (!opacityInput || !blurInput) return;

    // Background Opacity Logic
    const bgTransparency = parseInt(opacityInput.value, 10);
    const bgOpacity = 1 - (bgTransparency / 100);

    const backgroundBlur = blurInput.value;

    // Reset global CSS variables to handle theme changes (without foreground opacity override)
    // Actually, if we just don't touch them, they stay as defined in CSS file.
    // However, if we modified them before, we should probably reset them or just let CSS rules take over if we remove inline styles?
    // But setting properties on documentElement overrides CSS. We need to reset them to null to let CSS take back control.
    const root = document.documentElement;
    root.style.removeProperty('--bg-glass-sidebar');
    root.style.removeProperty('--bg-card');
    root.style.removeProperty('--bg-glass-heavy');

    let backgroundLayer = document.getElementById('fixed-background-layer');
    if (backgroundLayer) {
        if (currentSelectedBackgroundImage) {
            // 使用全局缓存的目录，避免异步闪烁
            if (globalBgImagesDir) {
                const fullPath = formatLocalPathForUrl(path.join(globalBgImagesDir, currentSelectedBackgroundImage));
                backgroundLayer.style.backgroundImage = `url("${fullPath}")`;
            }
            // 应用透明�?
            backgroundLayer.style.opacity = bgOpacity;
        } else {
            backgroundLayer.style.backgroundImage = 'none';
            backgroundLayer.style.opacity = '0';
        }
        backgroundLayer.style.filter = `blur(${backgroundBlur}px)`;
    }
}

async function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    const settings = await ipcRenderer.invoke('get-all-settings');

    // Fill Paths
    document.getElementById('mods_dir').value = settings.mods_dir || '';
    document.getElementById('game_path').value = settings.game_path || '';
    document.getElementById('nexus_download_dir').value = settings.nexus_download_dir || '';
    document.getElementById('bg_images_dir').value = settings.background_images_dir || '';

    // 更新全局状态，防止未打开设置时更改路径导致的同步问题
    lastSavedBgImagesDir = settings.background_images_dir || '';
    globalBgImagesDir = settings.background_images_dir || '';

    // Setup listeners if not already there (using idempotency or simple reassignment)
    ['mods_dir', 'game_path', 'nexus_download_dir', 'bg_images_dir'].forEach(id => {
        const el = document.getElementById(id);
        el.onchange = saveSettingsOnChange; // Simple assignment avoids duplicates
    });

    // Re-run initializeAppearance logic to ensure transparency slider and theme select are correct
    await initializeAppearance();

    // 为了防止标签切换导致的高度跳动，我们在打开时计算最大高度并固定
    modal.style.display = 'flex';

    // We no longer manually calculate and force a minHeight here
    // because it causes the modal to be excessively tall on initial load.
    // CSS Flexbox handles the modal tab heights smoothly now.

    // Default open active tab or Paths
    openSettingsTab(null, 'paths');

    // Populate Interaction Settings Inputs
    const delayInput = document.getElementById('previewDelayInput');
    const intervalInput = document.getElementById('previewIntervalInput');
    if (delayInput) {
        delayInput.value = PREVIEW_DELAY_MS;
        const valSpan = document.getElementById('previewDelayValue');
        if (valSpan) valSpan.textContent = PREVIEW_DELAY_MS + 'ms';

        delayInput.oninput = function () {
            document.getElementById('previewDelayValue').textContent = this.value + 'ms';
            // update global immediately for preview (save triggers on debounce)
            PREVIEW_DELAY_MS = parseInt(this.value, 10);
            saveSettingsOnChange();
        };
    }
    if (intervalInput) {
        intervalInput.value = SLIDESHOW_INTERVAL_MS;
        const valSpan = document.getElementById('previewIntervalValue');
        if (valSpan) valSpan.textContent = SLIDESHOW_INTERVAL_MS + 'ms';

        intervalInput.oninput = function () {
            document.getElementById('previewIntervalValue').textContent = this.value + 'ms';
            SLIDESHOW_INTERVAL_MS = parseInt(this.value, 10);
            saveSettingsOnChange();
        };
    }

    // Populate Scroll Trigger Distance Input
    const scrollDistInput = document.getElementById('scrollTriggerDistanceInput');
    if (scrollDistInput) {
        scrollDistInput.value = window.SCROLL_ZONE_SIZE;
        const valSpan = document.getElementById('scrollTriggerDistanceValue');
        if (valSpan) valSpan.textContent = window.SCROLL_ZONE_SIZE + 'px';

        scrollDistInput.oninput = function () {
            const newValue = parseInt(this.value, 10);
            document.getElementById('scrollTriggerDistanceValue').textContent = newValue + 'px';
            // Update global variable immediately so drag-scroll uses the new value
            window.SCROLL_ZONE_SIZE = newValue;
            saveSettingsOnChange();
        };
    }

    // 优化：仅当背景图片列表尚未加载时才加载，避免每次打开闪烁
    if (!isBackgroundImagesLoaded) {
        loadBackgroundImages();
    }
}

let saveSettingsDebounceTimer;
function normalizeThemeSelection(theme) {
    if (theme === 'dark' || theme === 'light') return theme;
    if (theme === 'tokyo-night' || theme === 'default') return 'dark';
    return 'light';
}

function updateThemeToggleUI() {
    const themeToggleButton = document.getElementById('themeToggleButton');
    if (!themeToggleButton) return;

    const normalizedTheme = normalizeThemeSelection(currentTheme);
    themeToggleButton.dataset.theme = normalizedTheme;
    themeToggleButton.setAttribute('aria-checked', normalizedTheme === 'dark' ? 'true' : 'false');
}

function persistThemePreference(theme) {
    localStorage.setItem('app_theme', normalizeThemeSelection(theme));
}

function saveSettingsOnChange(silent = false) {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = setTimeout(() => saveAllSettings(silent), 500);
}

function saveAllSettings(silent = false) {
    const newBgDir = document.getElementById('bg_images_dir').value.trim();

    // 转换透明度回不透明度进行保�?
    const transparency = parseInt(document.getElementById('backgroundOpacity').value, 10);
    // Opacity = 1 - (Transparency / 100)
    const opacityToSave = 1 - (transparency / 100);

    // Interaction Settings
    const previewDelay = parseInt(document.getElementById('previewDelayInput')?.value || 600, 10);
    const previewInterval = parseInt(document.getElementById('previewIntervalInput')?.value || 2000, 10);

    const payload = {
        mods_dir: document.getElementById('mods_dir').value.trim(),
        game_path: document.getElementById('game_path').value.trim(),
        nexus_download_dir: document.getElementById('nexus_download_dir').value.trim(),
        background_images_dir: newBgDir,
        theme: normalizeThemeSelection(currentTheme),
        color_preset: 'default', // Keep for DB compatibility
        background_image_name: currentSelectedBackgroundImage,
        background_opacity: opacityToSave,
        background_blur: document.getElementById('backgroundBlur').value,
        foreground_transparency: (1 - (parseInt(document.getElementById('foregroundTransparency')?.value || 0, 10) / 100)),
        preview_delay: previewDelay,
        preview_interval: previewInterval,
        scroll_trigger_distance: parseInt(document.getElementById('scrollTriggerDistanceInput')?.value || 100, 10)
    };
    callIPC('save-all-settings', payload, (result) => {
        if (result.success) {
            if (!silent) {
                showToast('toast.settings.save.success', 'success', 2000);
            }
            initializeAppearance();
            loadAndRenderModList();

            // 检查背景图片目录是否发生了变化
            // 如果变化了，我们需要重置加载状态并刷新列表
            if (newBgDir !== lastSavedBgImagesDir) {
                lastSavedBgImagesDir = newBgDir;
                globalBgImagesDir = newBgDir; // Update global cache
                isBackgroundImagesLoaded = false;
                loadBackgroundImages();
            }
        } else {
            showToast(result.message || t('toast.settings.save.fail'), 'error');
        }
    }, null, silent);
}

window.openSettingsTab = function (evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("settings-tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }
    tablinks = document.getElementsByClassName("settings-tab-button");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    document.getElementById(tabName).classList.add("active");
    if (evt) evt.currentTarget.classList.add("active");
    else document.querySelector(`.settings-tab-button[onclick*="'${tabName}'"]`)?.classList.add('active');
}

async function checkGamePathValidity() {
    const settings = await ipcRenderer.invoke('get-all-settings');
    const config = window.gameManager && window.gameManager.getActiveGameConfig();

    // Use game-specific validation if available, otherwise fallback to generic check
    const isValid = config && typeof config.validatePaths === 'function'
        ? config.validatePaths(settings)
        : (settings.game_path && settings.mods_dir);

    if (!isValid) {
        openSettingsModal();
    }
}

function autoDetectGamePath() {
    const config = window.gameManager && window.gameManager.getActiveGameConfig();
    if (!config) {
        showToast('game.path.auto_detect.config_missing', 'error');
        return;
    }

    config.autoDetectPath().then((result) => {
        if (result.success) {
            document.getElementById('game_path').value = result.game_path;
            showToast('game.path.auto_detect.success', 'success');
            saveSettingsOnChange(); // Defined in ui-modals.js usually, ensure availability
        } else {
            showToast('game.path.auto_detect.failed', 'warning', 0);
            openSettingsModal();
            openSettingsTab(null, 'paths');
        }
    }).catch(err => {
        console.error("Auto detect path error:", err);
        showToast('game.path.auto_detect.error', 'error', 3000, { message: err.message });
    });
}

function selectDirectory(inputId, title) {
    callIPC('select-directory', title, (result) => {
        if (result.success) {
            const inputElement = document.getElementById(inputId);
            inputElement.value = result.path;
            inputElement.dispatchEvent(new Event('change'));
        }
    });
}

function handleNewBackgroundImageSelect(event) {
    const fileInput = event.target;
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        callIPC('upload-background-image', file.path, (result) => {
            if (result.success) {
                showToast('background.upload.success', 'success', 3000, { name: result.filename });
                // Refresh list and select the new one
                isBackgroundImagesLoaded = false;
                loadBackgroundImages().then(() => {
                    selectThumbnail(result.filename);
                });
            } else {
                showToast(result.message || t('background.upload.failed'), 'error');
            }
            // CRITICAL: Reset input value so same file can be selected again if user deletes and re-uploads
            fileInput.value = '';
        });
    }
}


// Expose shared modal/settings APIs for inline HTML and other scripts
window.closeModal = closeModal;
window.initializeAppearance = initializeAppearance;
window.setupAppearanceControlListeners = setupAppearanceControlListeners;
window.loadBackgroundImages = loadBackgroundImages;
window.clearBackgroundImage = clearBackgroundImage;
window.openSettingsModal = openSettingsModal;
window.checkGamePathValidity = checkGamePathValidity;
window.autoDetectGamePath = autoDetectGamePath;
window.selectDirectory = selectDirectory;
window.handleNewBackgroundImageSelect = handleNewBackgroundImageSelect;

