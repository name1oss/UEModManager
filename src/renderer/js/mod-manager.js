// ==========================================================================
// MOD MANAGER LOGIC (Mod 管理逻辑)
// ==========================================================================

// 加载并渲染 Mod 列表
// Pagination State
// Pagination State
let currentRenderableItems = [];
let currentOpenSubModLists = new Map();
let activeRenderFilters = null; // Store filters for use in rendering items
let modListLoadSeq = 0;
let similarGroupsByModName = new Map();
let groupConflictByModName = new Map();
let activeRenderSearch = '';
let activeRenderTagSet = null;
let mainModByName = new Map();
let subModByName = new Map();
let renderedElementByModName = new Map();

function rebuildModLookupCaches() {
    mainModByName = new Map();
    subModByName = new Map();

    if (Array.isArray(globalModDetails)) {
        globalModDetails.forEach(mod => {
            if (!mod?.name) return;
            mainModByName.set(mod.name, mod);
            const subMods = Array.isArray(mod.sub_mods) ? mod.sub_mods : [];
            subMods.forEach(sub => {
                if (sub?.name) subModByName.set(sub.name, sub);
            });
        });
    }

    if (Array.isArray(allSubModDetails)) {
        allSubModDetails.forEach(sub => {
            if (sub?.name && !subModByName.has(sub.name)) {
                subModByName.set(sub.name, sub);
            }
        });
    }
}

function getCachedModByName(name) {
    return mainModByName.get(name) || subModByName.get(name) || null;
}

function rebuildRenderedElementCache(container) {
    renderedElementByModName = new Map();
    if (!container) return;

    container.querySelectorAll('.mod-item, .sub-mod-item').forEach(item => {
        const modName = item.dataset.modName || item.dataset.subModName;
        if (modName) renderedElementByModName.set(modName, item);
    });
}

function rebuildSimilarGroupCaches() {
    similarGroupsByModName = new Map();
    allSimilarGroups.forEach(group => {
        if (!Array.isArray(group?.mod_names)) return;
        group.mod_names.forEach(modName => {
            if (!similarGroupsByModName.has(modName)) {
                similarGroupsByModName.set(modName, []);
            }
            similarGroupsByModName.get(modName).push(group);
        });
    });
}

function rebuildGroupConflictCache() {
    groupConflictByModName = new Map();
    similarGroupsByModName.forEach((groups, modName) => {
        for (const group of groups) {
            const activeMember = group.mod_names.find(member => member !== modName && activeSimilarMods.has(member));
            if (activeMember) {
                groupConflictByModName.set(modName, { activeMember, groupName: group.group_name });
                break;
            }
        }
    });
}

function preprocessModsForFiltering(mods) {
    if (!Array.isArray(mods)) return;
    mods.forEach(mod => {
        const normName = normalize_string(mod.name || '');
        const normDisplay = normalize_string(mod.display_name || '');
        const tags = Array.isArray(mod.tags) ? mod.tags : [];
        const normTags = tags.map(tag => normalize_string(tag || '')).filter(Boolean);
        const lowerTagSet = new Set(tags.map(tag => String(tag).toLowerCase()));

        mod.__normName = normName;
        mod.__normDisplay = normDisplay;
        mod.__normTags = normTags;
        mod.__tagLowerSet = lowerTagSet;
        mod.__searchSelfIndex = `${normName} ${normDisplay} ${normTags.join(' ')}`.trim();

        const subMods = Array.isArray(mod.sub_mods) ? mod.sub_mods : [];
        const subSearchParts = [];
        subMods.forEach(sub => {
            const subNormName = normalize_string(sub.name || '');
            const subNormDisplay = normalize_string(sub.display_name || '');
            const subTags = Array.isArray(sub.tags) ? sub.tags : [];
            const subNormTags = subTags.map(tag => normalize_string(tag || '')).filter(Boolean);
            const subLowerTagSet = new Set(subTags.map(tag => String(tag).toLowerCase()));

            sub.__normName = subNormName;
            sub.__normDisplay = subNormDisplay;
            sub.__normTags = subNormTags;
            sub.__tagLowerSet = subLowerTagSet;
            sub.__searchSelfIndex = `${subNormName} ${subNormDisplay} ${subNormTags.join(' ')}`.trim();
            subSearchParts.push(sub.__searchSelfIndex);
        });

        mod.__searchFullIndex = `${mod.__searchSelfIndex} ${subSearchParts.join(' ')}`.trim();
    });
}

function hasAnyTag(tagArray, filterTagSet) {
    if (!tagArray || !filterTagSet || filterTagSet.size === 0) return false;
    if (tagArray instanceof Set) {
        for (const tag of filterTagSet) {
            if (tagArray.has(tag)) return true;
        }
        return false;
    }
    if (!Array.isArray(tagArray)) return false;
    for (const tag of tagArray) {
        if (filterTagSet.has(String(tag).toLowerCase())) return true;
    }
    return false;
}

// 加载并渲染 Mod 列表
async function loadAndRenderModList() {
    const loadSeq = ++modListLoadSeq;

    currentOpenSubModLists.clear();
    document.querySelectorAll('.sub-mods-list').forEach(list => {
        if (list.style.display === 'block') {
            currentOpenSubModLists.set(list.id.replace('sub-mods-', ''), true);
        }
    });

    // 在异步 IPC 调用前同步保存滚动位置，避免异步等待后位置丢失
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    const filters = {
        search_query: currentSearchQuery,
        tag_filter: Array.from(currentSelectedTags).join(','),
        activation_filter: currentActivationFilter
    };

    // Update global filter state for use in createModItemHTML
    activeRenderFilters = filters;
    activeRenderSearch = filters.search_query ? normalize_string(filters.search_query) : '';
    activeRenderTagSet = filters.tag_filter ? new Set(filters.tag_filter.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) : null;

    try {
        const data = await ipcRenderer.invoke('get-mods-data', filters);
        // Ignore stale responses if a newer load request has been issued.
        if (loadSeq !== modListLoadSeq) return;

        globalModDetails = Array.isArray(data?.unfiltered_mod_details) ? data.unfiltered_mod_details : [];
        allSubModDetails = Array.isArray(data?.unfiltered_sub_mods) ? data.unfiltered_sub_mods : [];
        allSimilarGroups = Array.isArray(data?.similar_mod_groups) ? data.similar_mod_groups : [];
        preprocessModsForFiltering(globalModDetails);
        rebuildModLookupCaches();
        rebuildSimilarGroupCaches();

        const filteredModDetails = filterModsClientSide(globalModDetails, filters);

        activeSimilarMods.clear();
        globalModDetails.forEach(mod => { if (mod.is_active) activeSimilarMods.add(mod.name); });
        allSubModDetails.forEach(subMod => { if (subMod.is_active) activeSimilarMods.add(subMod.name); });
        rebuildGroupConflictCache();

        // Efficient Logic for grouping similar mods
        const modToOriginalGroupsMap = new Map();
        allSimilarGroups.forEach(group => {
            if (!Array.isArray(group?.mod_names)) return;
            group.mod_names.forEach(modName => {
                if (!modToOriginalGroupsMap.has(modName)) modToOriginalGroupsMap.set(modName, []);
                modToOriginalGroupsMap.get(modName).push({ id: group.group_id, name: group.group_name });
            });
        });

        // Optimized Connected Components (BFS)
        const adj = new Map();
        const allGroupedModNames = new Set();

        allSimilarGroups.forEach(group => {
            if (!Array.isArray(group?.mod_names)) return;
            const mods = group.mod_names;
            for (let i = 0; i < mods.length; i++) {
                allGroupedModNames.add(mods[i]);
                if (!adj.has(mods[i])) adj.set(mods[i], new Set());
                if (i > 0) {
                    adj.get(mods[i]).add(mods[i - 1]);
                    adj.get(mods[i - 1]).add(mods[i]);
                }
            }
        });

        const visited = new Set();
        const components = [];

        allGroupedModNames.forEach(modName => {
            if (!visited.has(modName)) {
                const component = new Set();
                const stack = [modName];
                visited.add(modName);
                while (stack.length > 0) {
                    const currentMod = stack.pop();
                    component.add(currentMod);
                    const neighbors = adj.get(currentMod);
                    if (neighbors) {
                        neighbors.forEach(neighbor => {
                            if (!visited.has(neighbor)) {
                                visited.add(neighbor);
                                stack.push(neighbor);
                            }
                        });
                    }
                }
                components.push(Array.from(component));
            }
        });

        const renderableItems = [];
        const processedModNames = new Set();
        const filteredModByName = new Map(filteredModDetails.map(mod => [mod.name, mod]));

        components.forEach((componentModNames, index) => {
            const componentMods = componentModNames
                .map(modName => filteredModByName.get(modName))
                .filter(Boolean);
            if (componentMods.length === 0) return;

            const modPartitions = new Map();
            componentMods.forEach(mod => {
                const key = JSON.stringify((modToOriginalGroupsMap.get(mod.name) || []).map(g => g.name).sort());
                if (!modPartitions.has(key)) modPartitions.set(key, []);
                modPartitions.get(key).push(mod);
            });

            const partitionEntries = [...modPartitions.entries()].map(([key, mods]) => {
                const parsedGroups = JSON.parse(key);
                return { parsedGroups, mods };
            });

            partitionEntries.sort((a, b) => a.parsedGroups.length - b.parsedGroups.length);

            const blocks = partitionEntries.map(({ parsedGroups, mods }) => ({
                type: parsedGroups.length === 1 ? 'unique' : 'intersection',
                group_name: parsedGroups.length === 1 ? parsedGroups[0] : undefined,
                group_names: parsedGroups.length > 1 ? parsedGroups : undefined,
                mods: mods.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
            }));

            const componentDisplayName = new Set(blocks.flatMap(block => block.group_names || [block.group_name]));
            const minDisplayOrder = Math.min(...componentMods.map(m => m.display_order ?? Infinity));

            renderableItems.push({
                type: 'group_component',
                component_id: `component_${index}`,
                component_name: Array.from(componentDisplayName).sort().join(' / '),
                blocks: blocks,
                display_order: minDisplayOrder,
            });
            componentMods.forEach(mod => processedModNames.add(mod.name));
        });

        filteredModDetails.forEach(mod => {
            if (!processedModNames.has(mod.name)) {
                renderableItems.push({ type: 'mod', mod: mod, display_order: mod.display_order ?? Infinity });
            }
        });

        // Prepare the new list using client-side sorting immediately
        currentRenderableItems = applyClientSideSorting(renderableItems, currentSortMethod);

        // 渲染页面，传入在 IPC 调用前保存的滚动位置
        renderPage(savedScrollTop);

    } catch (error) {
        if (loadSeq !== modListLoadSeq) return;
        console.error('Failed to load mod list:', error);
        showToast('modlist.load.failed', 'error');
    } finally {
        // Only the latest request controls global loading visibility.
        if (loadSeq === modListLoadSeq) {
            hideLoadingOverlay();
        }
    }
}

function renderPage(savedScrollTop = -1) {
    const scrollContainer = document.querySelector('.mod-list-scroll-area');
    const container = document.querySelector('.mod-list');
    if (!container) return;

    // 确定要恢复的滚动位置：优先使用外部传入的（IPC 调用前同步保存的），否则用当前值
    const targetScrollTop = savedScrollTop >= 0 ? savedScrollTop : (scrollContainer ? scrollContainer.scrollTop : 0);

    // 隐藏滚动容器，防止"空白 -> 内容"的闪烁（在同一帧内完成 DOM 变更和滚动恢复后再显示）
    if (scrollContainer) {
        scrollContainer.style.visibility = 'hidden';
    }

    // Render all items
    const batch = currentRenderableItems;

    if (batch.length === 0) {
        container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-disabled);">${t('modlist.empty')}</div>`;
    } else {
        const html = batch.map(item =>
            item.type === 'group_component' ? createGroupComponentHTML(item) : createModItemHTML(item.mod)
        ).join('');
        container.innerHTML = html;
    }

    // Global initializations for new items
    initializeAllSubModDisplays();

    // Re-apply states
    currentOpenSubModLists.forEach((isOpen, parentModName) => {
        if (isOpen) {
            const subModList = document.getElementById(`sub-mods-${parentModName}`);
            const parentModItem = renderedElementByModName.get(parentModName);
            const toggleIcon = parentModItem ? parentModItem.querySelector('.toggle-icon') : document.querySelector(`.mod-item[data-mod-name="${parentModName}"] .toggle-icon`);
            if (subModList) subModList.style.display = 'block';
            if (toggleIcon) toggleIcon.classList.add('rotated');
        }
    });

    initializeDragAndDrop();
    initializeSubModDragAndDrop();

    renderedItemOrder = Array.from(container.querySelectorAll('.mod-item, .sub-mod-item'));
    rebuildRenderedElementCache(container);
    updateAllVisualSelections();
    applyTagColors();
    updateSelectionDependentButtons();
    updateReturnAllModsButtonVisibility();
    updateFilterButtonStates();
    initializeConflictTooltips();

    // 先同步恢复滚动位置（浏览器布局完成后但绘制前），再用 rAF 显示容器
    // 这确保用户只看到最终状态，彻底消除闪烁和滚动位置跳动
    if (scrollContainer) {
        scrollContainer.scrollTop = targetScrollTop;
        requestAnimationFrame(() => {
            scrollContainer.style.visibility = '';
        });
    }
}

function filterModsClientSide(mods, filters) {
    const search = normalize_string(filters.search_query);
    const tags = filters.tag_filter ? filters.tag_filter.split(',').map(t => t.trim().toLowerCase()) : [];
    const status = filters.activation_filter;
    const hasSearch = !!search;
    const hasTags = tags.length > 0;
    const filterTagSet = hasTags ? new Set(tags) : null;

    return mods.filter(mod => {
        if (hasSearch) {
            if (!(mod.__searchFullIndex || '').includes(search)) return false;
        }
        if (hasTags) {
            const hasTag = hasAnyTag(mod.__tagLowerSet || mod.tags, filterTagSet);
            const subHasTag = mod.sub_mods && mod.sub_mods.some(sm => hasAnyTag(sm.__tagLowerSet || sm.tags, filterTagSet));
            if (!hasTag && !subHasTag) return false;
        }
        if (status === 'active' && !mod.is_active) return false;
        if (status === 'inactive' && mod.is_active) return false;
        return true;
    });
}

// 冲突检测代码已移除
function findConflictsForMod(modName) {
    return {};
}

function createGroupComponentHTML(component) {
    const blocksHTML = component.blocks.map(block => {
        // 修复：确保组内 mod item 渲染时也能正确设置 priority 数据集
        const modsHTML = block.mods.map(mod => createModItemHTML(mod)).join('');
        let headerText = '';
        let blockClass = '';
        const isSingleUniqueBlockInComponent = component.blocks.length === 1 && block.type === 'unique';

        if (block.type === 'unique') {
            headerText = isSingleUniqueBlockInComponent ? '' : `<i class="fas fa-folder"></i> ${t('group.belongs_to', { group: block.group_name })}`;
            blockClass = 'unique-block';
        } else {
            headerText = `<i class="fas fa-layer-group"></i> ${t('group.intersection', { groups: block.group_names.join(', ') })}`;
            blockClass = 'intersection-block';
        }

        const headerHTML = headerText ? `<div class="block-header">${headerText}</div>` : '';
        return `<div class="group-block ${blockClass}">${headerHTML}${modsHTML}</div>`;
    }).join('');

    return `<div class="component-wrapper" draggable="${currentSortMethod === 'default' ? 'true' : 'false'}" data-component-id="${component.component_id}"><div class="component-header">${component.component_name}</div>${blocksHTML}</div>`;
}

// 核心函数：生成 Mod 列表项 HTML
function createModItemHTML(mod) {
    const isSelected = selectedModNames.has(mod.name);
    const modSimilarGroups = similarGroupsByModName.get(mod.name) || [];
    const isInSimilarGroup = modSimilarGroups.length > 0;

    // --- Visibility Logic for Sub-Mods ---
    let subModsToRender = mod.sub_mods;

    // Only apply visibility filtering if we have active filters (search or tags)
    if (activeRenderFilters && (activeRenderFilters.search_query || activeRenderFilters.tag_filter)) {
        const search = activeRenderSearch;
        const filterTagSet = activeRenderTagSet;

        // 1. Check if Parent Mod matches
        let parentMatchesSearch = true;
        if (search) {
            const selfIndex = mod.__searchSelfIndex || '';
            const matchName = (mod.__normName || '').includes(search);
            const matchDisplay = (mod.__normDisplay || '').includes(search);
            const matchTags = (mod.__normTags || []).some(tag => tag.includes(search));
            if (!matchName && !matchDisplay && !matchTags && !selfIndex.includes(search)) parentMatchesSearch = false;
        }

        let parentMatchesTags = true;
        if (filterTagSet && filterTagSet.size > 0) {
            const hasTag = hasAnyTag(mod.__tagLowerSet || mod.tags, filterTagSet);
            if (!hasTag) parentMatchesTags = false;
        }

        const parentMatches = parentMatchesSearch && parentMatchesTags;

        // 2. If Parent doesn't match, strictly filter sub-mods
        if (!parentMatches) {
            subModsToRender = mod.sub_mods.filter(sub_mod => {
                // Check Search
                if (search) {
                    const matchName = (sub_mod.__normName || normalize_string(sub_mod.name)).includes(search);
                    const matchDisplay = (sub_mod.__normDisplay || normalize_string(sub_mod.display_name)).includes(search);
                    const matchTags = (sub_mod.__normTags || []).some(tag => tag.includes(search));
                    // Sub-mod tags search? Only if we decide sub-mod tags contribute to search hits
                    // existing logic: const matchTags = mod.tags...
                    // Let's assume sub-mod name/display is key
                    if (!matchName && !matchDisplay && !matchTags) return false;
                }

                // Check Tags
                if (filterTagSet && filterTagSet.size > 0) {
                    // Sub-mod must have one of the selected tags? 
                    // Or does 'tag_filter' mean "Show mods that have these tags"?
                    // Existing logic: const subHasTag = mod.sub_mods... some(sm => sm.tags...)
                    const subHasTag = hasAnyTag(sub_mod.__tagLowerSet || sub_mod.tags, filterTagSet);
                    if (!subHasTag) return false;
                }

                return true;
            });
        }
    }
    // -------------------------------------

    let conflictTooltipContent = '';
    let hasFileConflict = false;
    const modConflicts = findConflictsForMod(mod.name);
    if (Object.keys(modConflicts).length > 0) {
        hasFileConflict = true;
        conflictTooltipContent = `${t('conflict.warning')}\n`;
        for (const file in modConflicts) {
            conflictTooltipContent += ` - ${file} (${t('conflict.with')}: ${modConflicts[file].join(', ')})\n`;
        }
    }

    let modNameDisplayHtml = '';
    const firstSpaceIndex = mod.display_name.indexOf(' ');
    if (firstSpaceIndex !== -1) {
        const part1 = mod.display_name.substring(0, firstSpaceIndex);
        const part2 = mod.display_name.substring(firstSpaceIndex + 1);
        modNameDisplayHtml = `<span class="mod-name-part2">${part1}</span><span class="mod-name-part1">${part2}</span>`;
    } else {
        modNameDisplayHtml = `<span class="mod-name-part1">${mod.display_name}</span>`;
    }

    const priority = mod.priority !== undefined && mod.priority !== null && !isNaN(mod.priority) ? parseInt(mod.priority) : 9;
    const priorityDisplay = `<span class="mod-priority-display" title="${t('mod.priority', { priority })}">${priority}</span>`;

    // --- 主 Mod 按钮逻辑：检测组内冲突并设置橙色样式 ---
    let buttonHtml = '';
    if (mod.is_active) {
        // 已激活：显示绿色按钮，点击禁用
        buttonHtml = `<span class="mod-status active" onclick="event.stopPropagation(); toggleModActivation('${mod.name}', true, this)"><i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span></span>`;
    } else {
        // 未激活：检查是否有组内冲突
        const conflictInfo = groupConflictByModName.get(mod.name);
        const conflictingModName = conflictInfo ? conflictInfo.activeMember : null;
        const conflictingGroupName = conflictInfo ? conflictInfo.groupName : null;

        if (conflictingModName) {
            // 有冲突：显示橙色按钮，绑定确认弹窗函数
            buttonHtml = `<span class="mod-status group-conflict" onclick="event.stopPropagation(); confirmToggleGroupConflict('${mod.name}', '${conflictingModName}', '${conflictingGroupName}')" title="${t('group.conflict.replace_title', { mod: conflictingModName })}"><i class="fas fa-exclamation-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
        } else {
            // 无冲突：显示普通灰色按钮
            buttonHtml = `<span class="mod-status inactive" onclick="event.stopPropagation(); toggleModActivation('${mod.name}', false, this)"><i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
        }
    }
    // ------------------------------------------------

    const subModsHTML = subModsToRender.length > 0 ? `
        <div class="sub-mods-list" id="sub-mods-${mod.name}" style="display: none;" data-parent-mod-name="${mod.name}">
            ${[...subModsToRender].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999)).map(sub_mod => {
        const isSubModSelected = selectedModNames.has(sub_mod.name);
        const subModSimilarGroups = similarGroupsByModName.get(sub_mod.name) || [];
        const isSubModInSimilarGroup = subModSimilarGroups.length > 0;

        // --- 子模块按钮逻辑：同样检测组内冲突 ---
        let subButtonHtml = '';
        if (sub_mod.is_active) {
            subButtonHtml = `<span class="sub-mod-status mod-status active" onclick="event.stopPropagation(); toggleSubModStatus('${mod.name}', '${sub_mod.name}', this)"><i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span></span>`;
        } else {
            const subConflictInfo = groupConflictByModName.get(sub_mod.name);
            const subConflictingModName = subConflictInfo ? subConflictInfo.activeMember : null;
            const subConflictingGroupName = subConflictInfo ? subConflictInfo.groupName : null;

            if (subConflictingModName) {
                // 子模块冲突：橙色
                subButtonHtml = `<span class="sub-mod-status mod-status group-conflict" onclick="event.stopPropagation(); confirmToggleGroupConflict('${sub_mod.name}', '${subConflictingModName}', '${subConflictingGroupName}', true, '${mod.name}')" title="${t('group.conflict.replace_title', { mod: subConflictingModName })}"><i class="fas fa-exclamation-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
            } else {
                // 子模块无冲突：灰色
                subButtonHtml = `<span class="sub-mod-status mod-status inactive" onclick="event.stopPropagation(); toggleSubModStatus('${mod.name}', '${sub_mod.name}', this)"><i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
            }
        }
        // ------------------------------------

        let subConflictTooltipContent = '';
        let subHasFileConflict = false;
        const subModConflicts = findConflictsForMod(sub_mod.name);
        if (Object.keys(subModConflicts).length > 0) {
            subHasFileConflict = true;
            subConflictTooltipContent = `${t('conflict.warning')}\n`;
            for (const file in subModConflicts) {
                subConflictTooltipContent += ` - ${file} (${t('conflict.with')}: ${subModConflicts[file].join(', ')})\n`;
            }
        }
        let subModNameDisplayHtml = '';
        const subModFirstSpaceIndex = sub_mod.display_name.indexOf(' ');
        if (subModFirstSpaceIndex !== -1) {
            const subPart1 = sub_mod.display_name.substring(0, subModFirstSpaceIndex);
            const subPart2 = sub_mod.display_name.substring(subModFirstSpaceIndex + 1);
            subModNameDisplayHtml = `<span class="sub-mod-name-part2">${subPart1}</span><span class="sub-mod-name-part1">${subPart2}</span>`;
        } else {
            subModNameDisplayHtml = `<span class="sub-mod-name-part1">${sub_mod.display_name}</span>`;
        }
        const subModTagsHTML = (sub_mod.tags || []).map(tag => tag ? `<span class="tag" data-tag-name="${tag.toLowerCase()}">${tag}</span>` : '').join('');

        return `<div class="sub-mod-item ${isSubModSelected ? 'selected' : ''} ${subHasFileConflict ? 'has-conflict' : ''}" data-sub-mod-name="${sub_mod.name}" data-sub-mod-is-active="${sub_mod.is_active}" data-parent-mod-name="${mod.name}" data-tags="${(sub_mod.tags || []).map(t => t.toLowerCase()).join(',')}" draggable="${currentSortMethod === 'default' ? 'true' : 'false'}">
                    <div class="sub-mod-name-column"><input type="checkbox" class="sub-mod-checkbox mod-checkbox" value="${sub_mod.name}" ${isSubModSelected ? 'checked' : ''}><div class="conflict-icon-container">${subHasFileConflict ? `<span class="conflict-icon" data-tooltip="${subConflictTooltipContent}"><i class="fas fa-exclamation-triangle"></i></span>` : ''}</div><span class="sub-mod-name">${subModNameDisplayHtml}</span></div>
                    <div class="sub-mod-tags-column mod-tags-column">${subModTagsHTML}</div>
                    <div class="sub-mod-status-column mod-status-column">${subButtonHtml}</div>
                </div>`;
    }).join('')}
        </div>
    ` : '';

    const tagsHTML = mod.tags.map(tag => tag ? `<span class="tag" data-tag-name="${tag.toLowerCase()}">${tag}</span>` : '').join('');

    return `<div class="mod-item ${isSelected ? 'selected' : ''} ${isInSimilarGroup ? 'in-similar-group' : ''} ${hasFileConflict ? 'has-conflict' : ''}" data-mod-name="${mod.name}" data-tags="${mod.tags.map(t => t.toLowerCase()).join(',')}" data-is-active="${mod.is_active}" data-has-submods="${mod.sub_mods.length > 0}" data-priority="${priority}" draggable="${currentSortMethod === 'default' ? 'true' : 'false'}">
            <div class="mod-name-column"><input type="checkbox" class="mod-checkbox" value="${mod.name}" ${isSelected ? 'checked' : ''}><div class="conflict-icon-container">${hasFileConflict ? `<span class="conflict-icon" data-tooltip="${conflictTooltipContent}"><i class="fas fa-exclamation-triangle"></i></span>` : ''}</div><span class="mod-name-text">${modNameDisplayHtml}${priorityDisplay}</span>${mod.sub_mods.length > 0 ? `<span class="toggle-icon"></span>` : ''}</div>
            <div class="mod-tags-column">${tagsHTML}</div>
            <div class="mod-status-column">${buttonHtml}</div>
            ${subModsHTML}
        </div>`;
}

// 新增：处理组内冲突时的确认弹窗
function confirmToggleGroupConflict(newModName, activeModName, groupName, isSubMod = false, parentModName = null) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmTitle = document.getElementById('confirmModalTitle');
    const confirmContent = document.getElementById('confirmModalContent');
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const cancelBtn = document.getElementById('confirmModalCancelBtn');

    // 设置弹窗内容
    confirmTitle.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: var(--accent-orange);"></i> ${t('group.conflict.modal_title')}`;
    confirmTitle.style.color = 'var(--accent-orange)';

    confirmContent.innerHTML = `
        <p>${t('group.conflict.about_enable', { group: `<strong style="color: var(--accent-blue);">${groupName}</strong>` })}</p>
        <p style="font-size: 1.2em; margin: 1rem 0; color: var(--text-primary);">${newModName}</p>
        <p>${t('group.conflict.auto_disable_prefix')}<span style="color: var(--accent-red); font-weight: bold;">${t('group.conflict.auto_disable')}</span>${t('group.conflict.auto_disable_suffix')}</p>
        <p style="font-size: 1.1em; color: var(--text-secondary);">${activeModName}</p>
        <p style="margin-top: 1.5rem; font-size: 0.9em; opacity: 0.8;">${t('confirm.continue')}</p>
    `;

    // 绑定确认按钮事件 (使用 onclick 覆盖之前的监听器)
    confirmBtn.onclick = async () => {
        closeModal('confirmModal');
        // 调用切换逻辑
        if (isSubMod && parentModName) {
            toggleSubModStatus(parentModName, newModName);
        } else {
            toggleModActivation(newModName, false); // false 表示当前未激活，所以要激活
        }
    };

    // 绑定取消按钮
    cancelBtn.onclick = () => {
        closeModal('confirmModal');
    };

    // 显示弹窗
    confirmModal.style.display = 'flex';
}

function handleSelectionClick(e, clickedItem) {
    const checkbox = clickedItem.querySelector('.mod-checkbox');
    if (!checkbox) return;
    if (e.shiftKey && lastCheckedMod && lastCheckedMod !== checkbox) {
        e.preventDefault();
        const selectionState = lastCheckedMod.checked;
        const startIndex = renderedItemOrder.indexOf(lastCheckedMod.closest('.mod-item, .sub-mod-item'));
        const endIndex = renderedItemOrder.indexOf(clickedItem);
        if (startIndex !== -1 && endIndex !== -1) {
            const min = Math.min(startIndex, endIndex);
            const max = Math.max(startIndex, endIndex);
            for (let i = min; i <= max; i++) {
                const item = renderedItemOrder[i];
                const itemCheckbox = item.querySelector('.mod-checkbox');
                if (itemCheckbox) {
                    itemCheckbox.checked = selectionState;
                    if (selectionState) selectedModNames.add(itemCheckbox.value);
                    else selectedModNames.delete(itemCheckbox.value);
                }
            }
        }
    } else {
        const isDirectCheckboxClick = e.target === checkbox;
        const finalCheckedState = isDirectCheckboxClick ? checkbox.checked : !checkbox.checked;
        if (!isDirectCheckboxClick) checkbox.checked = finalCheckedState;
        if (finalCheckedState) selectedModNames.add(checkbox.value);
        else selectedModNames.delete(checkbox.value);
        lastCheckedMod = checkbox;
    }
    updateAllVisualSelections();
    updateSelectionDependentButtons();
}

function updateAllVisualSelections() {
    document.querySelectorAll('.mod-item, .sub-mod-item').forEach(item => {
        const modName = item.dataset.modName || item.dataset.subModName;
        const checkbox = item.querySelector('.mod-checkbox');
        if (modName && checkbox) {
            const isSelected = selectedModNames.has(modName);
            item.classList.toggle('selected', isSelected);
            checkbox.checked = isSelected;
        }
    });
}

function showFileConflictModal(modName, details, isSubMod = false, parentModName = null) {
    const modal = document.getElementById('fileConflictModal');
    document.getElementById('fileConflictModalTitle').innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${t('conflict.activate_failed', { mod: modName })}`;
    const contentEl = document.getElementById('fileConflictModalContent');
    contentEl.innerHTML = `<p>${t('modal.fileconflict.content')}</p>`;
    const list = document.createElement('ul');
    list.className = 'conflict-list';
    list.style.paddingLeft = '20px';
    for (const file in details) {
        list.innerHTML += `<li style="margin-top:0.5rem;"><strong>${t('conflict.file')}:</strong> ${file}<br><strong>${t('conflict.mods')}:</strong> ${details[file].join(', ')}</li>`;
    }
    contentEl.appendChild(list);
    document.getElementById('fileConflictModalConfirmBtn').onclick = () => closeModal('fileConflictModal');
    const forceActivateBtn = document.getElementById('fileConflictModalForceActivateBtn');
    forceActivateBtn.classList.remove('hidden');
    forceActivateBtn.onclick = () => {
        closeModal('fileConflictModal');
        if (isSubMod && parentModName) toggleSubModStatus(parentModName, modName, null, true);
        else toggleModActivation(modName, false, null, true);
    };
    modal.style.display = 'flex';
}

// ============================================================
// 原地更新：启用/禁用 Mod 后只更新受影响的 DOM 元素，避免全列表重建造成的闪烁
// ============================================================

// 同步内存数据，修复预设保存和应用等依赖内存数据的功能失效的问题
function syncModStateToMemory(modName, isActive, isSubMod = false, parentModName = null) {
    if (isSubMod && parentModName) {
        // 更新所属主 Mod 里面的 sub_mods 数组
        const parentMod = mainModByName.get(parentModName);
        if (parentMod && parentMod.sub_mods) {
            const subModInfo = parentMod.sub_mods.find(s => s.name === modName);
            if (subModInfo) {
                subModInfo.is_active = isActive;
            }
        }
        const flatSubMod = subModByName.get(modName);
        if (flatSubMod) flatSubMod.is_active = isActive;
    } else {
        // 更新主 Mod 状态
        const mod = mainModByName.get(modName);
        if (mod) {
            mod.is_active = isActive;
        }
    }
}
function updateToggleInPlace(toggledModName, newIsActive) {
    // 1. 更新内存中的 activeSimilarMods 状态
    if (newIsActive) {
        activeSimilarMods.add(toggledModName);
    } else {
        activeSimilarMods.delete(toggledModName);
    }
    rebuildGroupConflictCache();

    // 2. 找到与此 Mod 同属一个同类组的所有其他 Mod，更新它们的状态按钮
    //    因为同类组内的冲突状态可能已经改变
    const affectedGroups = similarGroupsByModName.get(toggledModName) || [];
    if (affectedGroups.length === 0) return; // 不在任何同类组中，无需更新邻居

    // 收集同类组内所有需要更新按钮的 Mod 名称（排除刚刚切换的那个）
    const siblingModNames = new Set();
    affectedGroups.forEach(group => {
        group.mod_names.forEach(name => {
            if (name !== toggledModName) siblingModNames.add(name);
        });
    });

    // 3. 对每个受影响的同类 Mod，计算新的冲突状态并更新按钮
    siblingModNames.forEach(siblingName => {
        let modItem = renderedElementByModName.get(siblingName);
        if (!modItem || !modItem.isConnected) {
            modItem = document.querySelector(`.mod-item[data-mod-name="${siblingName}"], .sub-mod-item[data-sub-mod-name="${siblingName}"]`);
            if (modItem) renderedElementByModName.set(siblingName, modItem);
        }
        if (!modItem) return; // 不在当前过滤视图中

        const isSubMod = modItem.classList.contains('sub-mod-item');
        const parentModName = isSubMod ? modItem.dataset.parentModName : null;

        // BUG FIX: check both data-is-active and data-sub-mod-is-active
        const isCurrentlyActive = isSubMod ? (modItem.dataset.subModIsActive === 'true') : (modItem.dataset.isActive === 'true');

        // BUG FIX: If the newly toggled mod was activated, it forcibly deactivated any currently active sibling in the backend.
        // We MUST update the UI and memory for this sibling to reflect its new 'inactive due to conflict' state.
        if (isCurrentlyActive && !newIsActive) {
            return; // If we just deactivated a mod, siblings that are active stay active and don't get new conflicts.
        }

        const statusCol = modItem.querySelector('.mod-status-column');
        if (!statusCol) return;

        // 找出此兄弟 Mod 所在的同类组，检查是否现在有冲突
        const conflictInfo = groupConflictByModName.get(siblingName);
        const conflictingModName = conflictInfo ? conflictInfo.activeMember : null;
        const conflictingGroupName = conflictInfo ? conflictInfo.groupName : null;

        // 生成新按钮 HTML
        let newButtonHtml;
        if (conflictingModName) {
            newButtonHtml = `<span class="${isSubMod ? 'sub-mod-status' : ''} mod-status group-conflict" onclick="event.stopPropagation(); confirmToggleGroupConflict('${siblingName}', '${conflictingModName}', '${conflictingGroupName}', ${isSubMod}, ${isSubMod ? `'${parentModName}'` : 'null'})" title="${t('group.conflict.replace_title', { mod: conflictingModName })}"><i class="fas fa-exclamation-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
        } else {
            if (isSubMod) {
                newButtonHtml = `<span class="sub-mod-status mod-status inactive" onclick="event.stopPropagation(); toggleSubModStatus('${parentModName}', '${siblingName}', this)"><i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
            } else {
                newButtonHtml = `<span class="mod-status inactive" onclick="event.stopPropagation(); toggleModActivation('${siblingName}', false, this)"><i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span></span>`;
            }
        }

        statusCol.innerHTML = newButtonHtml;

        // Update Dataset properties to reflect deactivated state
        if (isCurrentlyActive && newIsActive && conflictingModName) {
            if (isSubMod) {
                modItem.dataset.subModIsActive = 'false';
            } else {
                modItem.dataset.isActive = 'false';

                // If it's a main mod, we must also update its children to Pending state visually
                const toggleBtn = statusCol.querySelector('.mod-status');
                if (toggleBtn) toggleBtn.click = null; // Prevent accidental clicks during transition
            }

            // Uncheck the checkbox
            const checkbox = modItem.querySelector('.mod-checkbox');
            if (checkbox) checkbox.checked = false;
            selectedModNames.delete(siblingName);

            // Sync memory
            syncModStateToMemory(siblingName, false, isSubMod, parentModName);
        }
    });
}

function toggleModActivation(modName, isActive, buttonElement = null, forceActivate = false) {
    const safeModName = String(modName).trim();

    // If called from confirmation modal, buttonElement might be null. Try to find it.
    if (!buttonElement) {
        const modItem = renderedElementByModName.get(safeModName) || document.querySelector(`.mod-item[data-mod-name="${safeModName}"]`);
        if (modItem) {
            renderedElementByModName.set(safeModName, modItem);
            buttonElement = modItem.querySelector('.mod-status');
        }
    }

    let action = '';
    let args = null;

    if (isActive) {
        // Deactivate: main.js expects a String explicitly
        action = 'deactivate-mod';
        args = safeModName;
    } else {
        // Activate: main.js expects an Object { modName, force }
        action = 'activate-mod';
        args = { modName: safeModName, force: forceActivate };
    }

    console.log(`[ModManager] Toggling ${safeModName} (Active: ${isActive}) -> Action: ${action}`, args);

    // OPTIMISTIC UI UPDATE: Show Loading State immediately
    if (buttonElement && buttonElement.classList) {
        // Prevent double clicks
        buttonElement.style.pointerEvents = 'none';

        // Set Loading State
        buttonElement.className = 'mod-status processing';
        buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span class="status-text">${t('mod.status.loading')}</span>`;
    }

    callIPC(action, args, (result) => {
        console.log(`[ModManager] IPC Result for ${safeModName}:`, result);

        // Restore pointer events
        if (buttonElement) buttonElement.style.pointerEvents = 'auto';

        if (result.success) {
            // OPTIMISTIC UI UPDATE: Immediately reflect state change (Success)
            if (buttonElement && buttonElement.classList) {
                if (isActive) {
                    // Changing to Inactive
                    buttonElement.className = 'mod-status inactive';
                    const icon = buttonElement.querySelector('i');
                    const text = buttonElement.querySelector('.status-text');
                    if (icon) icon.className = 'fas fa-times-circle';
                    if (text) text.textContent = t('mod.status.inactive');
                    if (!icon || !text) {
                        buttonElement.innerHTML = `<i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span>`;
                    }
                    buttonElement.setAttribute('onclick', `event.stopPropagation(); window.toggleModActivation('${safeModName}', false, this)`);

                    const modItem = buttonElement.closest('.mod-item');
                    if (modItem) {
                        modItem.dataset.isActive = 'false';
                    }
                } else {
                    // Changing to Active
                    buttonElement.className = 'mod-status active';
                    const icon = buttonElement.querySelector('i');
                    const text = buttonElement.querySelector('.status-text');
                    if (icon) icon.className = 'fas fa-check-circle';
                    if (text) text.textContent = t('mod.status.active');
                    if (!icon || !text) {
                        buttonElement.innerHTML = `<i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span>`;
                    }
                    buttonElement.setAttribute('onclick', `event.stopPropagation(); window.toggleModActivation('${safeModName}', true, this)`);

                    const modItem = buttonElement.closest('.mod-item');
                    if (modItem) {
                        modItem.dataset.isActive = 'true';
                    }
                }
            }

            showToast(isActive ? 'toast.mod.deactivate.success' : 'toast.mod.activate.success', isActive ? 'info' : 'success', 3000, { name: safeModName });

            // BUG FIX: sync in-memory data so preset logic works without a hard refresh
            syncModStateToMemory(safeModName, !isActive);

            // 原地更新同类组中其他 Mod 的按钮，无需重建整个列表（彻底消除闪烁）
            updateToggleInPlace(safeModName, !isActive);
            initializeAllSubModDisplays(); // BUG FIX: update sub-mod UI immediately
            clearAllSelections();

            // --- UNDO: push reversible action ---
            if (window.undoManager) {
                window.undoManager.push({
                    description: t(isActive ? 'undo.mod.deactivate' : 'undo.mod.activate', { name: safeModName }),
                    undo: () => toggleModActivation(safeModName, !isActive)
                });
            }
        } else if (result.conflict_type === 'file' && !forceActivate) {
            // Revert loading state if conflict (because user might cancel)
            if (buttonElement) {
                if (isActive) {
                    buttonElement.className = 'mod-status active';
                    buttonElement.innerHTML = `<i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span>`;
                } else {
                    buttonElement.className = 'mod-status inactive';
                    buttonElement.innerHTML = `<i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span>`;
                }
                buttonElement.style.pointerEvents = 'auto';
            }
            showFileConflictModal(safeModName, result.details);
        } else {
            // Revert on error
            if (buttonElement) {
                if (isActive) {
                    buttonElement.className = 'mod-status active';
                    buttonElement.innerHTML = `<i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span>`;
                } else {
                    buttonElement.className = 'mod-status inactive';
                    buttonElement.innerHTML = `<i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span>`;
                }
                buttonElement.style.pointerEvents = 'auto';
            }
            showToast(result.message || t('toast.mod.activate.fail', { name: safeModName }), 'error');
        }
    }, null, true);
}

function toggleSubModStatus(parentModName, subModName, buttonElement = null, forceActivate = false) {
    const subModItem = renderedElementByModName.get(subModName) || document.querySelector(`.sub-mod-item[data-sub-mod-name="${subModName}"]`);
    if (subModItem) renderedElementByModName.set(subModName, subModItem);

    // If called from confirmation modal, subModItem might be found, but buttonElement is null.
    // Try to find buttonElement if missing
    if (!buttonElement && subModItem) {
        buttonElement = subModItem.querySelector('.sub-mod-status');
    }

    const wantsActive = subModItem ? (subModItem.dataset.subModIsActive !== 'true') : true;
    const action = wantsActive ? 'activate' : 'deactivate';

    callIPC('toggle-sub-mod', { parentModName, subModName, action, force: forceActivate }, (result) => {
        if (result.success) {
            // OPTIMISTIC UI UPDATE
            if (buttonElement && buttonElement.classList) {
                if (wantsActive) {
                    // Became Active
                    buttonElement.className = 'sub-mod-status mod-status active';
                    const icon = buttonElement.querySelector('i');
                    const text = buttonElement.querySelector('.status-text');
                    if (icon) icon.className = 'fas fa-check-circle';
                    if (text) text.textContent = t('mod.status.active');
                    if (!icon || !text) {
                        buttonElement.innerHTML = `<i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span>`;
                    }
                    buttonElement.title = ''; // clear conflict title if any
                } else {
                    // Became Inactive
                    buttonElement.className = 'sub-mod-status mod-status inactive';
                    const icon = buttonElement.querySelector('i');
                    const text = buttonElement.querySelector('.status-text');
                    if (icon) icon.className = 'fas fa-times-circle';
                    if (text) text.textContent = t('mod.status.inactive');
                    if (!icon || !text) {
                        buttonElement.innerHTML = `<i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span>`;
                    }
                }
            }

            // Update Dataset immediately
            if (subModItem) {
                subModItem.dataset.subModIsActive = wantsActive ? 'true' : 'false';
            }

            showToast(wantsActive ? 'toast.submod.activate.success' : 'toast.submod.deactivate.success', 'success', 3000, { name: subModName });

            // BUG FIX: sync in-memory data so preset logic works without a hard refresh
            syncModStateToMemory(subModName, wantsActive, true, parentModName);

            // 原地更新同类组中其他子 Mod 的按钮，无需重建整个列表
            updateToggleInPlace(subModName, wantsActive);
            clearAllSelections();

            // --- UNDO: push reversible action ---
            if (window.undoManager) {
                window.undoManager.push({
                    description: t(wantsActive ? 'undo.submod.activate' : 'undo.submod.deactivate', { name: subModName }),
                    undo: () => toggleSubModStatus(parentModName, subModName)
                });
            }
        } else if (result.conflict_type === 'file' && !forceActivate) {
            showFileConflictModal(subModName, result.details, true, parentModName);
        } else {
            showToast(result.message || t('toast.mod.activate.fail', { name: subModName }), 'error');
        }
    }, null, true);
}

async function deleteMod(modName, isSubMod = false, parentModName = null, buttonElement = null) {
    const confirmationKey = isSubMod ? 'confirm.submod.delete.msg' : 'confirm.mod.delete.msg';
    if (await showConfirm('confirm.mod.delete.title', confirmationKey, { name: modName, parent: parentModName || '' })) {
        callIPC('delete-mod', { modName, isSubMod, parentModName }, (result) => {
            if (result.success) {
                showToast(isSubMod ? 'toast.submod.add.success' : 'toast.mod.delete.success', 'success', 3000, { name: modName });
                selectedModNames.delete(modName);
                loadAndRenderModList();
                refreshTagFilters();
            } else {
                showToast(result.message || t('toast.mod.delete.fail', { name: modName }), 'error');
            }
        }, buttonElement);
    }
}

function initializeAllSubModDisplays() {
    document.querySelectorAll('.mod-item').forEach(modItem => {
        const parentIsActive = modItem.dataset.isActive === 'true';
        modItem.querySelectorAll('.sub-mod-item').forEach(subItem => {
            const subModWantsActive = subItem.dataset.subModIsActive === 'true';
            const statusElement = subItem.querySelector('.sub-mod-status');
            if (!statusElement) return;
            // 保持 group-conflict 的样式，不被覆盖
            if (statusElement.classList.contains('group-conflict')) return;

            if (parentIsActive) {
                statusElement.title = t('tooltip.toggle_activation');
                statusElement.style.cursor = 'pointer';

                // BUG FIX: explicitly restore the visual HTML when parent becomes active again
                if (subModWantsActive) {
                    statusElement.className = 'sub-mod-status mod-status active';
                    statusElement.innerHTML = `<i class="fas fa-check-circle"></i> <span class="status-text">${t('mod.status.active')}</span>`;
                } else {
                    statusElement.className = 'sub-mod-status mod-status inactive';
                    statusElement.innerHTML = `<i class="fas fa-times-circle"></i> <span class="status-text">${t('mod.status.inactive')}</span>`;
                }
            } else {
                statusElement.title = t('tooltip.enable_parent_first');
                statusElement.style.cursor = 'not-allowed';
                if (subModWantsActive) statusElement.innerHTML = `<i class="fas fa-hourglass-half"></i> <span class="status-text">${t('status.pending')}</span>`;
            }
        });
    });
}

function toggleSubMods(modName) {
    const subModList = document.getElementById(`sub-mods-${modName}`);
    const toggleIcon = document.querySelector(`.mod-item[data-mod-name="${modName}"] .toggle-icon`);
    if (subModList && toggleIcon) {
        const isHidden = subModList.style.display === 'none' || !subModList.style.display;
        subModList.style.display = isHidden ? 'block' : 'none';
        toggleIcon.classList.toggle('rotated', isHidden);
    }
}

function updateFilterButtonStates() {
    document.querySelectorAll('.tag-filter-btn.tag-only-filter-btn').forEach(btn => {
        const tag = btn.dataset.tag.toLowerCase();
        btn.classList.toggle('active', tag === '' ? currentSelectedTags.size === 0 : currentSelectedTags.has(tag));
    });
    document.querySelectorAll('.tag-filter-btn.activation-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.activationFilter === currentActivationFilter);
    });
}

function filterModsByTag(tag, isDoubleClick = false) {
    showLoadingOverlay();
    const normalizedTag = tag.toLowerCase();
    if (isDoubleClick) {
        currentSelectedTags.clear();
        if (normalizedTag !== '') currentSelectedTags.add(normalizedTag);
    } else {
        if (normalizedTag === '') currentSelectedTags.clear();
        else currentSelectedTags.has(normalizedTag) ? currentSelectedTags.delete(normalizedTag) : currentSelectedTags.add(normalizedTag);
    }
    loadAndRenderModList();
    updateFilterButtonStates();
}

function filterModsByActivation(status) {
    showLoadingOverlay();
    currentActivationFilter = status;
    loadAndRenderModList();
    updateFilterButtonStates();
}

function performSearch() {
    showLoadingOverlay();
    currentSearchQuery = document.getElementById('searchInput').value.trim();
    loadAndRenderModList();
}

function updateReturnAllModsButtonVisibility() {
    const returnButton = document.getElementById('returnAllModsButton');
    if (returnButton) {
        const isFiltered = currentSearchQuery || currentSelectedTags.size > 0 || currentActivationFilter !== 'all';
        returnButton.classList.toggle('visible', isFiltered);
    }
}

function clearSearch() {
    showLoadingOverlay();
    currentSearchQuery = '';
    currentSelectedTags.clear();
    currentActivationFilter = 'all';
    document.getElementById('searchInput').value = '';
    loadAndRenderModList();
    updateFilterButtonStates();
}

function updateSelectionDependentButtons() {
    const selectedCount = selectedModNames.size;

    // New Sidebar View Toggling Logic
    const defaultView = document.getElementById('sidebar-default-view');
    const opsView = document.getElementById('sidebar-ops-view');
    const modOperationsCountSpan = document.getElementById('modOperationsCount');

    if (selectedCount > 0) {
        // Show Ops View, Hide Default
        if (defaultView) defaultView.classList.remove('active');
        if (opsView) opsView.classList.add('active');

        if (modOperationsCountSpan) modOperationsCountSpan.textContent = `(${selectedCount})`;
    } else {
        // Show Default View, Hide Ops
        if (opsView) opsView.classList.remove('active');
        if (defaultView) defaultView.classList.add('active');

        if (modOperationsCountSpan) modOperationsCountSpan.textContent = '';
    }

    document.getElementById('sidebarEditTagsBtn').classList.toggle('hidden', selectedCount === 0);
    document.getElementById('sidebarAddSubModBtn').classList.toggle('hidden', selectedCount !== 1);
    document.getElementById('sidebarAddToSimilarModBtn').classList.toggle('hidden', selectedCount === 0);
    document.getElementById('sidebarCreateSimilarModGroupBtn').classList.toggle('hidden', selectedCount < 2);

    const batchCountEl = document.getElementById('selectedModCountBatch');
    if (batchCountEl) batchCountEl.innerText = selectedCount;
    const addToSimilarCountEl = document.getElementById('selectedModsCountAddToSimilar');
    if (addToSimilarCountEl) addToSimilarCountEl.innerText = selectedCount;
    const createSimilarCountEl = document.getElementById('selectedModsForSimilarGroup');
    if (createSimilarCountEl) createSimilarCountEl.innerText = selectedCount;

    const createGroupSection = document.getElementById('createSimilarGroupSection');
    if (createGroupSection) createGroupSection.style.display = selectedCount >= 2 ? 'block' : 'none';
}

function openRenameModal(modName, isSubMod = false, parentModName = null) {
    const modToRename = getCachedModByName(modName);
    const displayName = modToRename ? modToRename.display_name : modName; // This is now custom or generated
    const fileName = modName; // Physical name

    const modal = document.getElementById('renameModal');

    // Inputs
    const displayInput = document.getElementById('newModDisplayNameInput');
    const fileInput = document.getElementById('newModFileNameInput');
    const priorityHint = document.getElementById('priorityPrefixHint');

    // Populate
    displayInput.value = displayName;
    fileInput.value = fileName;
    priorityHint.style.display = 'none'; // Hide hint for now, fully manual

    // Store Original Data
    document.getElementById('originalModFileName').value = fileName;

    modal.dataset.isSubMod = isSubMod;
    modal.dataset.parentModName = parentModName || '';
    modal.dataset.originalModName = modName;

    modal.style.display = 'flex';
    displayInput.focus();
    displayInput.select();
}

function renameMod() {
    const modal = document.getElementById('renameModal');
    const newDisplayName = document.getElementById('newModDisplayNameInput').value.trim();
    const newFileName = document.getElementById('newModFileNameInput').value.trim();
    const oldFileName = document.getElementById('originalModFileName').value;

    const isSubMod = modal.dataset.isSubMod === 'true';
    const parentModName = modal.dataset.parentModName;

    // Validation
    if (!newDisplayName || !newFileName) {
        showToast('toast.name.empty', 'warning');
        return;
    }

    if (newDisplayName === oldFileName && newFileName === oldFileName) {
        // No changes
        closeModal('renameModal');
        return;
    }

    // Call Backend
    callIPC('rename-mod', {
        oldName: oldFileName,
        newName: newFileName,
        newDisplayName: newDisplayName,
        isSubMod,
        parentModName
    }, (result) => {
        if (result.success) {
            // Capture the details we need for undo before the modal closes
            const capturedOldFileName = oldFileName;
            const capturedNewFileName = newFileName;
            const capturedNewDisplayName = newDisplayName;
            const capturedIsSubMod = isSubMod;
            const capturedParentModName = parentModName;

            showToast('toast.mod.rename.success', 'success');
            closeModal('renameModal');
            loadAndRenderModList();
            clearAllSelections();
            refreshTagFilters();

            // --- UNDO: push reversible action ---
            if (window.undoManager) {
                window.undoManager.push({
                    description: t('undo.mod.rename', { oldName: capturedOldFileName, newName: capturedNewFileName }),
                    undo: () => {
                        callIPC('rename-mod', {
                            oldName: capturedNewFileName,
                            newName: capturedOldFileName,
                            newDisplayName: capturedOldFileName,
                            isSubMod: capturedIsSubMod,
                            parentModName: capturedParentModName
                        }, (r) => {
                            if (r.success) {
                                loadAndRenderModList();
                                refreshTagFilters();
                            }
                        }, null, true);
                    }
                });
            }
        } else {
            showToast(result.message || t('toast.mod.rename.fail'), 'error');
        }
    }, modal.querySelector('button'));
}

// --- New Tag Cloud Logic ---

let currentTagStates = new Map(); // Key: tagName, Value: 'all' | 'mixed' | 'none'
let allLibraryTags = new Set();
let selectedTagsSequence = []; // FIFO queue for tracking selection order of 'all' tags


function openBatchTaggingModal(modsToTag = null) {
    if (!modsToTag) {
        modsToTag = Array.from(selectedModNames);
    }

    // Safety check
    if (!modsToTag || modsToTag.length === 0) {
        showToast('toast.no_selection', 'warning');
        return;
    }
    document.getElementById('selectedModCountBatch').innerText = modsToTag.length;

    // Bug Fix: Store the actual list of mods we are editing in the modal
    // This prevents mismatches between what is shown and what is saved (e.g. right-clicking a non-selected mod)
    const modal = document.getElementById('batchTaggingModal');
    modal.dataset.targetMods = JSON.stringify(modsToTag);

    // 1. Gather all unique tags from currently loaded mods (and submods)
    allLibraryTags = new Set();
    // Source: Global Mod Details (Active + Inactive)
    [...globalModDetails, ...allSubModDetails].forEach(m => (m.tags || []).forEach(t => allLibraryTags.add(t)));

    // 2. Determine initial state for each tag based on selection
    currentTagStates.clear();
    selectedTagsSequence = []; // Reset sequence

    const selectedModObjects = modsToTag.map(name => getCachedModByName(name)).filter(Boolean);

    if (selectedModObjects.length > 0) {
        // Count occurrences of each tag in the selection
        const tagCounts = new Map();
        selectedModObjects.forEach(mod => {
            (mod.tags || []).forEach(tag => {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
        });

        // Set states and Initial Sequence
        // If a tag is in ALL selected mods -> 'all' -> Add to sequence (alphabetical for existing ones)
        // If a tag is in SOME selected mods -> 'mixed'
        // Otherwise (but exists in library) -> 'none'

        const initiallyAllTags = [];

        allLibraryTags.forEach(tag => {
            const count = tagCounts.get(tag) || 0;
            if (count === selectedModObjects.length) {
                currentTagStates.set(tag, 'all');
                initiallyAllTags.push(tag);
            } else if (count > 0) {
                currentTagStates.set(tag, 'mixed');
            } else {
                currentTagStates.set(tag, 'none');
            }
        });

        // Sort initially selected tags alphabetically so they are consistent before user manipulation
        initiallyAllTags.sort((a, b) => a.localeCompare(b, 'zh-CN'));
        selectedTagsSequence = initiallyAllTags;
    }

    // 3. Render
    document.getElementById('tagSearchInput').value = '';
    renderTagCloud();

    modal.style.display = 'flex';
    document.getElementById('tagSearchInput').focus();

    // Setup Search Listener
    const searchInput = document.getElementById('tagSearchInput');
    // Remove old listeners to avoid duplicates if any (though usually we just overwrite onclicks, input listener is persistent)
    // Better to use oninput property assignment to clear previous
    searchInput.oninput = () => renderTagCloud();
    searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            const val = searchInput.value.trim();
            if (val) {
                addNewTagToCloud(val);
                searchInput.value = '';
                renderTagCloud();
            }
        }
    };
}

function renderTagCloud() {
    const container = document.getElementById('tagCloudGrid');
    const filter = document.getElementById('tagSearchInput').value.trim().toLowerCase();
    container.innerHTML = '';

    // Sort tags: 
    // 1. Tags in selectedTagsSequence (ordered by sequence)
    // 2. 'mixed' tags (alphabetical)
    // 3. 'none' tags (alphabetical)

    const sequenceSet = new Set(selectedTagsSequence);

    const sequenceIndex = new Map(selectedTagsSequence.map((tag, index) => [tag, index]));
    const sortedTags = Array.from(allLibraryTags).sort((a, b) => {
        const stateA = currentTagStates.get(a) || 'none';
        const stateB = currentTagStates.get(b) || 'none';

        // Priority 1: In Sequence (Active 'all')
        const inSeqA = sequenceSet.has(a);
        const inSeqB = sequenceSet.has(b);

        if (inSeqA && inSeqB) return (sequenceIndex.get(a) ?? 99999) - (sequenceIndex.get(b) ?? 99999);
        if (inSeqA) return -1;
        if (inSeqB) return 1;

        // Priority 2: State (Mixed vs None)
        const stateOrder = { 'mixed': 1, 'none': 2 }; // 'all' is handled by sequence
        // Note: If 'all' but NOT in sequence (shouldn't happen logic-wise but safe fallback), treat as -1
        if (stateA === 'all' && stateB !== 'all') return -1;
        if (stateA !== 'all' && stateB === 'all') return 1;

        if (stateOrder[stateA] !== stateOrder[stateB]) {
            return (stateOrder[stateA] || 99) - (stateOrder[stateB] || 99);
        }

        // Priority 3: Alphabetical
        return a.localeCompare(b, 'zh-CN');
    });

    sortedTags.forEach(tag => {
        if (filter && !tag.toLowerCase().includes(filter)) return;

        const state = currentTagStates.get(tag) || 'none';
        const el = document.createElement('div');
        el.className = `tag-cloud-item tag-state-${state}`;
        el.textContent = tag;

        // Add count badge if mixed (optional, but helpful)
        // For now, simple text is fine.

        el.onclick = (e) => {
            e.stopPropagation();
            cycleTagState(tag);
            renderTagCloud();
        };

        container.appendChild(el);
    });

    if (container.children.length === 0 && filter) {
        container.innerHTML = `<div style="width:100%; text-align:center; padding:1rem; color:var(--text-disabled);">${t('tag.create_hint', { name: document.getElementById('tagSearchInput').value })}</div>`;
    }
}

function addNewTagToCloud(rawTagName) {
    const tagName = String(rawTagName || '').trim();
    if (!tagName) return;

    if (!allLibraryTags.has(tagName)) {
        allLibraryTags.add(tagName);
    }
    // New tags added via input are always intended to be applied to selection
    currentTagStates.set(tagName, 'all');
    if (!selectedTagsSequence.includes(tagName)) {
        selectedTagsSequence.push(tagName);
    }
}

function cycleTagState(tag) {
    const currentState = currentTagStates.get(tag) || 'none';
    let newState;

    // Cycle Logic:
    // Mixed -> All (Select for all)
    // All -> None (Remove from all)
    // None -> All (Add to all)

    if (currentState === 'mixed') newState = 'all';
    else if (currentState === 'all') newState = 'none';
    else newState = 'all';

    currentTagStates.set(tag, newState);

    // Update Sequence
    if (newState === 'all') {
        // Add to end (FIFO - First Clicked added, but visually distinct. Wait, user said "First clicked added to front")
        // "First clicked added to front" logic: 
        // If "front" means start of the list: unshift.
        // If "front" means "ahead of others I click later": push (standard FIFO queue). 
        // Based on typical "ordering" by click: Click A (1st), Click B (2nd) -> Result A, B.
        // So I will PUSH. But the list rendering puts Sequence Items at the top.
        // So A is top, B is below A. Correct.
        if (!selectedTagsSequence.includes(tag)) {
            // Remove if exists anywhere else just in case
            selectedTagsSequence = selectedTagsSequence.filter(t => t !== tag);
            selectedTagsSequence.push(tag);
        }
    } else {
        // Remove from sequence
        selectedTagsSequence = selectedTagsSequence.filter(t => t !== tag);
    }
}

function applyBatchTags() {
    const modal = document.getElementById('batchTaggingModal');
    // Retrieve the specific list of mods we started editing
    let currentTargetMods = [];
    try {
        currentTargetMods = JSON.parse(modal.dataset.targetMods || '[]');
    } catch (e) {
        console.error("Failed to parse target mods", e);
        showToast('tags.apply.target_invalid', 'error');
        return;
    }

    // Fallback if empty (shouldn't happen with new logic, but safety first)
    if (currentTargetMods.length === 0) {
        currentTargetMods = Array.from(selectedModNames);
    }

    const applyButton = document.querySelector('#batchTaggingModal button[onclick="applyBatchTags()"]');

    // Calculate Diff
    // Tag matches 'all' -> Add to 'tags_to_add'.
    // Tag matches 'none' -> Add to 'tags_to_remove'.
    // Tag matches 'mixed' -> Do nothing.

    // Use selectedTagsSequence for 'all' tags to respect user order?
    // The backend `batch-save-tags` likely just does a set union. 
    // If we want to ENFORCE order, we need the backend to replace tags with this ordered list?
    // Re-reading user request: "Edit tag page, the tag clicked first is added to the front"
    // "编辑标签页面，先点击的标签添加在前面"
    // This probably refers to the VISUAL order in the editor, which we fixed with `selectedTagsSequence`.
    // Does the user also want the tags on the mod card to follow this order? 
    // Likely yes. 
    // To support ordered tags on mods, `tags_to_add` isn't enough if we merge. 
    // But currently the system uses Set-like behavior. 
    // I will send `tags_to_add` as the sequence for now. The backend might just append. 
    // If the user wants to REORDER existing tags, that requires a full replace.
    // Given "batch tagging" nature (adding/removing), preserving existing other tags is key.
    // I will assume existing behavior for save is fine, as long as editor behavior is correct.

    const tagsToAdd = [];
    const tagsToRemove = [];

    // Add 'all' tags in sequence order
    selectedTagsSequence.forEach(tag => {
        if (currentTagStates.get(tag) === 'all') {
            tagsToAdd.push(tag);
        }
    });
    // Add any 'all' tags that might have missed sequence (safety)
    currentTagStates.forEach((state, tag) => {
        if (state === 'all' && !selectedTagsSequence.includes(tag)) {
            tagsToAdd.push(tag);
        }
    });

    currentTagStates.forEach((state, tag) => {
        if (state === 'none') {
            tagsToRemove.push(tag);
        }
    });

    callIPC('batch-save-tags', { selected_mods: currentTargetMods, tags_to_add: tagsToAdd, tags_to_remove: tagsToRemove }, async (result) => {
        if (result.success) {
            // Capture for undo
            const capturedMods = [...currentTargetMods];
            const capturedAdded = [...tagsToAdd];
            const capturedRemoved = [...tagsToRemove];

            showToast('toast.tags.save.success', 'success');
            closeModal('batchTaggingModal');
            await loadAndRenderModList();
            clearAllSelections();
            refreshTagFilters();

            // --- UNDO: reverse the tag additions and removals ---
            if (window.undoManager && (capturedAdded.length > 0 || capturedRemoved.length > 0)) {
                window.undoManager.push({
                    description: t('undo.tags.update', { count: capturedMods.length }),
                    undo: async () => {
                        await new Promise((resolve) => {
                            callIPC('batch-save-tags', {
                                selected_mods: capturedMods,
                                tags_to_add: capturedRemoved,   // swap
                                tags_to_remove: capturedAdded   // swap
                            }, async () => {
                                await loadAndRenderModList();
                                refreshTagFilters();
                                resolve();
                            }, null, true);
                        });
                    }
                });
            }
        } else {
            showToast(result.message || t('toast.tags.save.fail'), 'error');
        }
    }, applyButton);
}

// Helper to patch DOM elements instead of replacing them
function patchElement(el, newHTML) {
    // Optimization: Use Range.createContextualFragment for faster parsing
    // and avoid creating unnecessary wrapper divs if possible
    const range = document.createRange();
    // Use the element's parent as context to ensure correct parsing (e.g. td in tr)
    // For our mod-items, they are divs, so body or the list container is fine.
    // We use 'el' itself as context contextually or just document.body
    range.selectNode(document.body);
    const fragment = range.createContextualFragment(newHTML);
    const newEl = fragment.firstElementChild;

    if (!newEl) return;

    // 1. Update Attributes
    // Remove old attributes that are not in newEl
    const newAttrs = new Set(Array.from(newEl.attributes).map(a => a.name));
    Array.from(el.attributes).forEach(attr => {
        if (!newAttrs.has(attr.name)) {
            el.removeAttribute(attr.name);
        }
    });
    // Set new attributes
    Array.from(newEl.attributes).forEach(attr => {
        if (el.getAttribute(attr.name) !== attr.value) {
            el.setAttribute(attr.name, attr.value);
        }
    });

    // 2. Simple Content Patching
    // Strategy: Update strictly the parts that carry state and might flicker (buttons, icons).

    // Check if it's a mod-item
    if (el.classList.contains('mod-item')) {
        // Patch Status Column specifically to preserve transitions if possible
        const oldStatus = el.querySelector('.mod-status-column');
        const newStatus = newEl.querySelector('.mod-status-column');

        if (oldStatus && newStatus) {
            // Check if content is actually different to avoid unnecessary reflows
            if (oldStatus.innerHTML !== newStatus.innerHTML) {
                // Deeper diffing for the button to preserve its element reference if possible
                // preventing click event interruption or hover state loss
                const oldBtn = oldStatus.querySelector('.mod-status');
                const newBtn = newStatus.querySelector('.mod-status');

                if (oldBtn && newBtn) {
                    // Safety Check: If the button is currently processing (loading), DO NOT PATCH IT.
                    // This prevents the global refresh (which might yield stale data) from overwriting our optimistic state.
                    if (oldBtn.classList.contains('processing')) {
                        return;
                    }

                    // Update Button Attributes (onclick, etc)
                    Array.from(newBtn.attributes).forEach(attr => {
                        if (oldBtn.getAttribute(attr.name) !== attr.value) {
                            oldBtn.setAttribute(attr.name, attr.value);
                        }
                    });
                    // Update Classes
                    if (oldBtn.className !== newBtn.className) oldBtn.className = newBtn.className;

                    // Update Icon
                    const oldIcon = oldBtn.querySelector('i');
                    const newIcon = newBtn.querySelector('i');
                    if (oldIcon && newIcon && oldIcon.className !== newIcon.className) {
                        oldIcon.className = newIcon.className;
                    }

                    // Update Text
                    const oldText = oldBtn.querySelector('.status-text');
                    const newText = newBtn.querySelector('.status-text');
                    if (oldText && newText && oldText.textContent !== newText.textContent) {
                        oldText.textContent = newText.textContent;
                    }

                    if (!oldIcon || !newIcon || !oldText || !newText) {
                        // Fallback structure mismatch
                        oldStatus.innerHTML = newStatus.innerHTML;
                    }
                } else {
                    oldStatus.innerHTML = newStatus.innerHTML;
                }
            }
        }

        // Patch Name/Tags/Submods
        const oldNameCol = el.querySelector('.mod-name-column');
        const newNameCol = newEl.querySelector('.mod-name-column');
        if (oldNameCol && newNameCol && oldNameCol.innerHTML !== newNameCol.innerHTML) {
            oldNameCol.innerHTML = newNameCol.innerHTML;
        }

        const oldTagsCol = el.querySelector('.mod-tags-column');
        const newTagsCol = newEl.querySelector('.mod-tags-column');
        if (oldTagsCol && newTagsCol && oldTagsCol.innerHTML !== newTagsCol.innerHTML) {
            oldTagsCol.innerHTML = newTagsCol.innerHTML;
        }

        // Update Submod List
        const oldSubList = el.querySelector('.sub-mods-list');
        const newSubList = newEl.querySelector('.sub-mods-list');

        let subListDisplay = oldSubList ? oldSubList.style.display : null;

        if (oldSubList && newSubList) {
            if (oldSubList.outerHTML !== newSubList.outerHTML) {
                oldSubList.innerHTML = newSubList.innerHTML;
                Array.from(newSubList.attributes).forEach(attr => {
                    if (attr.name !== 'style') {
                        oldSubList.setAttribute(attr.name, attr.value);
                    }
                });
            }
        } else if (!oldSubList && newSubList) {
            el.appendChild(newSubList.cloneNode(true));
        } else if (oldSubList && !newSubList) {
            oldSubList.remove();
        }

        if (oldSubList && subListDisplay) {
            oldSubList.style.display = subListDisplay;
        }

    } else if (el.classList.contains('component-wrapper')) {
        // Group Component Patching
        const oldHeader = el.querySelector('.component-header');
        const newHeader = newEl.querySelector('.component-header');
        if (oldHeader && newHeader && oldHeader.innerHTML !== newHeader.innerHTML) {
            oldHeader.innerHTML = newHeader.innerHTML;
        }

        // Simplistic diff for items in group: if counts match, try to patch, else replace all
        // This avoids complex key matching logic for now, assuming order is stable
        const oldItems = Array.from(el.querySelectorAll('.mod-item'));
        const newItems = Array.from(newEl.querySelectorAll('.mod-item'));

        if (oldItems.length === newItems.length) {
            for (let i = 0; i < oldItems.length; i++) {
                if (oldItems[i].dataset.modName === newItems[i].dataset.modName) {
                    patchElement(oldItems[i], newItems[i].outerHTML);
                } else {
                    el.innerHTML = newEl.innerHTML; // Fallback
                    return;
                }
            }
        } else {
            el.innerHTML = newEl.innerHTML;
        }

    } else {
        // Fallback for other elements
        if (el.innerHTML !== newEl.innerHTML) {
            el.innerHTML = newEl.innerHTML;
        }
    }
}

// 导出函数

window.confirmToggleGroupConflict = confirmToggleGroupConflict;
window.toggleModActivation = toggleModActivation;
window.toggleSubModStatus = toggleSubModStatus;
window.toggleSubMods = toggleSubMods;
window.filterModsByTag = filterModsByTag;
window.filterModsByActivation = filterModsByActivation;
window.clearSearch = clearSearch;
window.deleteMod = deleteMod;
window.openBatchTaggingModal = openBatchTaggingModal;


