
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

    // 1. 鎺掑簭锛氱‘淇濆垪琛ㄦ寜鏂囦欢鍚嶆帓搴忥紝杩欐牱鏁板瓧閮ㄥ垎鍙互鍙戞尌鎺掑簭浣滅�?
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

            // 娣诲姞鐐瑰嚮浜嬩欢锛氭悳绱㈣鏈嶈
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

        // 鍙抽敭鐐瑰嚮澶嶅埗鑻辨枃鍚嶇О
        item.oncontextmenu = (e) => {
            e.preventDefault();

            const textToCopy = meta?.lookupEntry?.en ? meta.lookupEntry.en : cleanDisplayName;

            copyToClipboard(textToCopy);
            // 鏃㈢劧鏄鍒惰嫳鏂囧悕绉帮紝鍙互鎻愮ず涓€涓?            // showToast(`宸插鍒? ${textToCopy}`, 'success'); // copyToClipboard 鍐呴儴宸叉湁鎻愮�?
        };

        fragment.appendChild(item);
    });

    grid.appendChild(fragment);
}

window.filterClothingImages = function () {
    ensureClothingSearchCaches();
    const query = document.getElementById('clothingSearchInput').value.trim().toLowerCase();

    // Empty query returns full list
    if (!query) {
        renderClothingImages(allClothingImages);
        return;
    }

    const filtered = clothingIndexedMetas.filter(meta => {
        // 1. 鍩虹鍖归厤锛氭枃浠跺悕鎴栨樉绀哄悕
        if (meta.lowerName.includes(query) || meta.lowerDisplay.includes(query) || meta.lowerCleanDisplay.includes(query)) {
            return true;
        }

        // 2. 澧炲己鍖归厤锛氭煡琛ㄥ尮閰嶈嫳鏂?涓�?
        if (meta.lookupEntry) {
            // Match both localized names from lookup map
            return String(meta.lookupEntry.en || '').toLowerCase().includes(query)
                || String(meta.lookupEntry.cn || '').toLowerCase().includes(query);
        }

        return false;
    }).map(meta => meta.img);

    renderClothingImages(filtered);
}

async function handleModMouseEnter(event, modItem) {
    if (document.body.classList.contains('is-dragging') || document.body.classList.contains('is-inner-dragging')) {
        handleModMouseLeave();
        return;
    }

    const modName = modItem.dataset.modName || modItem.dataset.subModName;
    if (!modName) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(async () => {
        if (document.body.classList.contains('is-dragging') || document.body.classList.contains('is-inner-dragging')) {
            handleModMouseLeave();
            return;
        }

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

    // 鍒囨崲鍒扮敾寤婃ā寮忔牱寮?
    modalContent.classList.add('gallery-view');
    modalContent.classList.remove('wide'); // 绉婚櫎鏅€氬妯″紡
    modalContent.style.textAlign = ''; // 娓呴櫎鍐呰仈鏍峰�?

    const mod = globalModDetails.find(m => m.name === modName) || allSubModDetails.find(s => s.name === modName);

    // 闅愯棌鏍囬锛屽洜涓虹敾寤婃ā寮忎笅鎴戜滑涓嶉渶瑕侀《閮ㄦ爣棰樺崰鎹┖�?
    document.getElementById('modPreviewTitle').style.display = 'none';

    const imagesContainer = document.getElementById('modPreviewImagesContainer');
    imagesContainer.innerHTML = '';
    imagesContainer.className = 'mod-preview-images-container gallery-container'; // 娣诲姞鐢诲粖瀹瑰櫒绫?

    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('noPreviewImageMessage').style.display = 'none';
    document.getElementById('previewErrorMessage').style.display = 'none';

    // 闅愯棌鏃х殑鎺у埗鏍忥紝鏀圭敤瑕嗙洊寮忔寜�?
    const oldControls = modal.querySelector('.carousel-controls');
    if (oldControls) oldControls.style.display = 'none';

    // 纭繚鏈夎鐩栧紡瀵艰埅鎸夐挳鍜岃鏁板櫒
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
                // img.alt ... 淇濇寔绠€娲?
                if (index === 0) img.classList.add('active');
                imagesContainer.appendChild(img);
            });

            // 棰勫姞杞?
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

    // 闅愯棌鎵€鏈夛紝鏄剧ず褰撳墠
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

// 杈呭姪鍑芥暟锛氬綋鍏抽棴妯℃€佹鏃堕噸缃牱寮忥紙鍙€夛紝濡傛灉澶嶇敤妯℃€佹鐨勮瘽锛?
function resetPreviewModalStyle() {
    const modalContent = document.querySelector('#modPreviewModal .modal-content');
    if (modalContent) {
        modalContent.classList.remove('gallery-view');
        modalContent.classList.add('wide');
        document.getElementById('modPreviewTitle').style.display = '';
        const oldControls = document.querySelector('#modPreviewModal .carousel-controls');
        if (oldControls) oldControls.style.display = '';

        // 绉婚櫎鍔ㄦ€佹坊鍔犵殑鎸夐挳
        modalContent.querySelectorAll('.gallery-nav-btn, .gallery-counter').forEach(el => el.remove());
    }
}

// 闇€瑕佸�?closeModal 涓皟鐢紝鎴栬€呬笓闂ㄧ洃鍚叧闂簨�?
// 涓轰簡绠€鍗曡捣瑙侊紝鎴戜滑�?showModPreviewModal 寮€澶村仛浜嗛噸�?璁剧疆锛岃繖閲屽彧闇€纭繚鍏抽棴閫昏緫姝ｅ父鍗冲彲�?
// 鐜版湁鐨?window.closeModal 鍙垏鎹?display:none锛屾墍浠ヤ笅娆℃墦寮€鏃朵粛闇€閲嶆柊鍒濆鍖栥�?


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
    return s.replace(/[锛堬�?) ]/g, '').toLowerCase();
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

    // 濡傛灉宸茬粡鏈夋墦寮€鐨勮彍鍗曚笖鏄悓涓€涓猧tem锛屼笉鍋氬鐞嗘垨鑰呴噸鏂版墦寮€锛?
    // 杩欓噷绠€鍗曞鐞嗭細鍏堝叧闂棫鐨勶紙浼氭竻鐞嗘棫鐨刲isteners锛夛紝鍐嶆墦寮€鏂扮�?
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
        // 鍋忕Щ閲忥紝闃叉榧犳爣閬尅
        const offset = 20;
        let top = e.clientY + offset;
        let left = e.clientX + offset;

        // 杈圭晫妫€鏌ワ細闃叉棰勮鍥捐秴鍑哄睆骞曞彸渚ф垨搴曢儴
        const rect = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 濡傛灉鍙宠竟缂樿秴鍑鸿鍙ｏ紝鍚戝乏绉诲�?
        if (left + rect.width > viewportWidth) {
            left = e.clientX - rect.width - offset;
        }

        // 濡傛灉涓嬭竟缂樿秴鍑鸿鍙ｏ紝鍚戜笂绉诲�?
        if (top + rect.height > viewportHeight) {
            top = e.clientY - rect.height - offset;
        }

        // 闃叉宸?涓婅竟缂樻孩�?
        if (left < 0) left = offset;
        if (top < 0) top = offset;

        // 搴旂敤浣嶇疆
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
            // 浣跨�?IPC 杩斿洖鐨勬柊鍚嶇О (result.newName) 鏉ョ‘淇濇彁绀轰俊鎭槸姝ｇ‘鐨?
            // 淇锛氬湪淇敼浼樺厛绾ф垚鍔熷悗锛岀‘淇濇竻闄ゆ墍鏈夐€変腑鐘舵€侊紝閬垮厤鏃х殑 modName 骞叉壈鍚庣画鎿嶄綔銆?
            showToast('mod.priority.update.success', 'success', 3000, { name: result.newName || modName, priority: newPriority });

            // 纭繚寮哄埗閲嶆柊鍔犺浇鍒楄〃锛屽洜涓轰紭鍏堢骇鏀瑰彉娑夊�?Mod 鏂囦欢澶瑰悕绉扮殑閲嶅懡�?
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

// Drag & Drop
function isDragSortEnabled() {
    return currentSortMethod === 'default' && !window.dragSortLocked;
}

function initializeDragAndDrop() {
    const modList = document.querySelector('.mod-list');
    const scrollContainer = document.querySelector('.mod-list-scroll-area');

    // 璋冪敤澶栭儴鏂囦欢鎷栨嫿鍒濆鍖?
    setupExternalFileDrop();

    if (!modList || !scrollContainer) return;

    // ModList listeners - keeping dragover/drop restricted to the list for sorting logic
    modList.removeEventListener('dragover', handleDragOver);
    modList.removeEventListener('dragover', handleDragOverOptimized);
    modList.removeEventListener('drop', handleDrop);
    modList.removeEventListener('drop', handleDropOptimized);
    modList.removeEventListener('dragstart', handleDragStart, true);
    document.removeEventListener('dragend', handleDragEnd);
    document.removeEventListener('dragend', handleDragEndOptimized);
    document.querySelectorAll('.mod-list > .mod-item').forEach(item => {
        item.setAttribute('draggable', 'false');
    });
    document.querySelectorAll('.mod-list > .component-wrapper > .component-header').forEach(header => {
        header.setAttribute('draggable', 'false');
        header.removeEventListener('mousedown', handleComponentHeaderMouseDown, true);
    });
    document.querySelectorAll('.component-wrapper .group-block').forEach(block => {
        block.setAttribute('draggable', 'false');
        block.removeEventListener('dragend', handleGroupBlockDragEnd);
        block.removeEventListener('dragover', handleGroupModDragOver);
        block.removeEventListener('drop', handleGroupModDrop);
    });
    document.querySelectorAll('.component-wrapper .group-block > .block-header').forEach(header => {
        header.setAttribute('draggable', 'false');
        header.removeEventListener('dragstart', handleGroupBlockDragStart);
        header.removeEventListener('dragend', handleGroupBlockDragEnd);
    });
    document.querySelectorAll('.component-wrapper').forEach(wrapper => {
        wrapper.removeEventListener('dragover', handleGroupBlockDragOver);
        wrapper.removeEventListener('drop', handleGroupBlockDrop);
        wrapper.removeEventListener('dragover', handleGroupModDragOver);
        wrapper.removeEventListener('drop', handleGroupModDrop);
    });
    document.querySelectorAll('.component-wrapper .group-block > .mod-item, .component-wrapper > .mod-item').forEach(modItem => {
        modItem.setAttribute('draggable', 'false');
        modItem.removeEventListener('dragstart', handleGroupModDragStart);
        modItem.removeEventListener('dragend', handleGroupModDragEnd);
    });

    if (!isDragSortEnabled()) {
        modList.classList.add('no-drag');
        return;
    }

    modList.classList.remove('no-drag');
    document.querySelectorAll('.mod-list > .mod-item').forEach(item => {
        item.setAttribute('draggable', 'true');
    });
    document.querySelectorAll('.mod-list > .component-wrapper > .component-header').forEach(header => {
        header.setAttribute('draggable', 'false');
        header.addEventListener('mousedown', handleComponentHeaderMouseDown, true);
    });
    modList.addEventListener('dragstart', handleDragStart, true);
    document.querySelectorAll('.component-wrapper').forEach(wrapper => {
        wrapper.addEventListener('dragover', handleGroupBlockDragOver);
        wrapper.addEventListener('drop', handleGroupBlockDrop);
        wrapper.addEventListener('dragover', handleGroupModDragOver);
        wrapper.addEventListener('drop', handleGroupModDrop);
    });
    document.querySelectorAll('.component-wrapper .group-block').forEach(block => {
        block.setAttribute('draggable', 'false');
        block.addEventListener('dragend', handleGroupBlockDragEnd);
        block.addEventListener('dragover', handleGroupModDragOver);
        block.addEventListener('drop', handleGroupModDrop);
    });
    document.querySelectorAll('.component-wrapper .group-block > .block-header').forEach(header => {
        header.setAttribute('draggable', 'true');
        header.addEventListener('dragstart', handleGroupBlockDragStart);
        header.addEventListener('dragend', handleGroupBlockDragEnd);
    });
    document.querySelectorAll('.component-wrapper .group-block > .mod-item, .component-wrapper > .mod-item').forEach(modItem => {
        modItem.setAttribute('draggable', 'true');
        modItem.addEventListener('dragstart', handleGroupModDragStart);
        modItem.addEventListener('dragend', handleGroupModDragEnd);
    });

    modList.addEventListener('dragover', handleDragOverOptimized);
    modList.addEventListener('drop', handleDropOptimized);
    document.addEventListener('dragend', handleDragEndOptimized);
    modList.removeEventListener('click', consumeHeaderSortClick, true);
    modList.addEventListener('click', consumeHeaderSortClick, true);
}

function consumeHeaderSortClick(e) {
    if (!suppressNextHeaderClick) return;
    suppressNextHeaderClick = false;
    e.preventDefault();
    e.stopPropagation();
}

// 鏂板锛氬閮ㄦ枃浠舵嫋鎷藉鐞?
let isExternalDropInitialized = false;
function setupExternalFileDrop() {
    if (isExternalDropInitialized) return;
    isExternalDropInitialized = true;

    // 鍒涘缓鎷栨嫿閬僵灞?
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
        // 蹇界暐鍐呴儴鎷栨�?(濡傛灉鏄唴閮ㄦ嫋鎷斤紝draggedItems 浼氭湁鍐呭)
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

        // 鑾峰彇鎷栧叆鐨勬枃浠?鏂囦欢澶硅矾�?
        // 娉ㄦ剰锛�?dataTransfer.files �?Electron 涓寘鍚?'path' 灞炴�?
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

let draggedGroupBlock = null;
let draggedGroupBlockContainer = null;
let draggedGroupMod = null;
let draggedGroupModContainer = null;
let currentGroupBlockDropTarget = null;
let activeDragBoundary = null;
let headerSortDragState = null;
let headerSortAutoScrollRafId = null;
let suppressNextHeaderClick = false;
let groupBlockDragOverRafId = null;
let pendingGroupBlockClientY = 0;
let groupModDragOverRafId = null;
let pendingGroupModClientY = 0;
let currentGroupModSwapTarget = null;

function getCurrentModOrderSnapshot() {
    return Array.from(
        document.querySelectorAll('.mod-list > .mod-item, .mod-list > .component-wrapper')
    ).flatMap(item => {
        if (item.classList.contains('component-wrapper')) {
            return Array.from(item.querySelectorAll('.mod-item')).map(m => m.dataset.modName);
        }
        return item.dataset.modName;
    }).filter(Boolean);
}

function createDragGhost(iconClass, text, count = 0) {
    const dragImage = document.createElement('div');
    dragImage.className = 'custom-drag-ghost';
    dragImage.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${text || t('drag.ghost.single')}</span>
        ${count > 1 ? `<span class="badge-count">${count}</span>` : ''}
    `;
    document.body.appendChild(dragImage);
    return dragImage;
}

function handleComponentHeaderMouseDown(e) {
    const header = e.currentTarget.closest('.component-header') || (e.target instanceof Element ? e.target.closest('.component-header') : null);
    if (!header) return;
    if (e.button !== 0) return; // left button only
    if (!isDragSortEnabled()) return;
    startHeaderSortDrag(e, header);
}

function getMainListSortItems() {
    const modList = document.querySelector('.mod-list');
    if (!modList) return [];
    return Array.from(modList.querySelectorAll(':scope > .mod-item, :scope > .component-wrapper'));
}

function clearHeaderSortHints() {
    const placeholder = document.getElementById('header-sort-placeholder');
    if (placeholder) placeholder.remove();
    document.querySelectorAll('.mod-list > .swap-target').forEach(el => el.classList.remove('swap-target'));
}

function updateHeaderSortDropHint(clientX, clientY) {
    const modList = document.querySelector('.mod-list');
    if (!modList || !headerSortDragState?.started || !headerSortDragState.wrapper) return;

    const draggedWrapper = headerSortDragState.wrapper;
    const hitEl = document.elementFromPoint(clientX, clientY);
    const hoverItem = hitEl instanceof Element
        ? hitEl.closest('.mod-list > .mod-item, .mod-list > .component-wrapper')
        : null;

    const currentSwap = document.querySelector('.mod-list > .swap-target');
    if (hoverItem && hoverItem !== draggedWrapper) {
        if (currentSwap && currentSwap !== hoverItem) currentSwap.classList.remove('swap-target');
        hoverItem.classList.add('swap-target');
        headerSortDragState.swapTarget = hoverItem;
        const placeholder = document.getElementById('header-sort-placeholder');
        if (placeholder) placeholder.remove();
        return;
    }

    if (currentSwap) currentSwap.classList.remove('swap-target');
    headerSortDragState.swapTarget = null;

    const items = getMainListSortItems().filter(el => el !== draggedWrapper);
    const afterElement = items.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;

    let placeholder = document.getElementById('header-sort-placeholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = 'header-sort-placeholder';
        placeholder.className = 'drag-placeholder group-placeholder';
    }

    if (afterElement) modList.insertBefore(placeholder, afterElement);
    else modList.appendChild(placeholder);
}

function stopHeaderSortAutoScroll() {
    if (headerSortAutoScrollRafId) {
        cancelAnimationFrame(headerSortAutoScrollRafId);
        headerSortAutoScrollRafId = null;
    }
}

function runHeaderSortAutoScroll() {
    if (!headerSortDragState?.started) {
        stopHeaderSortAutoScroll();
        return;
    }

    const container = document.querySelector('.mod-list-scroll-area');
    if (!container) {
        stopHeaderSortAutoScroll();
        return;
    }

    const rect = container.getBoundingClientRect();
    const x = headerSortDragState.lastClientX;
    const y = headerSortDragState.lastClientY;
    let speed = 0;
    const zone = Math.max(40, parseInt(window.SCROLL_ZONE_SIZE, 10) || 100);
    const maxSpeed = Math.max(10, MAX_AUTO_SCROLL_SPEED || 25);

    if (y >= rect.top && y < rect.top + zone && container.scrollTop > 0) {
        const ratio = (rect.top + zone - y) / zone;
        speed = -maxSpeed * ratio;
    } else if (y <= rect.bottom && y > rect.bottom - zone && container.scrollTop < container.scrollHeight - container.clientHeight) {
        const ratio = (y - (rect.bottom - zone)) / zone;
        speed = maxSpeed * ratio;
    }

    if (Math.abs(speed) > 0.2) {
        container.scrollBy(0, speed);
        updateHeaderSortDropHint(x, y);
    }

    headerSortAutoScrollRafId = requestAnimationFrame(runHeaderSortAutoScroll);
}

function startHeaderSortDrag(e, headerEl) {
    if (!isDragSortEnabled()) return;
    const wrapper = headerEl.closest('.component-wrapper');
    if (!wrapper) return;

    e.preventDefault();
    e.stopPropagation();

    if (typeof handleModMouseLeave === 'function') handleModMouseLeave();

    headerSortDragState = {
        header: headerEl,
        wrapper,
        startX: e.clientX,
        startY: e.clientY,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        started: false,
        swapTarget: null
    };

    const onMove = (moveEvent) => {
        if (!headerSortDragState) return;
        headerSortDragState.lastClientX = moveEvent.clientX;
        headerSortDragState.lastClientY = moveEvent.clientY;
        const dx = Math.abs(moveEvent.clientX - headerSortDragState.startX);
        const dy = Math.abs(moveEvent.clientY - headerSortDragState.startY);

        if (!headerSortDragState.started && (dx > 3 || dy > 3)) {
            headerSortDragState.started = true;
            window._modPreDropOrder = getCurrentModOrderSnapshot();
            document.body.classList.add('is-dragging', 'is-inner-dragging');
            wrapper.classList.add('dragging');
            activeDragBoundary = document.querySelector('.mod-list');

            const scrollContainer = document.querySelector('.mod-list-scroll-area');
            if (scrollContainer) scrollContainer.style.scrollBehavior = 'auto';
            updateHeaderSortDropHint(moveEvent.clientX, moveEvent.clientY);
            runHeaderSortAutoScroll();
        }

        if (headerSortDragState.started) {
            moveEvent.preventDefault();
            updateHeaderSortDropHint(moveEvent.clientX, moveEvent.clientY);
        }
    };

    const onUp = (upEvent) => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        stopHeaderSortAutoScroll();

        if (!headerSortDragState) return;
        const { started, wrapper: draggedWrapper, swapTarget } = headerSortDragState;
        const modList = document.querySelector('.mod-list');
        const placeholder = document.getElementById('header-sort-placeholder');

        if (started) {
            suppressNextHeaderClick = true;
            if (modList && swapTarget && swapTarget !== draggedWrapper) {
                const dragHolder = document.createElement('div');
                modList.insertBefore(dragHolder, draggedWrapper);
                modList.insertBefore(draggedWrapper, swapTarget);
                modList.insertBefore(swapTarget, dragHolder);
                dragHolder.remove();
                saveModOrder();
            } else if (modList && placeholder) {
                modList.insertBefore(draggedWrapper, placeholder);
                placeholder.remove();
                saveModOrder();
            } else if (placeholder) {
                placeholder.remove();
            }
        }

        clearHeaderSortHints();

        draggedWrapper.classList.remove('dragging');
        document.body.classList.remove('is-dragging', 'is-inner-dragging');
        const scrollContainer = document.querySelector('.mod-list-scroll-area');
        if (scrollContainer) scrollContainer.style.scrollBehavior = '';
        activeDragBoundary = null;
        headerSortDragState = null;
        upEvent.preventDefault();
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
}

function handleDragStart(e) {
    if (e.target instanceof Element && e.target.closest('.component-header')) {
        // Component headers use custom mousedown-based sorting.
        e.preventDefault();
        return;
    }
    if (!isDragSortEnabled()) {
        e.preventDefault();
        return;
    }
    const rawTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
    let sourceEl = e.currentTarget;
    const isValidDirectSource = sourceEl instanceof Element && (
        sourceEl.classList.contains('mod-item') ||
        sourceEl.classList.contains('component-header') ||
        sourceEl.classList.contains('component-wrapper')
    );
    if (!isValidDirectSource) {
        sourceEl =
            rawTarget?.closest('.mod-list > .component-wrapper > .component-header') ||
            rawTarget?.closest('.mod-list > .mod-item') ||
            rawTarget?.closest('.mod-list > .component-wrapper');
    }
    if (!sourceEl) {
        e.preventDefault();
        return;
    }
    const isComponentHeaderDrag = sourceEl.classList.contains('component-header');
    if (isComponentHeaderDrag) e.stopPropagation();
    const draggedItem = isComponentHeaderDrag ? sourceEl.closest('.component-wrapper') : sourceEl;
    if (!draggedItem) {
        e.preventDefault();
        return;
    }
    if (draggedItem.classList.contains('component-wrapper') && !rawTarget?.closest('.component-header')) {
        // Only block accidental drag when user starts on the wrapper itself.
        // Do not cancel child drag operations (group-block/mod-item) bubbling up here.
        if (rawTarget === draggedItem) e.preventDefault();
        return;
    }
    if (!isComponentHeaderDrag && draggedItem.classList.contains('selected')) {
        draggedItems = Array.from(document.querySelectorAll('.mod-list > .mod-item.selected, .mod-list > .component-wrapper.selected'));
    } else {
        draggedItems = [draggedItem];
    }
    if (draggedItems.length === 0) {
        e.preventDefault();
        return;
    }

    // --- UNDO: snapshot the current DOM order BEFORE the drag ---
    window._modPreDropOrder = getCurrentModOrderSnapshot();

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedItem.classList.contains('component-wrapper') ? 'group' : 'mod');

    // Create custom drag image
    const isGroup = draggedItems.some(item => item.classList.contains('component-wrapper'));
    const iconClass = isGroup ? 'fa-layer-group' : 'fa-box';
    const dragLabel = draggedItems.length === 1
        ? (draggedItems[0].querySelector('.mod-name, .component-header')?.textContent?.trim() || t('drag.ghost.single'))
        : t('drag.ghost.multi');
    const dragImage = createDragGhost(iconClass, dragLabel, draggedItems.length);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    if (typeof handleModMouseLeave === 'function') handleModMouseLeave();
    document.body.classList.add('is-dragging');
    clearMainListDropHints();
    activeDragBoundary = document.querySelector('.mod-list');

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

let currentMainListDropTarget = null;
let currentMainListDropMode = '';
let mainListDragOverRafId = null;
let pendingMainListDragOverState = null;

function clearMainListDropHints() {
    const placeholder = document.getElementById('drag-placeholder');
    if (placeholder) placeholder.remove();

    document.querySelectorAll('.swap-target').forEach(el => el.classList.remove('swap-target'));

    if (mainListDragOverRafId) {
        cancelAnimationFrame(mainListDragOverRafId);
        mainListDragOverRafId = null;
    }
    pendingMainListDragOverState = null;

    currentMainListDropTarget = null;
    currentMainListDropMode = '';
}

function clearGroupBlockDropHints() {
    document.querySelectorAll('.group-block-placeholder').forEach(p => p.remove());
    currentGroupBlockDropTarget = null;
}

function clearGroupModDropHints() {
    document.querySelectorAll('.group-mod-placeholder').forEach(p => p.remove());
    document.querySelectorAll('.group-mod-swap-target').forEach(el => el.classList.remove('group-mod-swap-target'));
    currentGroupModSwapTarget = null;
}

function getDragAfterChildByY(container, selector, y, draggingEl) {
    const draggableElements = Array.from(container.querySelectorAll(selector))
        .filter(el => el !== draggingEl && !el.classList.contains('dragging'));
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function handleGroupBlockDragStart(e) {
    if (!isDragSortEnabled()) {
        e.preventDefault();
        return;
    }
    const rawTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
    const headerEl = e.currentTarget.closest('.block-header') || rawTarget?.closest('.block-header');
    const blockEl = e.currentTarget.closest('.group-block') || rawTarget?.closest('.group-block');
    if (!headerEl || !blockEl) {
        e.preventDefault();
        return;
    }

    draggedGroupBlock = blockEl;
    draggedGroupBlockContainer = draggedGroupBlock.closest('.component-wrapper');
    if (!draggedGroupBlockContainer) {
        e.preventDefault();
        draggedGroupBlock = null;
        return;
    }

    e.stopPropagation();
    clearMainListDropHints();
    clearGroupBlockDropHints();
    if (typeof handleModMouseLeave === 'function') handleModMouseLeave();
    window._modPreDropOrder = getCurrentModOrderSnapshot();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'group-block');
    const label = headerEl.textContent?.trim() || t('drag.ghost.single');
    const dragImage = createDragGhost('fa-grip-lines', label, 1);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    activeDragBoundary = draggedGroupBlockContainer;
    document.addEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.add('is-inner-dragging');

    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) scrollContainer.style.scrollBehavior = 'auto';

    setTimeout(() => {
        draggedGroupBlock?.classList.add('dragging');
        if (document.body.contains(dragImage)) document.body.removeChild(dragImage);
    }, 0);
}

function handleGroupBlockDragOver(e) {
    if (!draggedGroupBlock || !draggedGroupBlockContainer) return;
    if (e.currentTarget !== draggedGroupBlockContainer) return;

    e.preventDefault();
    e.stopPropagation();

    pendingGroupBlockClientY = e.clientY;
    if (groupBlockDragOverRafId) return;

    groupBlockDragOverRafId = requestAnimationFrame(() => {
        groupBlockDragOverRafId = null;
        if (!draggedGroupBlock || !draggedGroupBlockContainer) return;

        const container = draggedGroupBlockContainer;
        const afterElement = getDragAfterChildByY(container, ':scope > .group-block', pendingGroupBlockClientY, draggedGroupBlock);
        const placeholder = container.querySelector('.group-block-placeholder') || document.createElement('div');
        if (!placeholder.parentElement) {
            placeholder.className = 'group-block-placeholder';
        }

        if (afterElement) {
            if (placeholder.nextElementSibling !== afterElement || placeholder.parentElement !== container) {
                container.insertBefore(placeholder, afterElement);
            }
            currentGroupBlockDropTarget = afterElement;
        } else {
            if (placeholder.parentElement !== container || placeholder !== container.lastElementChild) {
                container.appendChild(placeholder);
            }
            currentGroupBlockDropTarget = null;
        }
    });
}

function handleGroupBlockDrop(e) {
    if (!draggedGroupBlock || !draggedGroupBlockContainer) return;
    if (e.currentTarget !== draggedGroupBlockContainer) return;

    e.preventDefault();
    e.stopPropagation();

    const placeholder = draggedGroupBlockContainer.querySelector('.group-block-placeholder');
    if (placeholder) {
        draggedGroupBlockContainer.insertBefore(draggedGroupBlock, placeholder);
        placeholder.remove();
        saveModOrder();
    }
}

function handleGroupBlockDragEnd(e) {
    if (!draggedGroupBlock) return;
    e.stopPropagation();
    stopAutoScroll();
    document.removeEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.remove('is-inner-dragging');
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) scrollContainer.style.scrollBehavior = '';

    if (groupBlockDragOverRafId) {
        cancelAnimationFrame(groupBlockDragOverRafId);
        groupBlockDragOverRafId = null;
    }
    pendingGroupBlockClientY = 0;

    clearGroupBlockDropHints();
    draggedGroupBlock.classList.remove('dragging');
    draggedGroupBlock = null;
    draggedGroupBlockContainer = null;
    activeDragBoundary = null;
}

function handleGroupModDragStart(e) {
    if (!isDragSortEnabled()) {
        e.preventDefault();
        return;
    }

    draggedGroupMod = e.currentTarget;
    draggedGroupModContainer = draggedGroupMod.closest('.group-block') || draggedGroupMod.closest('.component-wrapper');
    if (!draggedGroupModContainer) {
        e.preventDefault();
        draggedGroupMod = null;
        return;
    }

    e.stopPropagation();
    clearMainListDropHints();
    clearGroupModDropHints();
    if (typeof handleModMouseLeave === 'function') handleModMouseLeave();
    window._modPreDropOrder = getCurrentModOrderSnapshot();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'group-mod');
    const label = draggedGroupMod.querySelector('.mod-name-part1')?.textContent?.trim() || draggedGroupMod.dataset.modName || t('drag.ghost.single');
    const dragImage = createDragGhost('fa-grip-lines-vertical', label, 1);
    e.dataTransfer.setDragImage(dragImage, 0, 0);

    activeDragBoundary = draggedGroupModContainer;
    document.addEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.add('is-inner-dragging');

    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) scrollContainer.style.scrollBehavior = 'auto';

    setTimeout(() => {
        draggedGroupMod?.classList.add('dragging');
        if (document.body.contains(dragImage)) document.body.removeChild(dragImage);
    }, 0);
}

function handleGroupModDragOver(e) {
    if (!draggedGroupMod || !draggedGroupModContainer) return;
    if (e.currentTarget !== draggedGroupModContainer) return;

    e.preventDefault();
    e.stopPropagation();

    pendingGroupModClientY = e.clientY;

    const hoverMod = e.target instanceof Element ? e.target.closest('.mod-item') : null;
    if (hoverMod && hoverMod !== draggedGroupMod && hoverMod.parentElement === draggedGroupModContainer) {
        const placeholder = draggedGroupModContainer.querySelector('.group-mod-placeholder');
        if (placeholder) placeholder.remove();

        if (currentGroupModSwapTarget && currentGroupModSwapTarget !== hoverMod) {
            currentGroupModSwapTarget.classList.remove('group-mod-swap-target');
        }
        hoverMod.classList.add('group-mod-swap-target');
        currentGroupModSwapTarget = hoverMod;
        return;
    }

    if (currentGroupModSwapTarget) {
        currentGroupModSwapTarget.classList.remove('group-mod-swap-target');
        currentGroupModSwapTarget = null;
    }

    if (groupModDragOverRafId) return;

    groupModDragOverRafId = requestAnimationFrame(() => {
        groupModDragOverRafId = null;
        if (!draggedGroupMod || !draggedGroupModContainer) return;

        const container = draggedGroupModContainer;
        const afterElement = getDragAfterChildByY(container, ':scope > .mod-item', pendingGroupModClientY, draggedGroupMod);
        const placeholder = container.querySelector('.group-mod-placeholder') || document.createElement('div');
        if (!placeholder.parentElement) {
            placeholder.className = 'group-mod-placeholder';
        }

        if (afterElement) {
            if (placeholder.nextElementSibling !== afterElement || placeholder.parentElement !== container) {
                container.insertBefore(placeholder, afterElement);
            }
        } else {
            if (placeholder.parentElement !== container || placeholder !== container.lastElementChild) {
                container.appendChild(placeholder);
            }
        }
    });
}

function handleGroupModDrop(e) {
    if (!draggedGroupMod || !draggedGroupModContainer) return;
    if (e.currentTarget !== draggedGroupModContainer) return;

    e.preventDefault();
    e.stopPropagation();

    const swapTarget = currentGroupModSwapTarget;
    if (swapTarget && swapTarget !== draggedGroupMod && swapTarget.parentElement === draggedGroupModContainer) {
        const dragHolder = document.createElement('div');
        draggedGroupModContainer.insertBefore(dragHolder, draggedGroupMod);
        draggedGroupModContainer.insertBefore(draggedGroupMod, swapTarget);
        draggedGroupModContainer.insertBefore(swapTarget, dragHolder);
        dragHolder.remove();
        clearGroupModDropHints();
        saveModOrder();
        return;
    }

    const placeholder = draggedGroupModContainer.querySelector('.group-mod-placeholder');
    if (placeholder) {
        draggedGroupModContainer.insertBefore(draggedGroupMod, placeholder);
        clearGroupModDropHints();
        saveModOrder();
    }
}

function handleGroupModDragEnd(e) {
    if (!draggedGroupMod) return;
    e.stopPropagation();
    stopAutoScroll();
    document.removeEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.remove('is-inner-dragging');
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) scrollContainer.style.scrollBehavior = '';

    if (groupModDragOverRafId) {
        cancelAnimationFrame(groupModDragOverRafId);
        groupModDragOverRafId = null;
    }
    pendingGroupModClientY = 0;

    clearGroupModDropHints();
    draggedGroupMod.classList.remove('dragging');
    draggedGroupMod = null;
    draggedGroupModContainer = null;
    activeDragBoundary = null;
}

function applyMainListDropHint(target, clientY) {
    if (!target || draggedItems.includes(target)) {
        clearMainListDropHints();
        return;
    }

    const isGroupTarget = target.classList.contains('component-wrapper');
    const isGroupDrag = draggedItems.some(item => item.classList.contains('component-wrapper'));
    let isDropBefore = false;
    let isDropAfter = false;
    let dropMode = 'swap';

    if (!isGroupTarget && !isGroupDrag) {
        const rect = target.getBoundingClientRect();
        const y = clientY - rect.top;
        const threshold = rect.height * 0.25;
        isDropBefore = y < threshold;
        isDropAfter = y > rect.height - threshold;
        dropMode = (isDropBefore || isDropAfter) ? (isDropBefore ? 'before' : 'after') : 'swap';
    }

    if (target === currentMainListDropTarget && dropMode === currentMainListDropMode) return;

    const existingSwapTarget = document.querySelector('.swap-target');
    if (existingSwapTarget && existingSwapTarget !== target) {
        existingSwapTarget.classList.remove('swap-target');
    }

    const existingPlaceholder = document.getElementById('drag-placeholder');
    if (dropMode === 'swap') {
        if (existingPlaceholder) existingPlaceholder.remove();
        target.classList.add('swap-target');
    } else {
        if (existingSwapTarget) existingSwapTarget.classList.remove('swap-target');
        target.classList.remove('swap-target');

        const placeholder = existingPlaceholder || document.createElement('div');
        if (!existingPlaceholder) {
            placeholder.id = 'drag-placeholder';
            placeholder.className = isGroupDrag ? 'drag-placeholder group-placeholder' : 'drag-placeholder mod-placeholder';
        }

        if (isDropBefore) target.parentNode.insertBefore(placeholder, target);
        else target.parentNode.insertBefore(placeholder, target.nextSibling);
    }

    currentMainListDropTarget = target;
    currentMainListDropMode = dropMode;
}

function queueMainListDragOver(target, clientY) {
    pendingMainListDragOverState = { target, clientY };
    if (mainListDragOverRafId) return;

    mainListDragOverRafId = requestAnimationFrame(() => {
        mainListDragOverRafId = null;
        const state = pendingMainListDragOverState;
        pendingMainListDragOverState = null;
        if (!state || draggedItems.length === 0) return;
        applyMainListDropHint(state.target, state.clientY);
    });
}

function handleDragOverOptimized(e) {
    if (!isDragSortEnabled() || draggedItems.length === 0) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.mod-list > .mod-item, .mod-list > .component-wrapper');
    if (!target || draggedItems.includes(target)) {
        clearMainListDropHints();
        return;
    }

    queueMainListDragOver(target, e.clientY);
}

function handleDropOptimized(e) {
    if (!isDragSortEnabled() || draggedItems.length === 0) return;

    e.preventDefault();

    if (mainListDragOverRafId) {
        cancelAnimationFrame(mainListDragOverRafId);
        mainListDragOverRafId = null;
    }
    pendingMainListDragOverState = null;

    const placeholder = document.getElementById('drag-placeholder');
    const swapTarget = document.querySelector('.swap-target');

    if (swapTarget) {
        const parent = swapTarget.parentNode;
        if (draggedItems.length === 1 && swapTarget !== draggedItems[0]) {
            const dragHolder = document.createElement('div');
            parent.insertBefore(dragHolder, draggedItems[0]);
            parent.insertBefore(draggedItems[0], swapTarget);
            parent.insertBefore(swapTarget, dragHolder);
            dragHolder.remove();
        } else {
            draggedItems.forEach(item => parent.insertBefore(item, swapTarget));
        }

        clearMainListDropHints();
        saveModOrder();
    } else if (placeholder) {
        draggedItems.forEach(item => placeholder.parentNode.insertBefore(item, placeholder));
        clearMainListDropHints();
        saveModOrder();
    }
}

function handleDragEndOptimized() {
    stopAutoScroll();
    document.removeEventListener('dragover', handleDragOverScroll, true);
    document.body.classList.remove('is-dragging');

    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    if (scrollContainer) scrollContainer.style.scrollBehavior = '';

    if (mainListDragOverRafId) {
        cancelAnimationFrame(mainListDragOverRafId);
        mainListDragOverRafId = null;
    }
    pendingMainListDragOverState = null;

    clearMainListDropHints();
    draggedItems.forEach(item => item.classList.remove('dragging'));
    draggedItems = [];
    activeDragBoundary = null;
}

function handleDragOver(e) {
    if (!isDragSortEnabled() || draggedItems.length === 0) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.mod-list > .mod-item, .mod-list > .component-wrapper');
    if (!target || draggedItems.includes(target)) {
        clearMainListDropHints();
        return;
    }

    queueMainListDragOver(target, e.clientY);
}
function handleDrop(e) {
    if (!isDragSortEnabled() || draggedItems.length === 0) {
        return;
    }
    e.preventDefault();

    if (mainListDragOverRafId) {
        cancelAnimationFrame(mainListDragOverRafId);
        mainListDragOverRafId = null;
    }
    pendingMainListDragOverState = null;

    const placeholder = document.getElementById('drag-placeholder');
    const swapTarget = document.querySelector('.swap-target');

    if (swapTarget) {
        const parent = swapTarget.parentNode;

        // 濡傛灉浜掓崲锛屾垜浠簲璇ュ厛璁板綍琚嫋鎷藉厓绱犲師鏉ョ殑浣嶇疆
        if (draggedItems.length === 1 && swapTarget !== draggedItems[0]) {
            // 浜掓崲涓や釜鐙珛鐨?DOM 鑺傜�?
            const dragHolder = document.createElement('div');
            // 鍗犱綇鎷栧姩鍏冪礌鍘熶綅�?
            parent.insertBefore(dragHolder, draggedItems[0]);

            // 浜ゆ�?
            parent.insertBefore(draggedItems[0], swapTarget);
            parent.insertBefore(swapTarget, dragHolder);

            // 绉婚櫎鍗犱綅
            dragHolder.remove();
        } else {
            // 濡傛灉鏄閫夋嫋鎷戒簰鎹紝绠€鍗曞疄鐜帮細灏嗚鎷栧姩椤规斁鍒扮洰鏍囦綅缃箣鍓嶏紝鐩爣淇濇寔鍘熶綅锛堢瓑鍚屼簬鎻掑叆�?
            draggedItems.forEach(item => parent.insertBefore(item, swapTarget));
        }

        swapTarget.classList.remove('swap-target');
        if (placeholder) placeholder.remove();
        saveModOrder();
    } else if (placeholder) {
        // 姝ｅ父鎻掑叆閫昏�?
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

    if (mainListDragOverRafId) {
        cancelAnimationFrame(mainListDragOverRafId);
        mainListDragOverRafId = null;
    }
    pendingMainListDragOverState = null;

    clearMainListDropHints();
    draggedItems.forEach(item => item.classList.remove('dragging'));
    draggedItems = [];
    activeDragBoundary = null;
}


// Local constants removed, using global variables from core.js: window.SCROLL_ZONE_SIZE, MAX_AUTO_SCROLL_SPEED
let targetScrollSpeed = 0;
let cachedDragScrollContainer = null;

function getDragScrollContainer() {
    if (cachedDragScrollContainer && cachedDragScrollContainer.isConnected) return cachedDragScrollContainer;
    cachedDragScrollContainer = document.querySelector('.mod-list-scroll-area');
    return cachedDragScrollContainer;
}

function handleDragOverScroll(e) {
    const hasAnyDrag =
        (draggedItems && draggedItems.length > 0) ||
        !!draggedSubMod ||
        !!draggedGroupBlock ||
        !!draggedGroupMod;
    if (!hasAnyDrag) {
        stopAutoScroll();
        return;
    }

    e.preventDefault();

    const container = getDragScrollContainer();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY;
    const mouseX = e.clientX;

    if (mouseX < rect.left - 100 || mouseX > rect.right + 100) {
        targetScrollSpeed = 0;
        return;
    }

    if (activeDragBoundary) {
        const boundaryRect = activeDragBoundary.getBoundingClientRect();
        if (mouseX < boundaryRect.left - 40 || mouseX > boundaryRect.right + 40) {
            targetScrollSpeed = 0;
            return;
        }
    }

    let nextTargetSpeed = 0;
    let effectiveZoneSize = parseInt(window.SCROLL_ZONE_SIZE, 10);
    if (isNaN(effectiveZoneSize) || effectiveZoneSize <= 0) {
        effectiveZoneSize = 100;
    }

    const topZoneBottom = rect.top + effectiveZoneSize;
    const bottomZoneTop = rect.bottom - effectiveZoneSize;
    const maxSpeed = Math.max(10, MAX_AUTO_SCROLL_SPEED || 25);

    if (mouseY >= rect.top && mouseY < topZoneBottom) {
        if (container.scrollTop > 0) {
            const dist = topZoneBottom - mouseY;
            let ratio = dist / effectiveZoneSize;
            if (ratio > 1.6) ratio = 1.6;
            nextTargetSpeed = -maxSpeed * ratio;
        }
    } else if (mouseY <= rect.bottom && mouseY > bottomZoneTop) {
        if (container.scrollTop < container.scrollHeight - container.clientHeight) {
            const dist = mouseY - bottomZoneTop;
            let ratio = dist / effectiveZoneSize;
            if (ratio > 1.6) ratio = 1.6;
            nextTargetSpeed = maxSpeed * ratio;
        }
    }

    targetScrollSpeed = nextTargetSpeed;

    if (Math.abs(targetScrollSpeed) > 0.1) {
        if (!scrollAnimationId) autoScroll();
    } else if (Math.abs(currentScrollSpeed) <= 0.2 && scrollAnimationId) {
        stopAutoScroll();
    }
}

function autoScroll() {
    const container = getDragScrollContainer();
    const hasAnyDrag =
        (draggedItems && draggedItems.length > 0) ||
        !!draggedSubMod ||
        !!draggedGroupBlock ||
        !!draggedGroupMod;
    if (!container || !hasAnyDrag) {
        stopAutoScroll();
        return;
    }

    currentScrollSpeed += (targetScrollSpeed - currentScrollSpeed) * 0.28;

    if (Math.abs(currentScrollSpeed) < 0.12 && Math.abs(targetScrollSpeed) < 0.12) {
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
    targetScrollSpeed = 0;
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
    if (!isDragSortEnabled()) {
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
    if (typeof handleModMouseLeave === 'function') handleModMouseLeave();
    clearMainListDropHints();
    activeDragBoundary = draggedSubMod.closest('.sub-mods-list');

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
    activeDragBoundary = null;
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
    // 濡傛灉鍏冪礌涓嶅瓨鍦ㄦ垨涓嶅彲瑙侊紝鍒欎笉鏇存柊
    if (!container || !container.classList.contains('visible')) return;

    if (document.body.classList.contains('is-dragging') || document.body.classList.contains('is-inner-dragging')) {
        container.classList.remove('visible');
        return;
    }

    // 鍋忕Щ閲忥紝闃叉榧犳爣閬尅
    const offset = 20;
    let top = e.clientY + offset;
    let left = e.clientX + offset;

    // 杈圭晫妫€鏌ワ細闃叉棰勮鍥捐秴鍑哄睆骞曞彸渚ф垨搴曢儴
    const rect = container.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 濡傛灉鍙宠竟缂樿秴鍑鸿鍙ｏ紝鍚戝乏绉诲�?
    if (left + rect.width > viewportWidth) {
        left = e.clientX - rect.width - offset;
    }

    // 濡傛灉涓嬭竟缂樿秴鍑鸿鍙ｏ紝鍚戜笂绉诲�?
    if (top + rect.height > viewportHeight) {
        top = e.clientY - rect.height - offset;
    }

    // 闃叉宸?涓婅竟缂樻孩�?
    if (left < 0) left = offset;
    if (top < 0) top = offset;

    // 搴旂敤浣嶇疆
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
}

// Obsolete applyBatchTags removed
// The correct implementation is in js/features/mod-manager.js using the new Tag Cloud system.

// 瀵煎嚭鍑芥暟
window.confirmToggleGroupConflict = confirmToggleGroupConflict;

// ==========================================================================
// DOWNLOAD & INSTALLATION LOGIC (涓嬭浇涓庡畨瑁呴€昏�?
// ==========================================================================

let currentDownloadData = null;

/**
 * 鎵撳紑涓嬭浇鏂囦欢鎵€鍦ㄤ綅�?
 */
function openDownloadLocation() {
    const { shell } = require('electron');
    if (currentDownloadData && currentDownloadData.tempPath) {
        // 鍦ㄦ枃浠剁鐞嗗櫒涓樉绀烘枃�?
        shell.showItemInFolder(currentDownloadData.tempPath);
    } else {
        showToast('download.path.not_found', 'error');
    }
}
window.openDownloadLocation = openDownloadLocation;

/**
 * 鎵撳紑涓嬭浇鏂囦欢閫夋嫨妯℃€佹�?
 * @param {Object} data - { tempPath, originalFilename, entries: [{path, name, isDirectory, size}] }
 */
function openDownloadSelectionModal(data) {
    // 纭繚渚濊禆寮曞�?(濡傛灉鏂囦欢澶撮儴鏈紩�?
    const { ipcRenderer } = require('electron');

    currentDownloadData = data;
    const modal = document.getElementById('downloadSelectionModal');

    // 璁剧疆鏂囦欢鍚嶆樉绀?
    const fileNameEl = document.getElementById('downloadedFileName');
    if (fileNameEl) fileNameEl.textContent = data.originalFilename;

    // 璁剧疆榛樿 Mod 鍚嶇О (鍘婚櫎鎵╁睍�?
    const nameWithoutExt = data.originalFilename.replace(/\.[^/.]+$/, "");
    const nameInput = document.getElementById('installModName');
    if (nameInput) nameInput.value = nameWithoutExt;

    // 閲嶇疆閫夐」鐘舵€?
    const newGroupCheckbox = document.getElementById('installAsNewModGroup');
    const nameInputContainer = document.getElementById('newModNameInputContainer');

    if (newGroupCheckbox) {
        newGroupCheckbox.checked = true; // 榛樿浣滀负鏂?Mod锛岄槻姝㈡剰澶栬鐩?
        // 缁戝畾鍒囨崲浜嬩�?
        newGroupCheckbox.onchange = (e) => {
            if (nameInputContainer) {
                nameInputContainer.style.display = e.target.checked ? 'block' : 'none';
            }
        };
        // 瑙﹀彂涓€娆′互璁剧疆鍒濆鐘舵�?
        newGroupCheckbox.dispatchEvent(new Event('change'));
    }

    // 娓叉煋鏂囦欢�?
    renderDownloadFileTree(data.entries);

    // 鏄剧ず妯℃€佹
    if (modal) modal.style.display = 'flex';
}
window.openDownloadSelectionModal = openDownloadSelectionModal;

/**
 * 鍒嗘瀽鏂囦欢澶圭粨鏋勶紝纭畾鍝簺鏂囦欢澶瑰彲浠ラ€夋�?
 */
function analyzeFolders(entries) {
    const path = require('path');
    const folders = {};

    // 鍒濆鍖栨墍鏈夋枃浠跺す
    entries.forEach(entry => {
        const normalizedPath = entry.path.replace(/\\/g, '/');

        if (entry.isDirectory) {
            // 鍒濆鍖栨枃浠跺�?
            if (!folders[normalizedPath]) {
                folders[normalizedPath] = {
                    hasPak: false,
                    hasSubfolders: false,
                    files: [],
                    subfolders: new Set()
                };
            }
        } else {
            // 澶勭悊鏂囦欢
            const dir = path.dirname(normalizedPath).replace(/\\/g, '/');

            // 鍒濆鍖栨枃浠舵墍鍦ㄧ殑鏂囦欢澶?
            if (!folders[dir]) {
                folders[dir] = {
                    hasPak: false,
                    hasSubfolders: false,
                    files: [],
                    subfolders: new Set()
                };
            }

            // 璁板綍鏂囦欢
            folders[dir].files.push(entry);
            if (entry.name.toLowerCase().endsWith('.pak')) {
                folders[dir].hasPak = true;
            }
        }
    });

    // 鏍囪鍖呭惈瀛愭枃浠跺す鐨勬枃浠跺す
    Object.keys(folders).forEach(folderPath => {
        if (folderPath === '.' || folderPath === '') return;

        const parentDir = path.dirname(folderPath).replace(/\\/g, '/');

        // 濡傛灉鐖剁洰褰曞瓨鍦紝鏍囪瀹冨寘鍚瓙鏂囦欢澶?
        if (folders[parentDir]) {
            folders[parentDir].hasSubfolders = true;
        }
    });

    return folders;
}

/**
 * 娓叉煋鏂囦欢鏍戠粨鏋勶紙鏂囦欢澶归€夋嫨妯″紡�?
 * @param {Array} entries - zip entries list
 */
function renderDownloadFileTree(entries) {
    const container = document.getElementById('downloadFileTree');
    if (!container) return;
    container.innerHTML = '';

    // 鍒嗘瀽鏂囦欢澶圭粨鏋?
    const folderAnalysis = analyzeFolders(entries);

    // 1. 鏋勫缓鏍戝舰鏁版嵁缁撴�?
    const tree = {};
    entries.forEach(entry => {
        // 缁熶竴璺緞鍒嗛殧绗?
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

    // 2. 閫掑綊鐢熸垚 HTML
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
                // 鏂囦欢锛氬彧鏄剧ず锛屼笉鏄剧ず澶嶉€夋
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
                // 鏂囦欢澶癸細妫€鏌ユ槸鍚﹀彲閫?
                // 瀵逛簬鏍圭骇鍒殑鏂囦欢澶癸紝闇€瑕佺壒娈婂�?
                let folderInfo;
                if (!node.path || node.path === '' || !node.path.includes('/')) {
                    // 杩欐槸鏍圭骇鍒殑鏂囦欢澶癸紝妫€鏌ヨ鏂囦欢澶规湰韬殑淇℃伅
                    folderInfo = folderAnalysis[node.path] || { hasPak: false, hasSubfolders: false };
                } else {
                    folderInfo = folderAnalysis[node.path] || { hasPak: false, hasSubfolders: false };
                }

                const canSelect = folderInfo.hasPak && !folderInfo.hasSubfolders;

                if (canSelect) {
                    // 鍙€夋嫨鐨勬枃浠跺�?
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
                    // 涓嶅彲閫夋嫨鐨勬枃浠跺す
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

            // 濡傛灉鏈夊瓙鑺傜偣锛岄€掑綊鐢熸�?
            if (hasChildren) {
                const childrenContainer = createTreeHTML(node.children, node.path);
                childrenContainer.style.display = 'none';
                childrenContainer.style.paddingLeft = '22px';
                li.appendChild(childrenContainer);

                // 缁戝畾鎶樺彔/灞曞紑浜嬩欢
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

    // 鐗规畩澶勭悊锛氬鏋滄牴鐩綍鏈夋枃浠讹紝娣诲姞涓€涓櫄鎷熺殑"鏍规枃浠跺す"閫夐�?
    const rootFiles = entries.filter(e => !e.isDirectory && !e.path.includes('/') && !e.path.includes('\\'));
    if (rootFiles.length > 0) {
        const hasRootPak = rootFiles.some(f => f.name.toLowerCase().endsWith('.pak'));

        if (hasRootPak) {
            // 鍦ㄦ爲鐨勬渶鍓嶉潰鎻掑叆涓€涓櫄鎷熺殑鏍规枃浠跺す閫夐�?
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

    // 鑷姩灞曞紑鏍圭洰褰?
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
 * 澶勭悊鏍戝舰缁撴瀯涓殑澶嶉€夋鑱斿姩
 */
function handleFileTreeCheckbox(checkbox) {
    const li = checkbox.closest('li');
    const isChecked = checkbox.checked;

    // 1. 鍚戜笅鑱斿姩锛氶€変�?鍙栨秷閫変腑鎵€鏈夊瓙瀛欒妭鐐?
    // 鎵惧埌璇?li 涓嬮潰鐩存帴鍖呭惈鐨?ul (瀛愬垪琛?
    // 娉ㄦ剰锛歝reateTreeHTML 缁撴瀯鏄?li -> div(row) + ul(children)
    // 鎴戜滑闇€瑕佹煡鎵捐�?li 鍐呴儴鐨勬墍�?checkbox

    // 鑾峰彇璇ヨ妭鐐逛笅鐨勬墍鏈夊瓙瀹瑰�?
    const childrenContainer = li.querySelector('ul.file-tree-list');
    if (childrenContainer) {
        const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
        childCheckboxes.forEach(cb => cb.checked = isChecked);
    }

    // 2. (鍙�? 鍚戜笂鑱斿姩锛氬鏋滃悓绾у叏閫夛紝鍒欑埗绾ч€変腑锛涘惁鍒欑埗绾у彇娑堥€変�?
    // 涓轰簡绠€鍖栭€昏緫鍜岀敤鎴疯嚜鐢卞害锛岃繖閲屾殏涓嶅己鍒跺悜涓婅仈鍔�?
    // 鍥犱负鐢ㄦ埛鍙兘鍙兂瑙ｅ帇鏂囦欢澶归噷鐨勬煇涓€涓枃浠惰€屼笉閫夋枃浠跺す鏈�?閫昏緫涓婃枃浠跺す鍙槸璺�?
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
 * 纭瀹夎涓嬭浇
 */
async function confirmInstallDownload() {
    const { ipcRenderer } = require('electron');
    if (!currentDownloadData) return;

    // 鑾峰彇鎵€鏈夐€変腑鐨勬枃浠跺す
    const selectedFolders = document.querySelectorAll('.folder-checkbox:checked');

    if (selectedFolders.length === 0) {
        showToast('download.install.select_folder', 'warning');
        return;
    }

    // 鏀堕泦閫変腑鏂囦欢澶逛腑鐨勬墍鏈夋枃�?
    const selectedEntries = [];
    selectedFolders.forEach(checkbox => {
        const folderPath = checkbox.dataset.path;

        // 鎵惧埌璇ユ枃浠跺す涓嬬殑鎵€鏈夋枃浠讹紙鍖呮嫭瀛愭枃浠讹級
        const filesInFolder = currentDownloadData.entries.filter(entry => {
            const entryPath = entry.path.replace(/\\/g, '/');

            // 濡傛灉鏄牴鏂囦欢澶癸紙璺緞涓?'.' 鎴栫┖锛夛紝鍖归厤鎵€鏈変笉鍦ㄥ瓙鏂囦欢澶逛腑鐨勬枃浠?
            if (folderPath === '.' || folderPath === '') {
                return !entry.isDirectory && !entryPath.includes('/');
            }

            // 鍚﹀垯鍖归厤璇ユ枃浠跺す涓嬬殑鎵€鏈夋枃�?
            return entryPath.startsWith(folderPath + '/') && !entry.isDirectory;
        });
        selectedEntries.push(...filesInFolder.map(f => f.path));
    });

    if (selectedEntries.length === 0) {
        showToast('download.install.no_files', 'warning');
        return;
    }

    // 鑾峰�?Mod 鍚嶇О
    const installAsNew = document.getElementById('installAsNewModGroup').checked;
    let modName = currentDownloadData.originalFilename.replace(/\.[^/.]+$/, ""); // 榛樿浣跨敤鏂囦欢鍚?

    if (installAsNew) {
        const customName = document.getElementById('installModName').value.trim();
        if (customName) modName = customName;
    }

    // UI 鍔犺浇鐘舵€?
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
window.openAddSubModModal = openAddSubModModal;
window.openSimilarModManagementModal = openSimilarModManagementModal;

// Game Switching Logic
const switchGameBtn = document.getElementById('switchGameBtn');
if (switchGameBtn) {
    switchGameBtn.addEventListener('click', () => {
        ipcRenderer.invoke('return-to-game-select');
    });
}

