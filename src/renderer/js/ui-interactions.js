
// ==========================================================================
// UI INTERACTIONS & MODALS
// ==========================================================================

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('clipboard.copied', 'success', 3000, { text });
    }).catch(err => {
        showToast('clipboard.copy_failed', 'error');
    });
}

async function openAddSubModModal() {
    const selectedModsArray = Array.from(selectedModNames);
    if (selectedModsArray.length !== 1) {
        showToast('submod.parent.select_one', 'warning');
        return;
    }
    currentParentMod = selectedModsArray[0];
    const parentMod = getModEntityByName(currentParentMod);
    const parentDisplayName = parentMod ? parentMod.display_name : currentParentMod;

    document.getElementById('currentParentModName').innerText = parentDisplayName;
    document.getElementById('subModSearchInput').value = '';

    const usedSubMods = new Set(allSubModDetails.map(s => s.name));
    allAvailableSubMods = globalModDetails.filter(m => m.name !== currentParentMod && !usedSubMods.has(m.name)).map(m => ({ name: m.name, displayName: m.display_name }));

    filterAvailableSubMods();
    document.getElementById('addSubModModal').style.display = 'flex';
}

function filterAvailableSubMods() {
    const searchInput = document.getElementById('subModSearchInput');
    const listContainer = document.getElementById('availableSubModsList');
    if (!searchInput || !listContainer) return;

    const searchQuery = searchInput.value.toLowerCase();
    listContainer.innerHTML = '';
    const filteredMods = allAvailableSubMods.filter(mod => mod.name.toLowerCase().includes(searchQuery) || mod.displayName.toLowerCase().includes(searchQuery));
    if (filteredMods.length > 0) {
        filteredMods.forEach(mod => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'picker-list-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `add-sub-mod-${mod.name}`;
            checkbox.value = mod.name;

            const label = document.createElement('label');
            label.htmlFor = `add-sub-mod-${mod.name}`;
            label.textContent = mod.displayName;

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);

            itemDiv.onclick = (e) => {
                if (e.target === checkbox) {
                    if (checkbox.checked) itemDiv.classList.add('selected');
                    else itemDiv.classList.remove('selected');
                    return;
                }
                e.preventDefault();
                checkbox.checked = !checkbox.checked;
                if (checkbox.checked) itemDiv.classList.add('selected');
                else itemDiv.classList.remove('selected');
            };

            listContainer.appendChild(itemDiv);
        });
    } else {
        listContainer.innerHTML = `<p class="placeholder-text" style="padding: 1rem; text-align: center;">${t('submod.available.empty')}</p>`;
    }
}

function buildModDisplayNameMap() {
    const map = new Map();
    globalModDetails.forEach(mod => map.set(mod.name, mod.display_name || mod.name));
    allSubModDetails.forEach(subMod => {
        if (!map.has(subMod.name)) map.set(subMod.name, subMod.display_name || subMod.name);
    });
    return map;
}

let modEntityByNameCache = new Map();
let modEntityMainRef = null;
let modEntitySubRef = null;

function ensureModEntityCache() {
    if (modEntityMainRef === globalModDetails && modEntitySubRef === allSubModDetails) return;

    modEntityByNameCache = new Map();
    (globalModDetails || []).forEach(mod => {
        if (mod?.name) modEntityByNameCache.set(mod.name, mod);
    });
    (allSubModDetails || []).forEach(subMod => {
        if (subMod?.name && !modEntityByNameCache.has(subMod.name)) {
            modEntityByNameCache.set(subMod.name, subMod);
        }
    });

    modEntityMainRef = globalModDetails;
    modEntitySubRef = allSubModDetails;
}

function getModEntityByName(name) {
    ensureModEntityCache();
    return modEntityByNameCache.get(name) || null;
}

async function confirmAddSubModRelation() {
    const subModNames = Array.from(document.querySelectorAll('#availableSubModsList input[type="checkbox"]:checked')).map(el => el.value);
    if (subModNames.length === 0) {
        showToast('submod.select_at_least_one', 'warning');
        return;
    }
    const confirmButton = document.querySelector('#addSubModModal button[onclick="confirmAddSubModRelation()"]');
    callIPC('add-sub-mod-relation', { parent_mod_name: currentParentMod, sub_mod_names: subModNames }, (result) => {
        if (result.success) {
            showToast('toast.submod.add.success', 'success');
            closeModal('addSubModModal');
            loadAndRenderModList();
            clearAllSelections();
        } else {
            showToast(result.message || t('submod.relation_add.failed'), 'error');
        }
    }, confirmButton);
}

function openSimilarModManagementModal() {
    const selectedMods = Array.from(selectedModNames);
    document.getElementById('selectedModsForSimilarGroup').innerText = selectedMods.length;
    document.getElementById('newSimilarGroupNameInput').value = '';
    document.getElementById('createSimilarGroupSection').style.display = selectedMods.length < 2 ? 'none' : 'block';
    const existingGroupsContainer = document.getElementById('existingSimilarGroupsContainer');
    existingGroupsContainer.innerHTML = `<p class="placeholder-text" style="padding: 1rem; text-align: center;">${t('group.management.loading')}</p>`;
    const similarGroupSearchInput = document.getElementById('similarGroupSearchInput');
    currentSimilarGroupSearchQuery = '';
    similarGroupSearchInput.value = '';
    similarGroupSearchInput.removeEventListener('input', debounceFilterSimilarModGroups);
    similarGroupSearchInput.addEventListener('input', debounceFilterSimilarModGroups);
    filterSimilarModGroups();
    document.getElementById('similarModManagementModal').style.display = 'flex';
}

function renderSimilarModGroups(groupsToRender, modDisplayNameMap = null) {
    const existingGroupsContainer = document.getElementById('existingSimilarGroupsContainer');
    if (!existingGroupsContainer) return;
    existingGroupsContainer.innerHTML = '';
    if (groupsToRender.length === 0) {
        existingGroupsContainer.innerHTML = `<p class="placeholder-text" style="padding: 1rem; text-align: center;">${t('group.management.empty')}</p>`;
        return;
    }
    const nameMap = modDisplayNameMap || buildModDisplayNameMap();

    groupsToRender.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'similar-group-card';

        groupDiv.innerHTML = `
            <div class="similar-group-header">
                <div class="similar-group-title">
                    <i class="fas fa-layer-group"></i>
                    ${group.group_name} 
                    <span class="similar-group-count">${group.mod_names.length}</span>
                </div>
                <div class="similar-group-actions">
                    <button class="similar-group-action-btn edit" data-group-id="${group.group_id}" data-group-name="${group.group_name}" onclick="openRenameSimilarGroupModal(this)" title="${t('group.action.rename.title')}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="similar-group-action-btn add" data-group-id="${group.group_id}" data-group-name="${group.group_name}" onclick="openAddModsToGroupModal(this)" title="${t('group.action.add_mod.title')}">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="similar-group-action-btn danger delete" data-group-id="${group.group_id}" onclick="deleteSimilarModGroup(this)" title="${t('group.action.delete.title')}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                </div>
            <div class="similar-group-mods-container">
                ${group.mod_names.map(modName => {
            const displayName = nameMap.get(modName) || modName;
            return `
                    <div class="similar-mod-chip" data-group-id="${group.group_id}" data-mod-name="${modName}" title="${t('group.mod_chip.remove.title')}">
                        ${displayName}
                        <i class="fas fa-times"></i>
                    </div>`;
        }).join('')}
            </div>
        `;
        existingGroupsContainer.appendChild(groupDiv);
    });

    // Remove applyTagColors() as we use custom chip styling now

    existingGroupsContainer.querySelectorAll('.similar-mod-chip').forEach(tagElement => {
        tagElement.addEventListener('click', (e) => {
            removeModFromSimilarGroup(e.currentTarget.dataset.groupId, e.currentTarget.dataset.modName);
        });
    });
}

function filterSimilarModGroups() {
    const similarGroupSearchInput = document.getElementById('similarGroupSearchInput');
    if (!similarGroupSearchInput) return;
    currentSimilarGroupSearchQuery = normalize_string(similarGroupSearchInput.value.trim());
    const modDisplayNameMap = buildModDisplayNameMap();
    const filteredGroups = allSimilarGroups.filter(group => {
        const normalizedGroupName = normalize_string(group.group_name);
        const normalizedModNames = (group.mod_names || []).map(name => normalize_string(modDisplayNameMap.get(name) || name));
        return normalizedGroupName.includes(currentSimilarGroupSearchQuery) || normalizedModNames.some(name => name.includes(currentSimilarGroupSearchQuery));
    });
    renderSimilarModGroups(filteredGroups, modDisplayNameMap);
}

let debounceSimilarGroupSearchTimer;
function debounceFilterSimilarModGroups() {
    clearTimeout(debounceSimilarGroupSearchTimer);
    debounceSimilarGroupSearchTimer = setTimeout(filterSimilarModGroups, DEBOUNCE_DELAY);
}

function createSimilarModGroup() {
    const selectedMods = Array.from(selectedModNames);
    const groupName = document.getElementById('newSimilarGroupNameInput').value.trim();
    if (selectedMods.length < 2) {
        showToast('group.create.need_two_mods', 'warning');
        return;
    }
    if (!groupName) {
        showToast('group.name.required', 'warning');
        return;
    }
    const createButton = document.querySelector('#similarModManagementModal button[onclick="createSimilarModGroup()"]');
    callIPC('create-similar-mod-group', { group_name: groupName, mod_names: selectedMods }, (result) => {
        if (result.success) {
            showToast('toast.group.create.success', 'success');
            closeModal('similarModManagementModal');
            loadAndRenderModList();
            clearAllSelections();
        } else {
            showToast(result.message || t('group.create.failed'), 'error');
        }
    }, createButton);
}

async function deleteSimilarModGroup(buttonElement) {
    const groupId = buttonElement.dataset.groupId;
    if (await showConfirm('group.delete.confirm.title', 'group.delete.confirm.msg')) {
        callIPC('delete-similar-mod-group', { group_id: groupId }, (result) => {
            if (result.success) {
                showToast('toast.group.delete.success', 'success');
                loadAndRenderModList();
                clearAllSelections();
            } else {
                showToast(result.message || t('group.delete.failed'), 'error');
            }
        }, buttonElement);
    }
}

async function removeModFromSimilarGroup(groupId, modName) {
    if (await showConfirm('group.mod_remove.confirm.title', 'group.mod_remove.confirm.msg', { mod: modName })) {
        callIPC('remove-mod-from-similar-group', { group_id: groupId, mod_name: modName }, (result) => {
            if (result.success) {
                showToast('group.mod_remove.success', 'success', 3000, { mod: modName });
                loadAndRenderModList();
                clearAllSelections();
            } else {
                showToast(result.message || t('group.mod_remove.failed'), 'error');
            }
        });
    }
}

function openRenameSimilarGroupModal(buttonElement) {
    currentSimilarGroupId = buttonElement.dataset.groupId;
    currentSimilarGroupName = buttonElement.dataset.groupName;
    document.getElementById('oldSimilarGroupNameDisplay').innerText = currentSimilarGroupName;
    const newNameInput = document.getElementById('newSimilarGroupNameInputModal');
    newNameInput.value = currentSimilarGroupName;
    document.getElementById('renameSimilarGroupModal').style.display = 'flex';
    newNameInput.focus();
}

function renameSimilarModGroup() {
    const newName = document.getElementById('newSimilarGroupNameInputModal').value.trim();
    if (!newName || newName === currentSimilarGroupName) {
        closeModal('renameSimilarGroupModal');
        if (newName) showToast('group.rename.same_name', 'warning');
        return;
    }
    const confirmButton = document.querySelector('#renameSimilarGroupModal button');
    callIPC('rename-similar-mod-group', { group_id: currentSimilarGroupId, new_group_name: newName }, (result) => {
        if (result.success) {
            showToast('toast.group.rename.success', 'success', 3000, { oldName: currentSimilarGroupName, newName });
            closeModal('renameSimilarGroupModal');
            loadAndRenderModList();
            clearAllSelections();
        } else {
            showToast(result.message || t('group.rename.failed'), 'error');
        }
    }, confirmButton);
}

async function openAddToSimilarModGroupModal() {
    const selectedMods = Array.from(selectedModNames);
    if (selectedMods.length === 0) {
        showToast('group.add.need_select_mod', 'warning');
        return;
    }
    document.getElementById('selectedModsCountAddToSimilar').innerText = selectedMods.length;
    document.getElementById('similarGroupSearchInputModal').value = '';
    allSimilarGroupsForAdding = allSimilarGroups;
    filterSimilarGroupsForAdding();
    document.getElementById('addToSimilarModGroupModal').style.display = 'flex';
}

function filterSimilarGroupsForAdding() {
    const searchQuery = document.getElementById('similarGroupSearchInputModal').value.toLowerCase();
    const listContainer = document.getElementById('existingSimilarGroupsList');
    listContainer.innerHTML = '';
    const filteredGroups = allSimilarGroupsForAdding.filter(group => group.group_name.toLowerCase().includes(searchQuery));
    if (filteredGroups.length === 0) {
        listContainer.innerHTML = `<p class="placeholder-text" style="padding: 1rem; text-align: center;">${t('group.search.empty')}</p>`;
    } else {
        filteredGroups.forEach(group => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'picker-list-item selectable-group-item';
            itemDiv.dataset.groupId = group.group_id;

            // For single selection, we can still use a layout similar to picker-list-item
            // but effectively functioning as a radio button visually or just a card selection.
            // We'll use the .selected class for the active state.

            const label = document.createElement('label');
            label.textContent = `${group.group_name} (${group.mod_names.length} Mod)`;
            label.style.pointerEvents = 'none';

            itemDiv.appendChild(label);

            itemDiv.onclick = () => {
                const allItems = listContainer.querySelectorAll('.selectable-group-item');
                allItems.forEach(item => {
                    item.classList.remove('selected');
                });
                itemDiv.classList.add('selected');
            };
            listContainer.appendChild(itemDiv);
        });
    }
}

function addModsToSimilarGroup() {
    const selectedMods = Array.from(selectedModNames);
    const selectedItem = document.querySelector('#existingSimilarGroupsList .selectable-group-item.selected');
    const selectedGroupId = selectedItem ? selectedItem.dataset.groupId : null;
    if (selectedMods.length === 0) {
        showToast('group.add.select_from_main', 'warning');
        return;
    }
    if (!selectedGroupId) {
        showToast('group.add.select_group', 'warning');
        return;
    }
    const confirmButton = document.querySelector('#addToSimilarModGroupModal button[onclick="addModsToSimilarGroup()"]');
    callIPC('add-mods-to-similar-group', { group_id: selectedGroupId, mod_names: selectedMods }, (result) => {
        if (result.success) {
            showToast('group.add.success', 'success');
            closeModal('addToSimilarModGroupModal');
            loadAndRenderModList();
            clearAllSelections();
        } else {
            showToast(result.message || t('group.add.failed'), 'error');
        }
    }, confirmButton);
}

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

    // 下载模态框的清理
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
            // 设置加载提示文本为“刷新中...”
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
    // Default to 'dark' if undefined
    currentTheme = settings.theme || 'dark';

    currentSelectedBackgroundImage = settings.background_image_name || '';

    // 修复：0 被视为 falsy 值导致 || 1.0 生效的问题
    // 如果 settings.background_opacity 存在且不为 null，则使用该值，否则默认为 1.0
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

    // Update Theme Select UI (Circular Options)
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.remove('active');
        if (option.dataset.theme === currentTheme) {
            option.classList.add('active');
        }
    });

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

    // New Theme Select Listener (Circular Options)
    document.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
            // Update Active State Visuals
            document.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            // Apply Theme
            currentTheme = option.dataset.theme;
            document.body.dataset.theme = currentTheme;
            saveSettingsOnChange(true); // Pass true for silent save
        });
    });
}

async function loadBackgroundImages() {
    const thumbnailsContainer = document.getElementById('backgroundImageThumbnails');
    thumbnailsContainer.innerHTML = '<div style="grid-column:1/-1; display:flex; justify-content:center; padding:1rem;"><div class="simple-spinner"></div></div>';

    const images = await ipcRenderer.invoke('list-background-images');
    // 重新获取设置以确保路径正确
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
                // 删除图片后，需要重新加载列表
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
            // 应用透明度
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
function saveSettingsOnChange(silent = false) {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = setTimeout(() => saveAllSettings(silent), 500);
}

function saveAllSettings(silent = false) {
    const newBgDir = document.getElementById('bg_images_dir').value.trim();

    // 转换透明度回不透明度进行保存
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
        theme: currentTheme ? currentTheme : 'dark',
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

let tagFilterDataSignature = '';

function refreshTagFilters() {
    const allTags = new Set();
    [...globalModDetails, ...allSubModDetails].forEach(m => (m.tags || []).forEach(t => allTags.add(t)));
    const tagFilterGroup = document.querySelector('.tag-filter-group');
    if (!tagFilterGroup) return;
    const sortedTags = Array.from(allTags).sort();
    const nextSignature = sortedTags.join('\u0001');

    // Skip full DOM rebuild when tag data is unchanged; only refresh active states.
    if (nextSignature === tagFilterDataSignature && tagFilterGroup.children.length > 0) {
        updateFilterButtonStates();
        return;
    }
    tagFilterDataSignature = nextSignature;

    tagFilterGroup.innerHTML = '';
    const allTagsBtn = document.createElement('button');
    allTagsBtn.className = `tag-filter-btn tag-only-filter-btn ${currentSelectedTags.size === 0 ? 'active' : ''}`;
    allTagsBtn.dataset.tag = '';
    allTagsBtn.textContent = t('topbar.filter.all_tags');
    allTagsBtn.onclick = () => filterModsByTag('');
    allTagsBtn.oncontextmenu = (e) => { e.preventDefault(); filterModsByTag('', true); };
    tagFilterGroup.appendChild(allTagsBtn);
    sortedTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = `tag-filter-btn tag-only-filter-btn ${currentSelectedTags.has(tag.toLowerCase()) ? 'active' : ''}`;
        btn.dataset.tag = tag;
        btn.textContent = tag;
        btn.onclick = () => filterModsByTag(tag);
        btn.oncontextmenu = (e) => { e.preventDefault(); filterModsByTag(tag, true); };
        tagFilterGroup.appendChild(btn);
    });
    updateFilterButtonStates();
}

let clothingCacheImagesRef = null;
let clothingCacheMainModsRef = null;
let clothingCacheSubModsRef = null;
let clothingCacheLookupRef = null;
let clothingIndexedMetas = [];
let clothingMetaByImageRef = new Map();

function ensureClothingSearchCaches() {
    const config = window.gameManager && window.gameManager.getActiveGameConfig();
    const lookupData = config && Array.isArray(config.nameLookupData) ? config.nameLookupData : [];

    const shouldRebuild = clothingCacheImagesRef !== allClothingImages
        || clothingCacheMainModsRef !== globalModDetails
        || clothingCacheSubModsRef !== allSubModDetails
        || clothingCacheLookupRef !== lookupData;

    if (!shouldRebuild) return;

    const allMods = [...(globalModDetails || []), ...(allSubModDetails || [])];
    const modSearchIndex = allMods.map(mod => ({
        mod,
        normalizedName: normalize_string(mod.display_name || mod.name || ''),
        normalizedTags: (mod.tags || []).map(tag => normalize_string(tag || ''))
    }));

    const lookupByNormalizedName = new Map();
    lookupData.forEach(entry => {
        const enNorm = normalize_string(entry?.en || '');
        const cnNorm = normalize_string(entry?.cn || '');
        if (enNorm) lookupByNormalizedName.set(enNorm, entry);
        if (cnNorm && !lookupByNormalizedName.has(cnNorm)) lookupByNormalizedName.set(cnNorm, entry);
    });

    clothingIndexedMetas = [];
    clothingMetaByImageRef = new Map();

    (allClothingImages || []).forEach(img => {
        const rawDisplayName = String(img?.display_name || img?.name || '');
        const cleanDisplayName = rawDisplayName.replace(/^\d{3}[_\s\.]*/, '');
        const normalizedDisplayName = normalize_string(rawDisplayName);
        const normalizedCleanDisplayName = normalize_string(cleanDisplayName);

        const matchingMods = [];
        modSearchIndex.forEach(entry => {
            if (!normalizedDisplayName) return;
            if (entry.normalizedName.includes(normalizedDisplayName) || entry.normalizedTags.some(tag => tag.includes(normalizedDisplayName))) {
                matchingMods.push(entry.mod);
            }
        });

        const lookupEntry = lookupByNormalizedName.get(normalizedCleanDisplayName)
            || lookupByNormalizedName.get(normalizedDisplayName)
            || null;

        const meta = {
            img,
            cleanDisplayName,
            normalizedDisplayName,
            lowerName: String(img?.name || '').toLowerCase(),
            lowerDisplay: rawDisplayName.toLowerCase(),
            lowerCleanDisplay: cleanDisplayName.toLowerCase(),
            lookupEntry,
            matchingMods,
            modCount: matchingMods.length
        };
        clothingIndexedMetas.push(meta);
        clothingMetaByImageRef.set(img, meta);
    });

    clothingCacheImagesRef = allClothingImages;
    clothingCacheMainModsRef = globalModDetails;
    clothingCacheSubModsRef = allSubModDetails;
    clothingCacheLookupRef = lookupData;
}


async function openClothingImageModal() {
    const modal = document.getElementById('clothingImageModal');
    const grid = document.getElementById('clothingImageGrid');
    const searchInput = document.getElementById('clothingSearchInput');

    searchInput.value = '';
    grid.innerHTML = '<div class="simple-spinner" style="margin: 2rem auto;"></div>';
    document.getElementById('noClothingImageMessage').style.display = 'none';
    document.getElementById('clothingImageErrorMessage').style.display = 'none';

    modal.style.display = 'flex';

    if (allClothingImages.length === 0 && !isFetchingClothingImages) {
        isFetchingClothingImages = true;
        try {
            allClothingImages = await ipcRenderer.invoke('list-clothing-images');
            ensureClothingSearchCaches();
            renderClothingImages(allClothingImages);
        } catch (error) {
            console.error('Failed to load clothing images:', error);
            document.getElementById('clothingImageErrorMessage').style.display = 'block';
            grid.innerHTML = '';
        } finally {
            isFetchingClothingImages = false;
        }
    } else {
        ensureClothingSearchCaches();
        renderClothingImages(allClothingImages);
    }
}

function renderClothingImages(images) {
    ensureClothingSearchCaches();

    const grid = document.getElementById('clothingImageGrid');
    grid.innerHTML = '';
    const noResultsMsg = document.getElementById('noClothingImageMessage');

    if (images.length === 0) {
        noResultsMsg.style.display = 'block';
        return;
    }
    noResultsMsg.style.display = 'none';

    // 1. 排序：确保列表按文件名排序，这样数字部分可以发挥排序作用
    const sortedImages = [...images].sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const fragment = document.createDocumentFragment();

    sortedImages.forEach(img => {
        const item = document.createElement('div');

        const src = formatLocalPathForUrl(img.url);
        const meta = clothingMetaByImageRef.get(img);

        const cleanDisplayName = meta ? meta.cleanDisplayName : String(img.display_name || '').replace(/^\d{3}[_\s\.]*/, '');
        const normalizedClothingName = meta ? meta.normalizedDisplayName : normalize_string(img.display_name || '');
        const matchingMods = meta ? meta.matchingMods : [];

        const modCount = matchingMods.length;
        const hasMods = modCount > 0;

        item.className = `clothing-image-item ${hasMods ? '' : 'disabled'}`;

        let hoverInfoHTML = '';
        if (hasMods) {
            const modListHTML = matchingMods.map(m => `<div>${m.display_name || m.name}</div>`).join('');
            hoverInfoHTML = `
                <div class="clothing-hover-info">
                    <div class="clothing-mod-count">${t('clothing.mod_count', { count: modCount })}</div>
                    <div class="clothing-mod-list">${modListHTML}</div>
                </div>
            `;

            // 添加点击事件：搜索该服装
            item.onclick = () => {
                closeModal('clothingImageModal');
                const searchInput = document.getElementById('searchInput');
                searchInput.value = cleanDisplayName;
                performSearch();
            };
        }

        item.innerHTML = `
            <img src="${src}" alt="${cleanDisplayName}" loading="lazy">
            <span class="clothing-name" title="${cleanDisplayName}">${cleanDisplayName}</span>
            ${hoverInfoHTML}
        `;

        // 右键点击复制英文名称
        item.oncontextmenu = (e) => {
            e.preventDefault();

            const textToCopy = meta?.lookupEntry?.en ? meta.lookupEntry.en : cleanDisplayName;

            copyToClipboard(textToCopy);
            // 既然是复制英文名称，可以提示一下
            // showToast(`已复制: ${textToCopy}`, 'success'); // copyToClipboard 内部已有提示
        };

        fragment.appendChild(item);
    });

    grid.appendChild(fragment);
}

window.filterClothingImages = function () {
    ensureClothingSearchCaches();
    const query = document.getElementById('clothingSearchInput').value.trim().toLowerCase();

    // 优化：空查询直接显示所有
    if (!query) {
        renderClothingImages(allClothingImages);
        return;
    }

    const filtered = clothingIndexedMetas.filter(meta => {
        // 1. 基础匹配：文件名或显示名
        if (meta.lowerName.includes(query) || meta.lowerDisplay.includes(query) || meta.lowerCleanDisplay.includes(query)) {
            return true;
        }

        // 2. 增强匹配：查表匹配英文/中文
        if (meta.lookupEntry) {
            // 如果在表中找到了，检查查询词是否匹配该条目的英文或中文
            return String(meta.lookupEntry.en || '').toLowerCase().includes(query)
                || String(meta.lookupEntry.cn || '').toLowerCase().includes(query);
        }

        return false;
    }).map(meta => meta.img);

    renderClothingImages(filtered);
}

async function handleModMouseEnter(event, modItem) {
    const modName = modItem.dataset.modName || modItem.dataset.subModName;
    if (!modName) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(async () => {
        const mod = getModEntityByName(modName);
        document.getElementById('modPreviewText').textContent = mod ? mod.display_name : modName;
        const imageWrapper = document.querySelector('.mod-preview-image-wrapper');
        const dotsContainer = document.getElementById('previewDotsContainer');
        imageWrapper.innerHTML = '';
        dotsContainer.innerHTML = '';
        clearInterval(previewSlideshowInterval);

        try {
            const images = await ipcRenderer.invoke('get-mod-preview-images', modName);
            if (images && images.length > 0) {
                currentPreviewModImages = images.map(img => formatLocalPathForUrl(img.url));
                currentPreviewImageIndex = 0;
                currentPreviewModImages.forEach((url, index) => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'mod-preview-image';
                    if (index === 0) img.classList.add('active');
                    imageWrapper.appendChild(img);

                    if (currentPreviewModImages.length > 1) {
                        const dot = document.createElement('div');
                        dot.className = 'preview-dot';
                        if (index === 0) dot.classList.add('active');
                        dotsContainer.appendChild(dot);
                    }
                });

                if (currentPreviewModImages.length > 1) {
                    previewSlideshowInterval = setInterval(cyclePreviewImages, SLIDESHOW_INTERVAL_MS);
                }

                const container = document.getElementById('modPreviewContainer');
                container.classList.add('visible');
                updatePreviewPosition(event); // Initial position
            } else {
                document.getElementById('modPreviewContainer').classList.remove('visible');
            }
        } catch (e) {
            console.error("Preview load error", e);
        }
    }, PREVIEW_DELAY_MS);
}

function cyclePreviewImages() {
    const images = document.querySelectorAll('.mod-preview-image-wrapper .mod-preview-image');
    const dots = document.querySelectorAll('.preview-dots .preview-dot');
    if (images.length <= 1) return;

    images[currentPreviewImageIndex].classList.remove('active');
    if (dots[currentPreviewImageIndex]) dots[currentPreviewImageIndex].classList.remove('active');

    currentPreviewImageIndex = (currentPreviewImageIndex + 1) % images.length;

    images[currentPreviewImageIndex].classList.add('active');
    if (dots[currentPreviewImageIndex]) dots[currentPreviewImageIndex].classList.add('active');
}

function handleModMouseLeave() {
    clearTimeout(previewTimeout);
    clearInterval(previewSlideshowInterval);
    const container = document.getElementById('modPreviewContainer');
    if (container) container.classList.remove('visible');
    currentPreviewImageIndex = 0;
}

async function showModPreviewModal(modName) {
    const modal = document.getElementById('modPreviewModal');
    const modalContent = modal.querySelector('.modal-content');

    // 切换到画廊模式样式
    modalContent.classList.add('gallery-view');
    modalContent.classList.remove('wide'); // 移除普通宽模式
    modalContent.style.textAlign = ''; // 清除内联样式

    const mod = globalModDetails.find(m => m.name === modName) || allSubModDetails.find(s => s.name === modName);

    // 隐藏标题，因为画廊模式下我们不需要顶部标题占据空间
    document.getElementById('modPreviewTitle').style.display = 'none';

    const imagesContainer = document.getElementById('modPreviewImagesContainer');
    imagesContainer.innerHTML = '';
    imagesContainer.className = 'mod-preview-images-container gallery-container'; // 添加画廊容器类

    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('noPreviewImageMessage').style.display = 'none';
    document.getElementById('previewErrorMessage').style.display = 'none';

    // 隐藏旧的控制栏，改用覆盖式按钮
    const oldControls = modal.querySelector('.carousel-controls');
    if (oldControls) oldControls.style.display = 'none';

    // 确保有覆盖式导航按钮和计数器
    let prevBtn = modal.querySelector('.gallery-nav-btn.prev');
    let nextBtn = modal.querySelector('.gallery-nav-btn.next');
    let counter = modal.querySelector('.gallery-counter');

    if (!prevBtn) {
        prevBtn = document.createElement('div');
        prevBtn.className = 'gallery-nav-btn prev';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.onclick = showPreviousPreviewImage;
        modalContent.appendChild(prevBtn);
    }
    if (!nextBtn) {
        nextBtn = document.createElement('div');
        nextBtn.className = 'gallery-nav-btn next';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.onclick = showNextPreviewImage;
        modalContent.appendChild(nextBtn);
    }
    if (!counter) {
        counter = document.createElement('div');
        counter.className = 'gallery-counter';
        modalContent.appendChild(counter);
    }

    modal.style.display = 'flex';

    try {
        const images = await ipcRenderer.invoke('get-mod-preview-images', modName);
        document.getElementById('loadingSpinner').style.display = 'none';

        if (images.length > 0) {
            currentPreviewModImages = images.map(i => formatLocalPathForUrl(i.url));
            currentPreviewImageIndex = 0;

            currentPreviewModImages.forEach((imageUrl, index) => {
                const img = document.createElement('img');
                img.src = imageUrl;
                img.draggable = false;
                // img.alt ... 保持简洁
                if (index === 0) img.classList.add('active');
                imagesContainer.appendChild(img);
            });

            // 预加载
            if (images.length > 1) {
                const img1 = new Image(); img1.src = currentPreviewModImages[1];
                const imgLast = new Image(); imgLast.src = currentPreviewModImages[currentPreviewModImages.length - 1];
            }

            updateGalleryUI();
        } else {
            document.getElementById('noPreviewImageMessage').style.display = 'block';
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
            counter.style.display = 'none';
        }
    } catch (error) {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('previewErrorMessage').textContent = t('preview.load_error', { message: error.message });
        document.getElementById('previewErrorMessage').style.display = 'block';
    }
}

function updateGalleryUI() {
    const images = Array.from(document.getElementById('modPreviewImagesContainer').querySelectorAll('img'));
    const modal = document.getElementById('modPreviewModal');
    const prevBtn = modal.querySelector('.gallery-nav-btn.prev');
    const nextBtn = modal.querySelector('.gallery-nav-btn.next');
    const counter = modal.querySelector('.gallery-counter');

    if (images.length === 0) return;

    // 隐藏所有，显示当前
    images.forEach(img => img.classList.remove('active'));
    if (images[currentPreviewImageIndex]) {
        images[currentPreviewImageIndex].classList.add('active');
    }

    if (counter) counter.textContent = `${currentPreviewImageIndex + 1} / ${currentPreviewModImages.length}`;

    const showNav = currentPreviewModImages.length > 1;
    if (prevBtn) prevBtn.style.display = showNav ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = showNav ? 'flex' : 'none';
    if (counter) counter.style.display = 'block';
}

function showNextPreviewImage() {
    if (currentPreviewModImages.length <= 1) return;
    currentPreviewImageIndex = (currentPreviewImageIndex + 1) % currentPreviewModImages.length;
    updateGalleryUI();
}

function showPreviousPreviewImage() {
    if (currentPreviewModImages.length <= 1) return;
    currentPreviewImageIndex = (currentPreviewImageIndex - 1 + currentPreviewModImages.length) % currentPreviewModImages.length;
    updateGalleryUI();
}

// 辅助函数：当关闭模态框时重置样式（可选，如果复用模态框的话）
function resetPreviewModalStyle() {
    const modalContent = document.querySelector('#modPreviewModal .modal-content');
    if (modalContent) {
        modalContent.classList.remove('gallery-view');
        modalContent.classList.add('wide');
        document.getElementById('modPreviewTitle').style.display = '';
        const oldControls = document.querySelector('#modPreviewModal .carousel-controls');
        if (oldControls) oldControls.style.display = '';

        // 移除动态添加的按钮
        modalContent.querySelectorAll('.gallery-nav-btn, .gallery-counter').forEach(el => el.remove());
    }
}

// 需要在 closeModal 中调用，或者专门监听关闭事件
// 为了简单起见，我们在 showModPreviewModal 开头做了重置/设置，这里只需确保关闭逻辑正常即可。
// 现有的 window.closeModal 只切换 display:none，所以下次打开时仍需重新初始化。


function launchGame() {
    if (isLaunchingGame) {
        showToast('game.launch.in_progress', 'info');
        return;
    }
    isLaunchingGame = true;
    callIPC('launch-game', {}, (result) => {
        showToast(result.message, result.success ? 'success' : 'error');
        isLaunchingGame = false;
    }, document.getElementById('launchGameBtn'));
}

function openModFolder(modName) {
    callIPC('open-folder', { type: 'store', modName: modName }, (result) => {
        if (!result.success) showToast(result.message, 'error');
    });
}

function openAllModsFolder() {
    callIPC('open-folder', { type: 'store' }, (result) => {
        if (!result.success) showToast(result.message, 'error');
    });
}

function openActiveModsFolder() {
    callIPC('open-folder', { type: 'active' }, (result) => {
        if (!result.success) showToast(result.message, 'error');
    });
}

function openNexusDownloadsFolder() {
    callIPC('open-folder', { type: 'temp_downloads' }, (result) => {
        if (!result.success) showToast(result.message, 'error');
    });
}

function normalize_string(s) {
    if (typeof s !== 'string') return '';
    s = s.replace(/^\d+[_\- ]*/, '');
    return s.replace(/[（）() ]/g, '').toLowerCase();
}

function showLoadingOverlay() {
    document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoadingOverlay() {
    document.getElementById('loadingOverlay').classList.remove('show');
}

function initializeConflictTooltips() {
    let tooltipElement = document.getElementById('conflict-tooltip');
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'conflict-tooltip';
        tooltipElement.style.position = 'absolute';
        tooltipElement.style.backgroundColor = 'var(--bg-dark-2)';
        tooltipElement.style.color = 'var(--text-primary)';
        tooltipElement.style.padding = '0.5rem 1rem';
        tooltipElement.style.borderRadius = 'var(--border-radius-sm)';
        tooltipElement.style.border = '1px solid var(--border-color)';
        tooltipElement.style.boxShadow = 'var(--shadow-md)';
        tooltipElement.style.zIndex = '10000';
        tooltipElement.style.pointerEvents = 'none';
        tooltipElement.style.display = 'none';
        tooltipElement.style.whiteSpace = 'pre-line';
        document.body.appendChild(tooltipElement);
    }
    document.querySelectorAll('.conflict-icon').forEach(icon => {
        icon.addEventListener('mouseenter', (e) => {
            const content = e.currentTarget.dataset.tooltip.replace(/\\n/g, '<br>');
            tooltipElement.innerHTML = content;
            tooltipElement.style.display = 'block';
            const rect = e.currentTarget.getBoundingClientRect();
            tooltipElement.style.left = `${rect.left + window.scrollX}px`;
            tooltipElement.style.top = `${rect.bottom + window.scrollY + 5}px`;
            tooltipElement.style.opacity = '1';
        });
        icon.addEventListener('mouseleave', () => {
            tooltipElement.style.opacity = '0';
            setTimeout(() => { tooltipElement.style.display = 'none'; }, 200);
        });
    });
}

async function handleContextMenu(e) {
    const clickedItem = e.target.closest('.mod-item, .sub-mod-item');
    if (!clickedItem) {
        hideContextMenu();
        return;
    }

    // 如果已经有打开的菜单且是同一个item，不做处理或者重新打开？
    // 这里简单处理：先关闭旧的（会清理旧的listeners），再打开新的
    hideContextMenu();

    e.preventDefault();
    const contextMenu = document.getElementById('contextMenu');
    // Escape function for strings used in onclick handlers
    const escapeForOnClick = (str) => {
        if (!str) return '';
        // Escape backslashes first, then single quotes
        return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    };

    const isSubMod = clickedItem.classList.contains('sub-mod-item');
    const rawModName = isSubMod ? clickedItem.dataset.subModName : clickedItem.dataset.modName;
    const rawParentModName = isSubMod ? clickedItem.dataset.parentModName : null;

    // Escaped versions for use in onclick
    const modName = escapeForOnClick(rawModName);
    const parentModName = escapeForOnClick(rawParentModName);

    // Original (unescaped) for IPC calls if needed directly, but here passing to handleContextMenuAction 
    // which expects the string as it would be in JS, so the escaped version is correct for the HTML string literal.

    const isActive = isSubMod ? clickedItem.dataset.subModIsActive === 'true' : clickedItem.dataset.isActive === 'true';
    const currentPriority = parseInt(clickedItem.dataset.priority, 10);
    let hasPreviewImages = false;
    try {
        // Use rawModName for IPC call
        const images = await ipcRenderer.invoke('get-mod-preview-images', rawModName);
        if (images.length > 0) hasPreviewImages = true;
    } catch (error) {
        console.error("Could not check for preview images:", error);
    }
    let priorityMenuItemHTML = '';
    if (!isSubMod) {
        let prioritySubMenuHTML = '<div class="context-menu-submenu">';
        for (let i = 0; i <= 9; i++) {
            prioritySubMenuHTML += `<div class="submenu-item ${i === currentPriority ? 'active' : ''}" onclick="handleContextMenuAction('setPriority', '${modName}', false, '', ${i})">${i}</div>`;
        }
        prioritySubMenuHTML += '</div>';

        priorityMenuItemHTML = `
            <div class="context-menu-item has-submenu">
                <div class="item-content"><i class="fas fa-sort-numeric-down"></i> ${t('context.priority.set')}</div>
                ${prioritySubMenuHTML}
            </div>`;
    }
    const previewButtonClass = hasPreviewImages ? '' : 'disabled';
    const previewButtonStyle = hasPreviewImages ? '' : 'opacity: 0.5; pointer-events: none;';
    const previewButtonOnclick = hasPreviewImages ? `handleContextMenuAction('preview', '${modName}')` : '';
    let menuItemsHTML = `
        <div class="context-menu-item" onclick="handleContextMenuAction('toggleActivation', '${modName}', ${isSubMod}, '${parentModName || ''}', ${isActive})"><div class="item-content"><i class="fas ${isActive ? 'fa-toggle-off' : 'fa-toggle-on'}"></i> ${isActive ? t('context.toggle.deactivate') : t('context.toggle.activate')}</div></div>
        <div class="context-menu-item ${previewButtonClass}" style="${previewButtonStyle}" onclick="${previewButtonOnclick}"><div class="item-content"><i class="fas fa-eye"></i> ${t('context.preview')}</div></div>
        <div class="context-menu-item" onclick="handleContextMenuAction('editPreviewImage', '${modName}')"><div class="item-content"><i class="fas fa-image"></i> ${t('context.preview.edit')}</div></div>
        <div class="context-menu-separator"></div>
        ${priorityMenuItemHTML}
        <div class="context-menu-item" onclick="handleContextMenuAction('rename', '${modName}', ${isSubMod}, '${parentModName || ''}')"><div class="item-content"><i class="fas fa-edit"></i> ${t('context.rename')}</div></div>
    `;
    if (!isSubMod) {
        menuItemsHTML += `
            <div class="context-menu-item" onclick="handleContextMenuAction('editTags', '${modName}')"><div class="item-content"><i class="fas fa-tags"></i> ${t('context.tags.edit')}</div></div>
            <div class="context-menu-item" onclick="handleContextMenuAction('addSubMod', '${modName}')"><div class="item-content"><i class="fas fa-plus-square"></i> ${t('context.submod.add')}</div></div>
        `;
    } else {
        menuItemsHTML += `<div class="context-menu-item" onclick="handleContextMenuAction('editTags', '${modName}')"><div class="item-content"><i class="fas fa-tags"></i> ${t('context.tags.edit')}</div></div>`;
    }
    menuItemsHTML += `
        <div class="context-menu-item" onclick="handleContextMenuAction('addToSimilarGroup', '${modName}')"><div class="item-content"><i class="fas fa-plus-circle"></i> ${t('context.group.add')}</div></div>
        <div class="context-menu-item" onclick="handleContextMenuAction('openFolder', '${modName}')"><div class="item-content"><i class="fas fa-folder-open"></i> ${t('context.folder.open')}</div></div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item danger" onclick="handleContextMenuAction('delete', '${modName}', ${isSubMod}, '${parentModName || ''}')"><div class="item-content"><i class="fas ${isSubMod ? 'fa-unlink' : 'fa-trash-alt'}"></i> ${isSubMod ? t('context.delete.relation_remove') : t('context.delete.mod')}</div></div>
    `;
    contextMenu.innerHTML = menuItemsHTML;

    // 1. Render invisibly to calculate dimensions
    contextMenu.style.visibility = 'hidden';
    contextMenu.style.display = 'block';

    const { clientX: mouseX, clientY: mouseY } = e;
    const { innerWidth, innerHeight } = window;

    // 2. Get actual dimensions
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;

    let top = mouseY;
    let left = mouseX;

    // 3. Adjust position to fit within viewport
    // If it hits the bottom, flip up
    if (mouseY + menuHeight > innerHeight) {
        top = mouseY - menuHeight;
    }

    // If it hits the right, flip left
    if (mouseX + menuWidth > innerWidth) {
        left = mouseX - menuWidth;
    }

    // 4. Apply position and show
    contextMenu.style.top = `${top}px`;
    contextMenu.style.left = `${left}px`;
    contextMenu.style.visibility = 'visible';

    // ---------------------------------------------------------
    // NEW: Mouse Leave Logic
    // ---------------------------------------------------------
    currentContextModItem = clickedItem;

    // Handler when mouse leaves the MOD ITEM
    modItemLeaveHandler = (evt) => {
        // If moving TO the context menu, ignore
        if (evt.relatedTarget && (contextMenu.contains(evt.relatedTarget) || contextMenu === evt.relatedTarget)) {
            return;
        }
        hideContextMenu();
    };

    // Handler when mouse leaves the CONTEXT MENU
    contextMenuLeaveHandler = (evt) => {
        // If moving TO the mod item, ignore
        if (evt.relatedTarget && (currentContextModItem.contains(evt.relatedTarget) || currentContextModItem === evt.relatedTarget)) {
            return;
        }
        hideContextMenu();
    };

    currentContextModItem.addEventListener('mouseleave', modItemLeaveHandler);
    contextMenu.addEventListener('mouseleave', contextMenuLeaveHandler);
}

function hideContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
        clearTimeout(contextMenuHideTimeout);
        contextMenu.style.display = 'none';

        // Clean up listeners
        if (currentContextModItem && modItemLeaveHandler) {
            currentContextModItem.removeEventListener('mouseleave', modItemLeaveHandler);
        }
        if (contextMenu && contextMenuLeaveHandler) {
            contextMenu.removeEventListener('mouseleave', contextMenuLeaveHandler);
        }
    }
    // Reset global vars
    currentContextModItem = null;
    modItemLeaveHandler = null;
    contextMenuLeaveHandler = null;
}

// -----------------------------------------------------------
// Context Menu State Tracking
// -----------------------------------------------------------
let currentContextModItem = null;
let modItemLeaveHandler = null;
let contextMenuLeaveHandler = null;

function setupContextMenuEventListeners() {
    // optimize: removed auto-close on mouseleave for better UX
    const contextMenu = document.getElementById('contextMenu');
    if (!contextMenu) return;

    // Close context menu on scroll
    window.addEventListener('scroll', () => {
        if (contextMenu.style.display === 'block') hideContextMenu();
    }, true);
}

// -----------------------------------------------------------
// NEW: Preview Image Follow Cursor Implementation (Optimized)
// -----------------------------------------------------------
let rafId = null;
let lastMouseEvent = null;

function updatePreviewPosition(e) {
    lastMouseEvent = e;
    if (rafId) return;

    rafId = requestAnimationFrame(() => {
        const container = document.getElementById('modPreviewContainer');
        if (!container || !container.classList.contains('visible') || !lastMouseEvent) {
            rafId = null;
            return;
        }

        const e = lastMouseEvent;
        // 偏移量，防止鼠标遮挡
        const offset = 20;
        let top = e.clientY + offset;
        let left = e.clientX + offset;

        // 边界检查：防止预览图超出屏幕右侧或底部
        const rect = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 如果右边缘超出视口，向左移动
        if (left + rect.width > viewportWidth) {
            left = e.clientX - rect.width - offset;
        }

        // 如果下边缘超出视口，向上移动
        if (top + rect.height > viewportHeight) {
            top = e.clientY - rect.height - offset;
        }

        // 防止左/上边缘溢出
        if (left < 0) left = offset;
        if (top < 0) top = offset;

        // 应用位置
        container.style.transform = `translate(${left}px, ${top}px)`;
        // Reset top/left to 0 as we use transform now for better performance
        container.style.top = '0';
        container.style.left = '0';

        rafId = null;
    });
}

// New function to handle submenu toggle on click
window.togglePrioritySubmenu = function (event, element) {
    event.stopPropagation(); // Prevent menu from closing
    const submenu = element.querySelector('.context-menu-submenu');
    if (submenu) {
        const isHidden = submenu.style.display === 'none';
        submenu.style.display = isHidden ? 'grid' : 'none'; // Use grid as per CSS
        // Optional: Toggle active class on parent for styling
        element.classList.toggle('active', isHidden);
    }
}

window.handleContextMenuAction = function (action, modName, isSubMod = false, parentModName = null, value = null) {
    hideContextMenu();
    if (['editTags', 'addToSimilarGroup'].includes(action)) {
        if (!selectedModNames.has(modName)) {
            clearAllSelections();
            selectedModNames.add(modName);
            updateAllVisualSelections();
        }
    } else if (['rename', 'addSubMod', 'preview', 'editPreviewImage'].includes(action)) {
        clearAllSelections();
        selectedModNames.add(modName);
        updateAllVisualSelections();
    }
    updateSelectionDependentButtons();
    switch (action) {
        case 'toggleActivation':
            if (isSubMod) {
                const parentModItem = document.querySelector(`.mod-item[data-mod-name="${parentModName}"]`);
                if (parentModItem && parentModItem.dataset.isActive === 'true') {
                    toggleSubModStatus(parentModName, modName);
                } else {
                    showToast('toast.submod.require_parent_active', 'warning');
                }
            } else {
                toggleModActivation(modName, value);
            }
            break;
        case 'preview':
            showModPreviewModal(modName);
            break;
        case 'editPreviewImage':
            openEditPreviewImageModal(modName);
            break;
        case 'rename':
            openRenameModal(modName, isSubMod, parentModName);
            break;
        case 'editTags':
            openBatchTaggingModal();
            break;
        case 'addSubMod':
            openAddSubModModal();
            break;
        case 'addToSimilarGroup':
            openAddToSimilarModGroupModal();
            break;
        case 'openFolder':
            openModFolder(modName);
            break;
        case 'delete':
            deleteMod(modName, isSubMod, parentModName);
            break;
        case 'setPriority':
            updateModPriority(modName, value, isSubMod, parentModName);
            break;
    }
}

function updateModPriority(modName, newPriority, isSubMod, parentModName) {
    callIPC('update-priority', { modName, priority: newPriority }, (result) => {
        if (result.success) {
            // 使用 IPC 返回的新名称 (result.newName) 来确保提示信息是正确的
            // 修正：在修改优先级成功后，确保清除所有选中状态，避免旧的 modName 干扰后续操作。
            showToast('mod.priority.update.success', 'success', 3000, { name: result.newName || modName, priority: newPriority });

            // 确保强制重新加载列表，因为优先级改变涉及 Mod 文件夹名称的重命名
            loadAndRenderModList();
            clearAllSelections();
        } else {
            showToast(result.message || t('mod.priority.update.failed'), 'error', result.is_locked ? 5000 : 3000);
        }
    });
}

async function openEditPreviewImageModal(modName) {
    modNameForPreviewManagement = modName;
    const modal = document.getElementById('editPreviewImageModal');
    const mod = globalModDetails.find(m => m.name === modName) || allSubModDetails.find(s => s.name === modName);
    document.getElementById('modNameForPreviewEdit').textContent = mod ? mod.display_name : modName;
    const grid = document.getElementById('previewImageGrid');
    const noPreviewsMsg = document.getElementById('noExistingPreviews');

    // Use new CSS class
    grid.className = 'preview-image-grid';
    grid.innerHTML = '<div class="simple-spinner"></div>';

    noPreviewsMsg.style.display = 'none';
    modal.style.display = 'flex';
    try {
        const images = await ipcRenderer.invoke('get-mod-preview-images', modName);

        if (images.length > 0) {
            const gridContent = images.map(imageFile => `
                <div class="preview-image-item" title="${t('preview.delete.click')}" onclick="deletePreviewImage('${modName}', '${imageFile.filename}', this)">
                    <img src="${formatLocalPathForUrl(imageFile.url)}" alt="${imageFile.filename}" loading="lazy">
                    <div class="preview-image-overlay">
                        <i class="fas fa-trash-alt delete-preview-icon"></i>
                    </div>
                </div>`).join('');
            grid.innerHTML = gridContent;
        } else {
            grid.innerHTML = '';
            noPreviewsMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading preview images for editing:', error);
        grid.innerHTML = `<p class="placeholder-text">${t('preview.load_failed')}</p>`;
    }
}

function handleNewPreviewImageSelect(event) {
    const fileInput = event.target;
    // New UI uses a container
    const uploadActions = document.getElementById('uploadPreviewActions');
    const fileNameSpan = document.getElementById('selectedFileName');

    if (fileInput.files.length > 0) {
        fileNameSpan.textContent = fileInput.files[0].name;
        uploadActions.style.display = 'flex';
    } else {
        fileNameSpan.textContent = '';
        uploadActions.style.display = 'none';
    }
}

function uploadPreviewImage() {
    const fileInput = document.getElementById('previewImageUploadInput');
    const file = fileInput.files[0];
    if (!file || !modNameForPreviewManagement) {
        showToast('image.select_one', 'warning');
        return;
    }
    callIPC('add-mod-preview-image', { modName: modNameForPreviewManagement, filePath: file.path }, (result) => {
        if (result.success) {
            showToast('preview.add.success', 'success', 3000, { name: file.name });
            openEditPreviewImageModal(modNameForPreviewManagement);

            // Reset UI
            fileInput.value = '';
            document.getElementById('uploadPreviewActions').style.display = 'none';
            document.getElementById('selectedFileName').textContent = '';
        } else {
            showToast(result.message || t('preview.add.failed'), 'error');
        }
    }, document.getElementById('uploadPreviewBtn'));
}

async function deletePreviewImage(modName, filename, buttonElement) {
    if (await showConfirm('preview.delete.confirm.title', 'preview.delete.confirm.msg', { name: filename })) {
        callIPC('delete-mod-preview-image', { modName, filename }, (result) => {
            if (result.success) {
                showToast('preview.delete.success', 'success');
                openEditPreviewImageModal(modNameForPreviewManagement);
            } else {
                showToast(result.message || t('preview.delete.failed'), 'error');
            }
        });
    }
}

window.deletePreviewImage = deletePreviewImage;

function setupDropdownMenu() {
    const dropdownButton = document.querySelector('.dropdown .sidebar-button');
    if (!dropdownButton) return;
    dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const dropdown = dropdownButton.parentElement;
        dropdown.classList.toggle('open');
    });
    document.addEventListener('click', (event) => {
        const openDropdown = document.querySelector('.dropdown.open');
        if (openDropdown && !openDropdown.contains(event.target)) {
            openDropdown.classList.remove('open');
        }
    });
}

function openAddModsToGroupModal(buttonElement) {
    currentGroupIdForAddingMods = buttonElement.dataset.groupId;
    const groupName = buttonElement.dataset.groupName;
    document.getElementById('addModsToGroupName').textContent = groupName;
    document.getElementById('addModsToGroupSearchInput').value = '';
    const group = allSimilarGroups.find(g => g.group_id == currentGroupIdForAddingMods);
    const modsInGroup = new Set(group ? group.mod_names : []);
    const allPossibleMods = [...globalModDetails, ...allSubModDetails];
    allModsForAddingToGroup = allPossibleMods
        .filter(mod => !modsInGroup.has(mod.name))
        .filter((mod, index, self) => index === self.findIndex((m) => m.name === mod.name));
    filterModsForAddingToGroup();
    document.getElementById('addModsToGroupModal').style.display = 'flex';
}

window.openAddModsToGroupModal = openAddModsToGroupModal;

function filterModsForAddingToGroup() {
    const searchQuery = document.getElementById('addModsToGroupSearchInput').value.toLowerCase().trim();
    const listContainer = document.getElementById('addModsToGroupList');
    listContainer.innerHTML = '';
    const filteredMods = allModsForAddingToGroup.filter(mod =>
        mod.name.toLowerCase().includes(searchQuery) ||
        mod.display_name.toLowerCase().includes(searchQuery)
    );
    if (filteredMods.length > 0) {
        filteredMods.forEach(mod => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'picker-list-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `add-mod-${mod.name}`;
            checkbox.value = mod.name;

            const label = document.createElement('label');
            label.htmlFor = `add-mod-${mod.name}`;
            label.textContent = mod.display_name;

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);

            itemDiv.onclick = (e) => {
                if (e.target === checkbox) {
                    if (checkbox.checked) itemDiv.classList.add('selected');
                    else itemDiv.classList.remove('selected');
                    return;
                }
                e.preventDefault();
                checkbox.checked = !checkbox.checked;
                if (checkbox.checked) itemDiv.classList.add('selected');
                else itemDiv.classList.remove('selected');
            };

            listContainer.appendChild(itemDiv);
        });
    } else {
        listContainer.innerHTML = `<p class="placeholder-text" style="padding:1rem;text-align:center;">${t('group.add.available.empty')}</p>`;
    }
}

function confirmAddModsToGroup() {
    const selectedModElements = document.querySelectorAll('#addModsToGroupList input[type="checkbox"]:checked');
    const modsToAdd = Array.from(selectedModElements).map(el => el.value);
    if (modsToAdd.length === 0) {
        showToast('group.add.need_select_mod', 'warning');
        return;
    }
    const confirmButton = document.querySelector('#addToSimilarModGroupModal button[onclick="addModsToSimilarGroup()"]');
    callIPC('add-mods-to-similar-group', { group_id: currentGroupIdForAddingMods, mod_names: modsToAdd }, (result) => {
        if (result.success) {
            showToast('group.add.success', 'success');
            closeModal('addModsToGroupModal');
            openSimilarModManagementModal();
            loadAndRenderModList();
        } else {
            showToast(result.message || t('group.add.failed'), 'error');
        }
    }, confirmButton);
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

// Drag & Drop
function initializeDragAndDrop() {
    const modList = document.querySelector('.mod-list');
    const scrollContainer = document.querySelector('.mod-list-scroll-area');

    // 调用外部文件拖拽初始化
    setupExternalFileDrop();

    if (!modList || !scrollContainer) return;

    // ModList listeners - keeping dragover/drop restricted to the list for sorting logic
    modList.removeEventListener('dragover', handleDragOver);
    modList.removeEventListener('drop', handleDrop);
    document.removeEventListener('dragend', handleDragEnd);

    document.querySelectorAll('.mod-list > .mod-item[draggable="true"], .mod-list > .component-wrapper[draggable="true"]').forEach(item => {
        item.removeEventListener('dragstart', handleDragStart);
    });

    if (currentSortMethod !== 'default') {
        modList.classList.add('no-drag');
        return;
    }

    modList.classList.remove('no-drag');
    document.querySelectorAll('.mod-list > .mod-item[draggable="true"], .mod-list > .component-wrapper[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
    });

    modList.addEventListener('dragover', handleDragOver);
    modList.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd);
}

// 新增：外部文件拖拽处理
let isExternalDropInitialized = false;
function setupExternalFileDrop() {
    if (isExternalDropInitialized) return;
    isExternalDropInitialized = true;

    // 创建拖拽遮罩层
    let overlay = document.getElementById('external-drop-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'external-drop-overlay';
        overlay.innerHTML = `<div class="drop-message"><i class="fas fa-file-import" style="font-size: 4rem; margin-bottom: 1rem;"></i><br>${t('external_drop.message')}</div>`;
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.8); z-index: 20000;
            display: none; justify-content: center; align-items: center;
            color: var(--accent-blue, #7aa2f7); font-size: 2rem;
            backdrop-filter: blur(5px); pointer-events: none;
        `;
        document.body.appendChild(overlay);

        const msg = overlay.querySelector('.drop-message');
        msg.style.textAlign = 'center';
        msg.style.pointerEvents = 'none';
    }

    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        // 忽略内部拖拽 (如果是内部拖拽，draggedItems 会有内容)
        if (draggedItems && draggedItems.length > 0) return;
        if (!e.dataTransfer.types.includes('Files')) return;

        e.preventDefault();
        dragCounter++;
        overlay.style.display = 'flex';
    });

    window.addEventListener('dragleave', (e) => {
        if (draggedItems && draggedItems.length > 0) return;
        if (!e.dataTransfer.types.includes('Files')) return;

        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            overlay.style.display = 'none';
        }
    });

    window.addEventListener('dragover', (e) => {
        // If internal drag (mods or sub-mods) is active, don't interfere
        if (draggedItems && draggedItems.length > 0) return;
        if (draggedSubMod) return;

        // Only handle external file drops
        if (!e.dataTransfer.types.includes('Files')) return;

        // For external files, prevent default to enable drop
        // But DON'T call stopPropagation - let custom scroll handler work
        e.preventDefault();
    });

    window.addEventListener('drop', async (e) => {
        if (draggedItems && draggedItems.length > 0) return;
        if (!e.dataTransfer.types.includes('Files')) return;

        e.preventDefault();
        dragCounter = 0;
        overlay.style.display = 'none';

        // 获取拖入的文件/文件夹路径
        // 注意：e.dataTransfer.files 在 Electron 中包含 'path' 属性
        const files = Array.from(e.dataTransfer.files).map(f => f.path);

        if (files.length > 0) {
            showLoadingOverlay();
            try {
                const result = await ipcRenderer.invoke('add-dropped-mods', files);
                if (result.success) {
                    showToast(result.message, 'success', 5000);
                    // Force default sort (new mods are at the top) and reset scroll
                    if (currentSortMethod !== 'default') {
                        currentSortMethod = 'default';
                        // Update sort button UI if exists (optional but good)
                    }
                    loadAndRenderModList();
                    // Scroll to top to show new mods
                    const scrollContainer = document.querySelector('.mod-list-scroll-area');
                    if (scrollContainer) scrollContainer.scrollTop = 0;

                    refreshTagFilters();
                } else {
                    showToast(result.message, 'warning');
                }
            } catch (err) {
                showToast('mod.add.failed', 'error', 3000, { message: err.message });
            } finally {
                hideLoadingOverlay();
            }
        }
    });
}

function handleDragStart(e) {
    console.log('[DRAG DEBUG] handleDragStart called');
    if (currentSortMethod !== 'default') {
        console.log('[DRAG DEBUG] Not in default sort mode, preventing drag');
        e.preventDefault();
        return;
    }
    const draggedItem = e.currentTarget;
    console.log('[DRAG DEBUG] Dragged item:', draggedItem);
    if (draggedItem.classList.contains('selected')) {
        draggedItems = Array.from(document.querySelectorAll('.mod-list > .mod-item.selected, .mod-list > .component-wrapper.selected'));
    } else {
        draggedItems = [draggedItem];
    }
    if (draggedItems.length === 0) {
        e.preventDefault();
        return;
    }

    // --- UNDO: snapshot the current DOM order BEFORE the drag ---
    window._modPreDropOrder = Array.from(
        document.querySelectorAll('.mod-list > .mod-item, .mod-list > .component-wrapper')
    ).flatMap(item => {
        if (item.classList.contains('component-wrapper')) {
            return Array.from(item.querySelectorAll('.mod-item')).map(m => m.dataset.modName);
        }
        return item.dataset.modName;
    }).filter(Boolean);

    e.dataTransfer.effectAllowed = 'move';

    // Create custom drag image
    const dragImage = document.createElement('div');
    dragImage.className = 'custom-drag-ghost';

    // Choose icon based on drag type
    const isGroup = draggedItems.some(item => item.classList.contains('component-wrapper'));
    const iconClass = isGroup ? 'fa-layer-group' : 'fa-box';

    // Construct ghost content
    dragImage.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">
            ${draggedItems.length === 1 ? (draggedItems[0].querySelector('.mod-name, .component-header span')?.textContent || t('drag.ghost.single')) : t('drag.ghost.multi')}
        </span>
        ${draggedItems.length > 1 ? `<span class="badge-count">${draggedItems.length}</span>` : ''}
    `;

    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    document.body.classList.add('is-dragging');

    // Add global scroll listener immediately to avoid race conditions
    // Use capture phase (true) to ensure this handler runs FIRST, before any bubbling handlers
    document.addEventListener('dragover', handleDragOverScroll, true);

    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) {
        // DISABLE SMOOTH SCROLL to prevent interference during drag
        scrollContainer.style.scrollBehavior = 'auto';
    }

    setTimeout(() => {
        draggedItems.forEach(item => item.classList.add('dragging'));
        if (document.body.contains(dragImage)) {
            document.body.removeChild(dragImage);
        }
    }, 0);
}

function handleDragOver(e) {
    if (currentSortMethod !== 'default' || draggedItems.length === 0) {
        console.log('[DRAG DEBUG] handleDragOver skipped - sortMethod:', currentSortMethod, 'draggedItems:', draggedItems.length);
        return;
    }
    e.preventDefault(); // Needed for drag-and-drop to work
    e.dataTransfer.dropEffect = 'move';
    console.log('[DRAG DEBUG] handleDragOver processing');

    const target = e.target.closest('.mod-list > .mod-item[draggable="true"], .mod-list > .component-wrapper[draggable="true"]');

    // Clean up old swap targets
    document.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));

    if (target && !draggedItems.includes(target)) {
        const rect = target.getBoundingClientRect();

        // 分成三部分：上半部分（向上挤）、中间部分（交换）、下半部分（向下挤）
        const y = e.clientY - rect.top;
        const threshold = rect.height * 0.25; // 边缘 25% 认为是插入

        const isDropBefore = y < threshold;
        const isDropAfter = y > rect.height - threshold;
        const isSwap = !isDropBefore && !isDropAfter;

        const existingPlaceholder = document.getElementById('drag-placeholder');

        if (isSwap) {
            // 交换模式：高亮目标元素，隐藏占位符
            target.classList.add('swap-target');
            if (existingPlaceholder) existingPlaceholder.style.display = 'none';
        } else {
            // 插入模式
            if (!existingPlaceholder) {
                const placeholder = document.createElement('div');
                placeholder.id = 'drag-placeholder';
                const isGroupDrag = draggedItems.some(item => item.classList.contains('component-wrapper'));

                if (isGroupDrag) {
                    placeholder.className = 'drag-placeholder group-placeholder';
                } else {
                    placeholder.className = 'drag-placeholder mod-placeholder';
                }

                if (isDropBefore) {
                    target.parentNode.insertBefore(placeholder, target);
                } else {
                    target.parentNode.insertBefore(placeholder, target.nextSibling);
                }
            } else {
                existingPlaceholder.style.display = '';
                // 只有位置确实改变时才移动 placeholder
                if (isDropBefore && existingPlaceholder.nextElementSibling !== target) {
                    target.parentNode.insertBefore(existingPlaceholder, target);
                } else if (isDropAfter && existingPlaceholder.previousElementSibling !== target) {
                    target.parentNode.insertBefore(existingPlaceholder, target.nextSibling);
                }
            }
        }
    } else {
        const existingPlaceholder = document.getElementById('drag-placeholder');
        if (existingPlaceholder) existingPlaceholder.style.display = '';
    }
}

function handleDrop(e) {
    if (currentSortMethod !== 'default' || draggedItems.length === 0) {
        return;
    }
    e.preventDefault();

    const placeholder = document.getElementById('drag-placeholder');
    const swapTarget = document.querySelector('.swap-target');

    if (swapTarget) {
        const parent = swapTarget.parentNode;

        // 如果互换，我们应该先记录被拖拽元素原来的位置
        if (draggedItems.length === 1 && swapTarget !== draggedItems[0]) {
            // 互换两个独立的 DOM 节点
            const dragHolder = document.createElement('div');
            // 占住拖动元素原位置
            parent.insertBefore(dragHolder, draggedItems[0]);

            // 交换
            parent.insertBefore(draggedItems[0], swapTarget);
            parent.insertBefore(swapTarget, dragHolder);

            // 移除占位
            dragHolder.remove();
        } else {
            // 如果是多选拖拽互换，简单实现：将被拖动项放到目标位置之前，目标保持原位（等同于插入）
            draggedItems.forEach(item => parent.insertBefore(item, swapTarget));
        }

        swapTarget.classList.remove('swap-target');
        if (placeholder) placeholder.remove();
        saveModOrder();
    } else if (placeholder) {
        // 正常插入逻辑
        draggedItems.forEach(item => placeholder.parentNode.insertBefore(item, placeholder));
        placeholder.remove();
        saveModOrder();
    }
}

function handleDragEnd() {
    stopAutoScroll();
    // Remove global scroll listener (must match addEventListener with capture=true)
    document.removeEventListener('dragover', handleDragOverScroll, true);

    document.body.classList.remove('is-dragging');

    // RE-ENABLE SMOOTH SCROLL (or remove inline style to revert to css)
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) {
        scrollContainer.style.scrollBehavior = '';
    }

    const placeholder = document.getElementById('drag-placeholder');
    if (placeholder) placeholder.remove();
    draggedItems.forEach(item => item.classList.remove('dragging'));
    draggedItems = [];
}


// Local constants removed, using global variables from core.js: window.SCROLL_ZONE_SIZE, MAX_AUTO_SCROLL_SPEED

function handleDragOverScroll(e) {
    // Check for either regular mods or sub-mods being dragged
    if ((!draggedItems || draggedItems.length === 0) && !draggedSubMod) {
        stopAutoScroll();
        return;
    }

    // Prevent browser's default drag scroll behavior
    // This is crucial for our custom auto-scroll to work without interference from the browser's small fixed scroll zones.
    e.preventDefault();
    // e.stopPropagation(); // REMOVED: Allow event to bubble to mod-list for handleDragOver logic

    const container = document.querySelector('.mod-list-scroll-area');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY;
    const mouseX = e.clientX;

    // Check horizontal bounds: if mouse is outside the list width, don't scroll
    // RELAXED CHECK: Allow 100px buffer to prevent stopping when slightly outside
    if (mouseX < rect.left - 100 || mouseX > rect.right + 100) {
        stopAutoScroll();
        return;
    }

    currentScrollSpeed = 0;

    // Ensure effectiveZoneSize is a valid number
    let effectiveZoneSize = parseInt(window.SCROLL_ZONE_SIZE, 10);
    if (isNaN(effectiveZoneSize) || effectiveZoneSize <= 0) {
        effectiveZoneSize = 100; // Fallback default
    }

    // Calculate scroll zones based on CONTAINER edges with custom SCROLL_ZONE_SIZE
    // This means 300px setting = scroll triggers when within 300px of container top/bottom
    const topZoneBottom = rect.top + effectiveZoneSize; // Top zone: from container top to effectiveZoneSize
    const bottomZoneTop = rect.bottom - effectiveZoneSize; // Bottom zone: from (container bottom - effectiveZoneSize) to container bottom

    // Calculation Scroll Logic (Container-based)
    // Top Scroll Zone: mouseY is within effectiveZoneSize pixels from container top
    if (mouseY >= rect.top && mouseY < topZoneBottom) {
        // Only scroll if container has room to scroll up (not already at top)
        if (container.scrollTop > 0) {
            // Distance from top of container. The higher the mouse (smaller y), the larger the dist.
            // When mouseY = topZoneBottom, dist = 0
            // When mouseY = rect.top, dist = effectiveZoneSize (ratio=1)
            const dist = topZoneBottom - mouseY;

            // Calculate ratio
            let ratio = dist / effectiveZoneSize;
            if (ratio > 2.5) ratio = 2.5;

            currentScrollSpeed = -MAX_AUTO_SCROLL_SPEED * ratio;
        }
    }
    // Bottom Scroll Zone: mouseY is within effectiveZoneSize pixels from container bottom
    else if (mouseY <= rect.bottom && mouseY > bottomZoneTop) {
        // Only scroll if container has room to scroll down (not already at bottom)
        if (container.scrollTop < container.scrollHeight - container.clientHeight) {
            const dist = mouseY - bottomZoneTop;
            let ratio = dist / effectiveZoneSize;
            if (ratio > 2.5) ratio = 2.5;

            currentScrollSpeed = MAX_AUTO_SCROLL_SPEED * ratio;
        }
    }

    // Allow scroll speed updates even when animation is already running
    // Start animation if we have significant scroll speed and no animation is running
    if (Math.abs(currentScrollSpeed) > 0.5) {
        if (!scrollAnimationId) {
            autoScroll();
        }
    }
    // Stop animation if scroll speed is too low
    else if (Math.abs(currentScrollSpeed) <= 0.5 && scrollAnimationId) {
        stopAutoScroll();
    }
}

function autoScroll() {
    const container = document.querySelector('.mod-list-scroll-area');
    if (!container || (draggedItems.length === 0 && !draggedSubMod) || currentScrollSpeed === 0) {
        stopAutoScroll();
        return;
    }
    container.scrollBy(0, currentScrollSpeed);
    scrollAnimationId = requestAnimationFrame(autoScroll);
}

function stopAutoScroll() {
    if (scrollAnimationId) {
        cancelAnimationFrame(scrollAnimationId);
        scrollAnimationId = null;
    }
    currentScrollSpeed = 0;
}

function saveModOrder() {
    // Use the pre-drag snapshot captured in handleDragStart
    const previousOrder = window._modPreDropOrder || [];

    const newOrder = Array.from(document.querySelectorAll('.mod-list > .mod-item, .mod-list > .component-wrapper'))
        .flatMap(item => {
            if (item.classList.contains('component-wrapper')) {
                return Array.from(item.querySelectorAll('.mod-item')).map(modItem => modItem.dataset.modName);
            }
            return item.dataset.modName;
        });
    callIPC('save-mod-order', { order: newOrder }, (result) => {
        if (result.success) {
            showToast('toast.order.save.success', 'success');
            clearAllSelections();

            // --- UNDO: restore previous order ---
            if (window.undoManager && previousOrder.length > 0) {
                window.undoManager.push({
                    description: t('undo.desc.mod_sort'),
                    undo: () => {
                        callIPC('save-mod-order', { order: previousOrder }, (r) => {
                            if (r.success) loadAndRenderModList();
                        }, null, true);
                    }
                });
            }
        } else {
            showToast('toast.order.save.fail', 'error');
            loadAndRenderModList();
        }
    });
}

function initializeSubModDragAndDrop() {
    document.querySelectorAll('.sub-mods-list').forEach(subModList => {
        const items = subModList.querySelectorAll('.sub-mod-item');
        items.forEach(item => {
            item.removeEventListener('dragstart', handleSubModDragStart);
            item.removeEventListener('dragend', handleSubModDragEnd);
            item.addEventListener('dragstart', handleSubModDragStart);
            item.addEventListener('dragend', handleSubModDragEnd);
        });
        subModList.removeEventListener('dragover', handleSubModDragOver);
        subModList.removeEventListener('drop', handleSubModDrop);
        subModList.addEventListener('dragover', handleSubModDragOver);
        subModList.addEventListener('drop', handleSubModDrop);
    });
}

function handleSubModDragStart(e) {
    if (currentSortMethod !== 'default') {
        e.preventDefault();
        return;
    }
    e.stopPropagation();
    draggedSubMod = e.currentTarget;

    // --- UNDO: snapshot the order BEFORE the drag so we can restore it ---
    const subModListEl = draggedSubMod.closest('.sub-mods-list');
    if (subModListEl) {
        window._subModPreDropOrder = {
            parentModName: subModListEl.dataset.parentModName,
            order: Array.from(subModListEl.querySelectorAll('.sub-mod-item')).map(i => i.dataset.subModName)
        };
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sub-mod');

    // Enable dragover scroll wrapper
    document.addEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.add('is-dragging');

    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) {
        // DISABLE SMOOTH SCROLL to prevent interference during drag
        scrollContainer.style.scrollBehavior = 'auto';
    }

    setTimeout(() => {
        if (draggedSubMod) draggedSubMod.classList.add('dragging');
    }, 0);
}

function handleSubModDragOver(e) {
    e.preventDefault();
    // Removed e.stopPropagation() to allow dragover to bubble up to document behavior (for auto-scroll)
    if (!draggedSubMod) return;
    const subModList = e.currentTarget;
    const afterElement = getDragAfterElement(subModList, e.clientY);
    const placeholder = subModList.querySelector('.sub-mod-placeholder');
    const newPlaceholder = placeholder || document.createElement('div');
    if (!placeholder) {
        newPlaceholder.className = 'sub-mod-placeholder';
    }
    if (afterElement == null) {
        if (newPlaceholder.nextElementSibling !== null || newPlaceholder.parentElement !== subModList) {
            subModList.appendChild(newPlaceholder);
        }
    } else {
        if (newPlaceholder.nextElementSibling !== afterElement || newPlaceholder.parentElement !== subModList) {
            subModList.insertBefore(newPlaceholder, afterElement);
        }
    }
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.sub-mod-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleSubModDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedSubMod) return;
    const subModList = e.currentTarget;
    const placeholder = subModList.querySelector('.sub-mod-placeholder');
    if (placeholder) {
        subModList.insertBefore(draggedSubMod, placeholder);
        placeholder.remove();
    }
    const parentModName = subModList.dataset.parentModName;
    saveSubModOrder(parentModName);
}

function handleSubModDragEnd(e) {
    e.stopPropagation();

    stopAutoScroll();
    document.removeEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.remove('is-dragging');

    // RE-ENABLE SMOOTH SCROLL
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) {
        scrollContainer.style.scrollBehavior = '';
    }

    if (draggedSubMod) draggedSubMod.classList.remove('dragging');
    document.querySelectorAll('.sub-mod-placeholder').forEach(p => p.remove());
    draggedSubMod = null;
}

function saveSubModOrder(parentModName) {
    const subModList = document.getElementById(`sub-mods-${parentModName}`);
    if (!subModList) return;

    // Snapshot CURRENT order from DOM for undo
    const previousOrder = Array.from(subModList.querySelectorAll('.sub-mod-item')).map(item => item.dataset.subModName);

    const newOrder = [...previousOrder]; // same list, reorder happened before this call
    callIPC('save-sub-mod-order', { parentModName, order: newOrder }, (result) => {
        if (result.success) {
            showToast('toast.submod_order.save.success', 'success');

            // --- UNDO: restore previous sub-mod order ---
            if (window.undoManager && previousOrder.length > 1) {
                // We need to track what the order was BEFORE the drag.
                // The current DOM already has the new order at this point.
                // So we capture the pre-drop order stored in a closure when drag started.
                // We'll use a module-level var set on dragstart instead.
                const preDropOrder = window._subModPreDropOrder;
                if (preDropOrder && preDropOrder.parentModName === parentModName) {
                    const frozenOrder = [...preDropOrder.order];
                    window.undoManager.push({
                        description: t('undo.desc.submod_sort', { parent: parentModName }),
                        undo: () => {
                            callIPC('save-sub-mod-order', { parentModName, order: frozenOrder }, (r) => {
                                if (r.success) loadAndRenderModList();
                            }, null, true);
                        }
                    });
                }
            }
        } else {
            showToast('toast.submod_order.save.fail', 'error');
            loadAndRenderModList();
        }
    });
}

function changeSortOrder(sortType) {
    currentSortMethod = sortType;
    loadAndRenderModList();
}

function applyClientSideSorting(items, sortMethod) {
    const sortedItems = [...items];
    if (sortMethod === 'default') {
        sortedItems.sort((a, b) => {
            const orderA = a.display_order ?? Infinity;
            const orderB = b.display_order ?? Infinity;
            if (orderA !== orderB) return orderA - orderB;
            const valA = a.type === 'mod' ? a.mod.display_name : a.component_name;
            const valB = b.type === 'mod' ? b.mod.display_name : b.component_name;
            return valA.localeCompare(valB, 'zh-CN', { sensitivity: 'base' });
        });
        return sortedItems;
    }
    if (sortMethod === 'tags') {
        sortedItems.sort((a, b) => {
            const getFirstTag = (item) => {
                if (item.type === 'mod' && item.mod.tags && item.mod.tags.length > 0) {
                    return item.mod.tags[0];
                }
                return null;
            };
            const tagA = getFirstTag(a);
            const tagB = getFirstTag(b);
            if (tagA && !tagB) return -1;
            if (!tagA && tagB) return 1;
            if (!tagA && !tagB) return 0;
            const tagCompare = tagA.localeCompare(tagB, 'zh-CN');
            if (tagCompare !== 0) return tagCompare;
            const nameA = a.type === 'mod' ? a.mod.display_name : a.component_name;
            const nameB = b.type === 'mod' ? b.mod.display_name : b.component_name;
            return nameA.localeCompare(nameB, 'zh-CN');
        });
        return sortedItems;
    }
    sortedItems.sort((a, b) => {
        const valA = a.type === 'mod' ? a.mod.display_name : a.component_name;
        const valB = b.type === 'mod' ? b.mod.display_name : b.component_name;
        const comparison = valA.localeCompare(valB, 'zh-CN', { sensitivity: 'base' });
        return sortMethod.endsWith('-reverse') ? -comparison : comparison;
    });
    return sortedItems;
}

// -----------------------------------------------------------
// NEW: Preview Image Follow Cursor Implementation
// -----------------------------------------------------------
function updatePreviewPosition(e) {
    const container = document.getElementById('modPreviewContainer');
    // 如果元素不存在或不可见，则不更新
    if (!container || !container.classList.contains('visible')) return;

    // 偏移量，防止鼠标遮挡
    const offset = 20;
    let top = e.clientY + offset;
    let left = e.clientX + offset;

    // 边界检查：防止预览图超出屏幕右侧或底部
    const rect = container.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 如果右边缘超出视口，向左移动
    if (left + rect.width > viewportWidth) {
        left = e.clientX - rect.width - offset;
    }

    // 如果下边缘超出视口，向上移动
    if (top + rect.height > viewportHeight) {
        top = e.clientY - rect.height - offset;
    }

    // 防止左/上边缘溢出
    if (left < 0) left = offset;
    if (top < 0) top = offset;

    // 应用位置
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
}

// Obsolete applyBatchTags removed
// The correct implementation is in js/mod-manager.js using the new Tag Cloud system.

// 导出函数
window.confirmToggleGroupConflict = confirmToggleGroupConflict;

// ==========================================================================
// DOWNLOAD & INSTALLATION LOGIC (下载与安装逻辑)
// ==========================================================================

let currentDownloadData = null;

/**
 * 打开下载文件所在位置
 */
function openDownloadLocation() {
    const { shell } = require('electron');
    if (currentDownloadData && currentDownloadData.tempPath) {
        // 在文件管理器中显示文件
        shell.showItemInFolder(currentDownloadData.tempPath);
    } else {
        showToast('download.path.not_found', 'error');
    }
}
window.openDownloadLocation = openDownloadLocation;

/**
 * 打开下载文件选择模态框
 * @param {Object} data - { tempPath, originalFilename, entries: [{path, name, isDirectory, size}] }
 */
function openDownloadSelectionModal(data) {
    // 确保依赖引入 (如果文件头部未引入)
    const { ipcRenderer } = require('electron');

    currentDownloadData = data;
    const modal = document.getElementById('downloadSelectionModal');

    // 设置文件名显示
    const fileNameEl = document.getElementById('downloadedFileName');
    if (fileNameEl) fileNameEl.textContent = data.originalFilename;

    // 设置默认 Mod 名称 (去除扩展名)
    const nameWithoutExt = data.originalFilename.replace(/\.[^/.]+$/, "");
    const nameInput = document.getElementById('installModName');
    if (nameInput) nameInput.value = nameWithoutExt;

    // 重置选项状态
    const newGroupCheckbox = document.getElementById('installAsNewModGroup');
    const nameInputContainer = document.getElementById('newModNameInputContainer');

    if (newGroupCheckbox) {
        newGroupCheckbox.checked = true; // 默认作为新 Mod，防止意外覆盖
        // 绑定切换事件
        newGroupCheckbox.onchange = (e) => {
            if (nameInputContainer) {
                nameInputContainer.style.display = e.target.checked ? 'block' : 'none';
            }
        };
        // 触发一次以设置初始状态
        newGroupCheckbox.dispatchEvent(new Event('change'));
    }

    // 渲染文件树
    renderDownloadFileTree(data.entries);

    // 显示模态框
    if (modal) modal.style.display = 'flex';
}
window.openDownloadSelectionModal = openDownloadSelectionModal;

/**
 * 分析文件夹结构，确定哪些文件夹可以选择
 */
function analyzeFolders(entries) {
    const path = require('path');
    const folders = {};

    // 初始化所有文件夹
    entries.forEach(entry => {
        const normalizedPath = entry.path.replace(/\\/g, '/');

        if (entry.isDirectory) {
            // 初始化文件夹
            if (!folders[normalizedPath]) {
                folders[normalizedPath] = {
                    hasPak: false,
                    hasSubfolders: false,
                    files: [],
                    subfolders: new Set()
                };
            }
        } else {
            // 处理文件
            const dir = path.dirname(normalizedPath).replace(/\\/g, '/');

            // 初始化文件所在的文件夹
            if (!folders[dir]) {
                folders[dir] = {
                    hasPak: false,
                    hasSubfolders: false,
                    files: [],
                    subfolders: new Set()
                };
            }

            // 记录文件
            folders[dir].files.push(entry);
            if (entry.name.toLowerCase().endsWith('.pak')) {
                folders[dir].hasPak = true;
            }
        }
    });

    // 标记包含子文件夹的文件夹
    Object.keys(folders).forEach(folderPath => {
        if (folderPath === '.' || folderPath === '') return;

        const parentDir = path.dirname(folderPath).replace(/\\/g, '/');

        // 如果父目录存在，标记它包含子文件夹
        if (folders[parentDir]) {
            folders[parentDir].hasSubfolders = true;
        }
    });

    return folders;
}

/**
 * 渲染文件树结构（文件夹选择模式）
 * @param {Array} entries - zip entries list
 */
function renderDownloadFileTree(entries) {
    const container = document.getElementById('downloadFileTree');
    if (!container) return;
    container.innerHTML = '';

    // 分析文件夹结构
    const folderAnalysis = analyzeFolders(entries);

    // 1. 构建树形数据结构
    const tree = {};
    entries.forEach(entry => {
        // 统一路径分隔符
        const normalizedPath = entry.path.replace(/\\/g, '/');
        const parts = normalizedPath.split('/').filter(p => p);

        let currentLevel = tree;
        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                const currentPath = parts.slice(0, index + 1).join('/');
                currentLevel[part] = {
                    name: part,
                    path: currentPath,
                    children: {},
                    isFile: (index === parts.length - 1) && !entry.isDirectory,
                    originalEntry: (index === parts.length - 1) ? entry : null
                };
            }
            currentLevel = currentLevel[part].children;
        });
    });

    // 2. 递归生成 HTML
    function createTreeHTML(nodeObj, parentPath = '') {
        const ul = document.createElement('ul');
        ul.className = 'file-tree-list';

        const sortedKeys = Object.keys(nodeObj).sort((a, b) => {
            const nodeA = nodeObj[a];
            const nodeB = nodeObj[b];
            if (nodeA.isFile === nodeB.isFile) return a.localeCompare(b);
            return nodeA.isFile ? 1 : -1;
        });

        sortedKeys.forEach(key => {
            const node = nodeObj[key];
            const li = document.createElement('li');
            li.className = 'file-tree-item';

            const hasChildren = Object.keys(node.children).length > 0;
            const iconClass = node.isFile ? 'fa-file-alt' : 'fa-folder';
            const iconColor = node.isFile ? 'var(--text-secondary)' : 'var(--accent-yellow)';

            if (node.isFile) {
                // 文件：只显示，不显示复选框
                const sizeInfo = `<span class="file-size" style="color:var(--text-disabled); font-size:0.85em; margin-left:8px;">(${formatBytes(node.originalEntry.size)})</span>`;
                const isPak = node.name.toLowerCase().endsWith('.pak');
                const pakBadge = isPak ? '<span class="pak-badge" style="background:var(--accent-green);color:#fff;font-size:0.7em;padding:2px 6px;border-radius:4px;margin-left:8px;">PAK</span>' : '';

                li.innerHTML = `
                    <div class="tree-row" style="display:flex; align-items:center; padding:4px 0;">
                        <span style="width:20px;"></span>
                        <i class="fas ${iconClass}" style="color: ${iconColor}; margin-right: 8px; width:16px; text-align:center;"></i>
                        <span class="node-name" style="flex:1;">${node.name}</span>
                        ${pakBadge}
                        ${sizeInfo}
                    </div>
                `;
            } else {
                // 文件夹：检查是否可选
                // 对于根级别的文件夹，需要特殊处理
                let folderInfo;
                if (!node.path || node.path === '' || !node.path.includes('/')) {
                    // 这是根级别的文件夹，检查该文件夹本身的信息
                    folderInfo = folderAnalysis[node.path] || { hasPak: false, hasSubfolders: false };
                } else {
                    folderInfo = folderAnalysis[node.path] || { hasPak: false, hasSubfolders: false };
                }

                const canSelect = folderInfo.hasPak && !folderInfo.hasSubfolders;

                if (canSelect) {
                    // 可选择的文件夹
                    const checkboxId = `folder-check-${node.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    li.innerHTML = `
                        <div class="tree-row selectable-folder" style="display:flex; align-items:center; padding:4px 0; background:rgba(158, 206, 106, 0.05); border-radius:4px; padding-left:4px;">
                            <span class="tree-toggle ${hasChildren ? '' : 'hidden'}" style="width:20px; text-align:center; cursor:pointer; color:var(--text-secondary);">
                                <i class="fas fa-chevron-right" style="font-size:0.8em;"></i>
                            </span>
                            <input type="checkbox" id="${checkboxId}" class="mod-checkbox folder-checkbox" 
                                data-path="${node.path}" 
                                style="margin-right:8px;">
                            <i class="fas ${iconClass}" style="color: var(--accent-green); margin-right: 8px; width:16px; text-align:center;"></i>
                            <span class="node-name" style="flex:1;">${node.name}</span>
                            <span class="pak-badge" style="background:var(--accent-green);color:#fff;font-size:0.7em;padding:2px 6px;border-radius:4px;">${t('download.tree.contains_pak')}</span>
                        </div>
                    `;
                } else {
                    // 不可选择的文件夹
                    const reason = !folderInfo.hasPak ? `<span class="hint" style="color:var(--text-disabled);font-size:0.8em;margin-left:8px;">${t('download.tree.no_pak')}</span>` :
                        folderInfo.hasSubfolders ? `<span class="hint" style="color:var(--text-disabled);font-size:0.8em;margin-left:8px;">${t('download.tree.contains_subfolders')}</span>` : '';

                    li.innerHTML = `
                        <div class="tree-row disabled-folder" style="display:flex; align-items:center; padding:4px 0; opacity:0.6;">
                            <span class="tree-toggle ${hasChildren ? '' : 'hidden'}" style="width:20px; text-align:center; cursor:pointer; color:var(--text-secondary);">
                                <i class="fas fa-chevron-right" style="font-size:0.8em;"></i>
                            </span>
                            <i class="fas ${iconClass}" style="color: ${iconColor}; margin-right: 8px; width:16px; text-align:center; margin-left:4px;"></i>
                            <span class="node-name" style="flex:1;">${node.name}</span>
                            ${reason}
                        </div>
                    `;
                }
            }

            // 如果有子节点，递归生成
            if (hasChildren) {
                const childrenContainer = createTreeHTML(node.children, node.path);
                childrenContainer.style.display = 'none';
                childrenContainer.style.paddingLeft = '22px';
                li.appendChild(childrenContainer);

                // 绑定折叠/展开事件
                const toggleBtn = li.querySelector('.tree-toggle');
                if (toggleBtn) {
                    toggleBtn.onclick = (e) => {
                        e.stopPropagation();
                        const icon = toggleBtn.querySelector('i');
                        const children = li.querySelector('.file-tree-list');
                        if (children.style.display === 'none') {
                            children.style.display = 'block';
                            icon.classList.remove('fa-chevron-right');
                            icon.classList.add('fa-chevron-down');
                        } else {
                            children.style.display = 'none';
                            icon.classList.remove('fa-chevron-down');
                            icon.classList.add('fa-chevron-right');
                        }
                    };
                }
            }

            ul.appendChild(li);
        });
        return ul;
    }

    container.appendChild(createTreeHTML(tree));

    // 特殊处理：如果根目录有文件，添加一个虚拟的"根文件夹"选项
    const rootFiles = entries.filter(e => !e.isDirectory && !e.path.includes('/') && !e.path.includes('\\'));
    if (rootFiles.length > 0) {
        const hasRootPak = rootFiles.some(f => f.name.toLowerCase().endsWith('.pak'));

        if (hasRootPak) {
            // 在树的最前面插入一个虚拟的根文件夹选项
            const rootOption = document.createElement('div');
            rootOption.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(158, 206, 106, 0.1); border:2px solid var(--accent-green); border-radius:8px;';
            rootOption.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <input type="checkbox" id="folder-check-root" class="mod-checkbox folder-checkbox" 
                        data-path="." 
                        style="width:18px; height:18px;">
                    <i class="fas fa-folder-open" style="color:var(--accent-green); font-size:1.2rem;"></i>
                    <div style="flex:1;">
                        <div style="font-weight:600; color:var(--text-primary);">${t('download.tree.root_files.title')}</div>
                        <div style="font-size:0.85em; color:var(--text-secondary);">${t('download.tree.root_files.desc', { count: rootFiles.length })}</div>
                    </div>
                    <span class="pak-badge" style="background:var(--accent-green);color:#fff;font-size:0.75em;padding:4px 8px;border-radius:4px;">${t('download.tree.contains_pak')}</span>
                </div>
            `;
            container.insertBefore(rootOption, container.firstChild);
        }
    }

    // 自动展开根目录
    const rootUl = container.querySelector('.file-tree-list');
    if (rootUl && rootUl.children.length < 10) {
        Array.from(rootUl.children).forEach(li => {
            const toggle = li.querySelector('.tree-toggle:not(.hidden)');
            if (toggle) toggle.click();
        });
    }
}
window.handleFileTreeCheckbox = handleFileTreeCheckbox;

/**
 * 处理树形结构中的复选框联动
 */
function handleFileTreeCheckbox(checkbox) {
    const li = checkbox.closest('li');
    const isChecked = checkbox.checked;

    // 1. 向下联动：选中/取消选中所有子孙节点
    // 找到该 li 下面直接包含的 ul (子列表)
    // 注意：createTreeHTML 结构是 li -> div(row) + ul(children)
    // 我们需要查找该 li 内部的所有 checkbox

    // 获取该节点下的所有子容器
    const childrenContainer = li.querySelector('ul.file-tree-list');
    if (childrenContainer) {
        const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
        childCheckboxes.forEach(cb => cb.checked = isChecked);
    }

    // 2. (可选) 向上联动：如果同级全选，则父级选中；否则父级取消选中
    // 为了简化逻辑和用户自由度，这里暂不强制向上联动，
    // 因为用户可能只想解压文件夹里的某一个文件而不选文件夹本身(逻辑上文件夹只是路径)
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 确认安装下载
 */
async function confirmInstallDownload() {
    const { ipcRenderer } = require('electron');
    if (!currentDownloadData) return;

    // 获取所有选中的文件夹
    const selectedFolders = document.querySelectorAll('.folder-checkbox:checked');

    if (selectedFolders.length === 0) {
        showToast('download.install.select_folder', 'warning');
        return;
    }

    // 收集选中文件夹中的所有文件
    const selectedEntries = [];
    selectedFolders.forEach(checkbox => {
        const folderPath = checkbox.dataset.path;

        // 找到该文件夹下的所有文件（包括子文件）
        const filesInFolder = currentDownloadData.entries.filter(entry => {
            const entryPath = entry.path.replace(/\\/g, '/');

            // 如果是根文件夹（路径为 '.' 或空），匹配所有不在子文件夹中的文件
            if (folderPath === '.' || folderPath === '') {
                return !entry.isDirectory && !entryPath.includes('/');
            }

            // 否则匹配该文件夹下的所有文件
            return entryPath.startsWith(folderPath + '/') && !entry.isDirectory;
        });
        selectedEntries.push(...filesInFolder.map(f => f.path));
    });

    if (selectedEntries.length === 0) {
        showToast('download.install.no_files', 'warning');
        return;
    }

    // 获取 Mod 名称
    const installAsNew = document.getElementById('installAsNewModGroup').checked;
    let modName = currentDownloadData.originalFilename.replace(/\.[^/.]+$/, ""); // 默认使用文件名

    if (installAsNew) {
        const customName = document.getElementById('installModName').value.trim();
        if (customName) modName = customName;
    }

    // UI 加载状态
    const confirmBtn = document.querySelector('#downloadSelectionModal button[onclick="confirmInstallDownload()"]');
    const originalText = confirmBtn.innerHTML;
    confirmBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> ${t('download.install.installing')}`;
    confirmBtn.disabled = true;

    try {
        const result = await ipcRenderer.invoke('install-selected-download', {
            tempPath: currentDownloadData.tempPath,
            selectedEntries: selectedEntries,
            modName: modName
        });

        if (result.success) {
            showToast('download.install.success', 'success');
            closeModal('downloadSelectionModal');
            showToast('download.install.success', 'success');
            closeModal('downloadSelectionModal');
            loadAndRenderModList();
            refreshTagFilters();
            clearAllSelections(); // Clear selection on success
            refreshTagFilters();
        } else {
            showToast('download.install.failed', 'error', 3000, { message: result.message });
        }
    } catch (e) {
        console.error("Install Error:", e);
        showToast('toast.system.error', 'error', 3000, { message: e.message });
    } finally {
        confirmBtn.innerHTML = originalText;
        confirmBtn.disabled = false;
    }
}
window.confirmInstallDownload = confirmInstallDownload;
window.closeModal = closeModal;
window.applyBatchTags = applyBatchTags;
window.createSimilarModGroup = createSimilarModGroup;
window.deleteSimilarModGroup = deleteSimilarModGroup;
window.openRenameSimilarGroupModal = openRenameSimilarGroupModal;
window.renameSimilarModGroup = renameSimilarModGroup;
window.openAddToSimilarModGroupModal = openAddToSimilarModGroupModal;
window.addModsToSimilarGroup = addModsToSimilarGroup;
window.removeModFromSimilarGroup = removeModFromSimilarGroup;
window.openAddModsToGroupModal = openAddModsToGroupModal;
window.confirmAddModsToGroup = confirmAddModsToGroup;
window.confirmAddSubModRelation = confirmAddSubModRelation;
window.handleNewPreviewImageSelect = handleNewPreviewImageSelect;
window.uploadPreviewImage = uploadPreviewImage;
window.handleNewBackgroundImageSelect = handleNewBackgroundImageSelect;
window.loadBackgroundImages = loadBackgroundImages;
window.clearBackgroundImage = clearBackgroundImage;
window.openAddSubModModal = openAddSubModModal;
window.openSimilarModManagementModal = openSimilarModManagementModal;
window.openSettingsModal = openSettingsModal;

// Game Switching Logic
const switchGameBtn = document.getElementById('switchGameBtn');
if (switchGameBtn) {
    switchGameBtn.addEventListener('click', () => {
        ipcRenderer.invoke('return-to-game-select');
    });
}
