"use strict";

let currentSelectedPresetId = null;

function currentLocale() {
    return typeof getCurrentLang === 'function' ? getCurrentLang() : 'zh-CN';
}

async function openPresetsModal() {
    const modal = document.getElementById('presetsModal');
    if (!modal) return;

    modal.style.display = 'flex';
    resetPresetRightPanel();
    await loadPresets();
}

function resetPresetRightPanel() {
    document.querySelectorAll('.preset-detail-view').forEach(el => { el.style.display = 'none'; });
    document.getElementById('presetEmptyState').style.display = 'flex';
    currentSelectedPresetId = null;
    document.querySelectorAll('.preset-card-item').forEach(el => { el.classList.remove('active'); });
}

async function loadPresets() {
    const container = document.getElementById('presetsListContainer');
    if (!container) return;

    container.innerHTML = '<div class="simple-spinner" style="margin: 2rem auto;"></div>';

    await callIPC('get-presets', {}, (presets) => {
        container.innerHTML = '';

        if (!presets || presets.length === 0) {
            container.innerHTML = `<p class="placeholder-text-center">${t('preset.list.empty')}</p>`;
            return;
        }

        presets.forEach((preset, index) => {
            const card = document.createElement('div');
            card.className = 'preset-card-item';
            card.dataset.id = preset.id;
            card.style.borderLeftColor = preset.color || 'var(--accent-blue)';
            card.style.animationDelay = `${index * 0.05}s`;

            const itemCount = (preset.mods?.length || 0) + (preset.sub_mods?.length || 0);
            const date = new Date(preset.created_at).toLocaleDateString(currentLocale());

            card.innerHTML = `
                <div class="preset-card-info">
                    <div class="preset-card-title" style="color: ${preset.color || 'var(--text-primary)'}">${preset.name}</div>
                    <div class="preset-card-meta">${date} · ${itemCount} ${t('preset.items')}</div>
                </div>
                <div class="preset-card-actions">
                    <i class="fas fa-chevron-right" style="color: var(--text-disabled); font-size: 0.8em;"></i>
                </div>
            `;

            card.onclick = () => selectPreset(card, preset);
            container.appendChild(card);
        });

        if (currentSelectedPresetId) {
            const selected = container.querySelector(`.preset-card-item[data-id="${currentSelectedPresetId}"]`);
            if (selected) selected.click();
        }
    }, null, true);
}

function selectPreset(cardElement, preset) {
    document.querySelectorAll('.preset-card-item').forEach(el => { el.classList.remove('active'); });
    cardElement.classList.add('active');
    currentSelectedPresetId = preset.id;

    document.querySelectorAll('.preset-detail-view').forEach(el => { el.style.display = 'none'; });
    const detailView = document.getElementById('presetDetailView');
    detailView.style.display = 'flex';
    detailView.style.animation = 'none';
    detailView.offsetHeight;
    detailView.style.animation = 'fadeIn 0.3s ease';

    document.getElementById('detailPresetName').textContent = preset.name;
    document.getElementById('detailPresetName').style.color = preset.color || 'var(--text-primary)';

    const date = new Date(preset.created_at).toLocaleString(currentLocale(), { hour12: false });
    document.getElementById('detailPresetDate').textContent = t('preset.last_updated', { date });

    const modCount = preset.mods?.length || 0;
    const subCount = preset.sub_mods?.length || 0;
    document.getElementById('detailPresetCount').textContent = t('preset.detail.count', { mods: modCount, subs: subCount });

    renderPresetDetailList(preset);
}

function renderPresetDetailList(preset) {
    const listContainer = document.getElementById('detailModList');
    listContainer.innerHTML = '';

    const currentModMap = new Map();
    if (globalModDetails) globalModDetails.forEach(m => currentModMap.set(m.name, m));

    const grouped = new Map();

    if (preset.mods) {
        preset.mods.forEach(modName => {
            if (!grouped.has(modName)) grouped.set(modName, { includeParent: true, subMods: [] });
            else grouped.get(modName).includeParent = true;
        });
    }

    if (preset.sub_mods) {
        preset.sub_mods.forEach(entry => {
            let parentName;
            let subName;
            if (typeof entry === 'string') {
                [parentName, subName] = entry.split(':');
            } else {
                parentName = entry.parent;
                subName = entry.sub;
            }
            if (!grouped.has(parentName)) grouped.set(parentName, { includeParent: false, subMods: [] });
            grouped.get(parentName).subMods.push(subName);
        });
    }

    let index = 0;

    grouped.forEach((itemData, parentName) => {
        const currentMod = currentModMap.get(parentName);

        if (itemData.includeParent) {
            const isInstalled = !!currentMod;
            const isActive = !!currentMod?.is_active;
            const tags = currentMod?.tags || [];
            const tagsHTML = tags.slice(0, 3).map(tag => `<span class="mini-tag">${tag}</span>`).join('');

            const row = document.createElement('div');
            row.className = 'detail-mod-item';
            if (!isInstalled) row.classList.add('missing');
            row.style.animationDelay = `${index * 0.03}s`;
            index += 1;

            let statusIcon;
            if (!isInstalled) {
                statusIcon = `<i class="fas fa-exclamation-triangle" title="${t('preset.status.mod_missing')}"></i>`;
            } else if (isActive) {
                statusIcon = `<i class="fas fa-check-circle active" title="${t('preset.status.active')}"></i>`;
            } else {
                statusIcon = `<i class="fas fa-circle inactive" title="${t('preset.status.inactive')}"></i>`;
            }

            row.innerHTML = `
                <div class="detail-mod-icon"><i class="fas fa-cube"></i></div>
                <div class="detail-mod-info">
                    <span class="detail-mod-name ${!isInstalled ? 'text-missing' : ''}">${parentName}</span>
                    <div class="detail-mod-tags">${tagsHTML}</div>
                </div>
                <div class="detail-mod-status">${statusIcon}</div>
            `;
            listContainer.appendChild(row);
        }

        if (itemData.subMods.length > 0) {
            itemData.subMods.forEach(subName => {
                const currentSub = currentMod?.sub_mods?.find(s => s.name === subName);
                const isInstalled = !!currentSub;
                const isActive = !!currentSub?.is_active;

                const row = document.createElement('div');
                row.className = 'detail-mod-item is-sub';
                if (itemData.includeParent) {
                    row.style.marginLeft = '2rem';
                    row.style.width = 'calc(100% - 2rem)';
                }
                if (!isInstalled) row.classList.add('missing');
                row.style.animationDelay = `${index * 0.03}s`;
                index += 1;

                let statusIcon;
                if (!isInstalled) {
                    statusIcon = `<i class="fas fa-exclamation-triangle" title="${t('preset.status.submod_missing')}"></i>`;
                } else if (isActive) {
                    statusIcon = `<i class="fas fa-check-circle active" title="${t('preset.status.active')}"></i>`;
                } else {
                    statusIcon = `<i class="fas fa-circle inactive" title="${t('preset.status.inactive')}"></i>`;
                }

                row.innerHTML = `
                    <div class="detail-mod-icon"><i class="fas fa-code-branch"></i></div>
                    <div class="detail-mod-info">
                        <span class="detail-mod-name ${!isInstalled ? 'text-missing' : ''}">${subName}</span>
                        <span class="detail-mod-parent">${t('preset.belongs_to', { parent: parentName })}</span>
                    </div>
                    <div class="detail-mod-status">${statusIcon}</div>
                `;
                listContainer.appendChild(row);
            });
        }
    });

    if (listContainer.children.length === 0) {
        listContainer.innerHTML = `<div class="placeholder-text-center">${t('preset.detail.empty')}</div>`;
    }
}

function openSavePresetUI() {
    document.querySelectorAll('.preset-detail-view').forEach(el => { el.style.display = 'none'; });
    document.getElementById('savePresetUI').style.display = 'flex';
    document.getElementById('newPresetName').value = '';
    document.getElementById('newPresetName').focus();

    let countMods = 0;
    let countSubs = 0;
    if (globalModDetails) {
        globalModDetails.forEach(mod => {
            if (mod.is_active) countMods += 1;
            (mod.sub_mods || []).forEach(sub => {
                if (sub.is_active) countSubs += 1;
            });
        });
    }

    document.getElementById('newPresetModCount').textContent = countMods;
    document.getElementById('newPresetSubCount').textContent = countSubs;
    setupColorPickerPreview('newPresetColor', null);
}

function setupColorPickerPreview(inputId, valueDisplayId) {
    const input = document.getElementById(inputId);
    const display = valueDisplayId ? document.getElementById(valueDisplayId) : input.nextElementSibling;
    if (display) display.textContent = input.value;
    input.oninput = (e) => {
        if (display) display.textContent = e.target.value;
    };
}

function cancelPresetAction() {
    if (currentSelectedPresetId) {
        document.querySelectorAll('.preset-detail-view').forEach(el => { el.style.display = 'none'; });
        document.getElementById('presetDetailView').style.display = 'flex';
    } else {
        resetPresetRightPanel();
    }
}

async function savePreset() {
    const name = document.getElementById('newPresetName').value.trim();
    const color = document.getElementById('newPresetColor').value;

    if (!name) {
        showToast('preset.toast.name_required', 'warning');
        return;
    }

    if (!globalModDetails || globalModDetails.length === 0) {
        showToast('preset.toast.state_unavailable', 'error');
        return;
    }

    const activeMods = [];
    const activeSubMods = [];
    globalModDetails.forEach(mod => {
        if (!mod.is_active) return;
        activeMods.push(mod.name);
        (mod.sub_mods || []).forEach(sub => {
            if (sub.is_active) activeSubMods.push(`${mod.name}:${sub.name}`);
        });
    });

    await callIPC('save-preset', { name, color, activeMods, activeSubMods }, (result) => {
        if (result.success) {
            showToast('toast.preset.save.success', 'success');
            loadPresets();
            resetPresetRightPanel();
        } else {
            showToast(result.message || t('preset.toast.save_failed'), 'error');
        }
    });
}

function switchToEditPreset() {
    if (!currentSelectedPresetId) return;

    callIPC('get-preset-by-id', currentSelectedPresetId, (preset) => {
        if (!preset) return;

        document.querySelectorAll('.preset-detail-view').forEach(el => { el.style.display = 'none'; });
        document.getElementById('editPresetUI').style.display = 'flex';
        document.getElementById('editPresetId').value = preset.id;
        document.getElementById('editPresetName').value = preset.name;
        document.getElementById('editPresetColor').value = preset.color || '#7aa2f7';
        setupColorPickerPreview('editPresetColor', 'editPresetColorValue');
    }, null, true);
}

async function updatePreset() {
    const id = document.getElementById('editPresetId').value;
    const name = document.getElementById('editPresetName').value.trim();
    const color = document.getElementById('editPresetColor').value;

    if (!name) {
        showToast('preset.toast.name_empty', 'warning');
        return;
    }

    await callIPC('update-preset', { id, name, color }, (result) => {
        if (result.success) {
            showToast('preset.toast.updated', 'success');
            loadPresets().then(() => {
                const current = document.querySelector(`.preset-card-item[data-id="${currentSelectedPresetId}"]`);
                if (current) current.click();
            });
        } else {
            showToast(result.message || t('preset.toast.update_failed'), 'error');
        }
    });
}

async function deleteCurrentPreset() {
    if (!currentSelectedPresetId) return;

    if (await showConfirm('preset.confirm.delete.title', 'preset.confirm.delete.msg')) {
        await callIPC('delete-preset', currentSelectedPresetId, () => {
            showToast('toast.preset.delete.success', 'success');
            currentSelectedPresetId = null;
            resetPresetRightPanel();
            loadPresets();
        });
    }
}

async function applyCurrentPreset() {
    if (!currentSelectedPresetId) return;

    await callIPC('get-preset-by-id', currentSelectedPresetId, async (preset) => {
        if (!preset) {
            showToast('preset.toast.read_failed', 'error');
            return;
        }

        if (!await showConfirm('preset.confirm.apply.title', 'preset.confirm.apply.msg', { name: preset.name })) {
            return;
        }

        showLoadingOverlay('preset.loading.apply');
        try {
            const targetMods = new Set(preset.mods);
            const targetSubMods = new Set((preset.sub_mods || []).map(s => {
                let parentStr;
                let subStr;
                if (typeof s === 'string') {
                    [parentStr, subStr] = s.split(':');
                } else {
                    parentStr = s.parent;
                    subStr = s.sub;
                }
                targetMods.add(parentStr);
                return `${parentStr}:${subStr}`;
            }));

            const diff = {
                enableMods: [],
                disableMods: [],
                enableSubMods: [],
                disableSubMods: [],
            };

            globalModDetails.forEach(mod => {
                const shouldBeActive = targetMods.has(mod.name);
                if (shouldBeActive && !mod.is_active) diff.enableMods.push(mod.name);
                else if (!shouldBeActive && mod.is_active) diff.disableMods.push(mod.name);

                (mod.sub_mods || []).forEach(sub => {
                    const key = `${mod.name}:${sub.name}`;
                    const shouldSubBeActive = targetSubMods.has(key);
                    if (shouldSubBeActive && !sub.is_active) diff.enableSubMods.push({ parent: mod.name, sub: sub.name });
                    else if (!shouldSubBeActive && sub.is_active) diff.disableSubMods.push({ parent: mod.name, sub: sub.name });
                });
            });

            await callIPC('batch-apply-preset', diff, null, null, true);
            showToast('toast.preset.apply.success', 'success');
            closeModal('presetsModal');
            await loadAndRenderModList();
        } catch (err) {
            console.error('Apply preset failed', err);
            showToast('preset.toast.apply_failed', 'error');
        } finally {
            hideLoadingOverlay();
        }
    }, null, true);
}

function setPresetColor(inputId, colorHex) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    inputEl.value = colorHex;
    inputEl.dispatchEvent(new Event('input'));
}

window.openPresetsModal = openPresetsModal;
window.openSavePresetUI = openSavePresetUI;
window.cancelPresetAction = cancelPresetAction;
window.savePreset = savePreset;
window.switchToEditPreset = switchToEditPreset;
window.updatePreset = updatePreset;
window.deleteCurrentPreset = deleteCurrentPreset;
window.applyCurrentPreset = applyCurrentPreset;
window.setPresetColor = setPresetColor;
