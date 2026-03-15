const { ipcRenderer } = require('electron');

const state = {
    games: [],
    editingGameId: null,
    layout: localStorage.getItem('gameSelectorLayout') || 'grid',
    scale: Number(localStorage.getItem('gameSelectorScale') || 100),
    draggingId: null,
    dragChanged: false,
    suppressClickUntil: 0,
    dropTargetId: null,
};

const dom = {};
let scaleRafId = 0;
let pendingScale = null;

document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    bindWindowControls();
    bindGlobalInteractions();
    initializeI18n();
    initializeLayout();
    initializeScale();
    loadGames();
    syncTheme();
});

function syncTheme() {
    ipcRenderer.invoke('get-all-settings').then(settings => {
        if (settings && settings.theme) {
            document.body.dataset.theme = settings.theme;
        }
    }).catch(err => console.error('Failed to load theme:', err));

    ipcRenderer.on('settings-updated', (event, settings) => {
        if (settings && settings.theme) {
            document.body.dataset.theme = settings.theme;
        }
    });
}

function cacheDom() {
    dom.grid = document.getElementById('games-grid');
    dom.layoutGridBtn = document.getElementById('btn-layout-grid');
    dom.layoutListBtn = document.getElementById('btn-layout-list');
    dom.scaleSlider = document.getElementById('card-scale-slider');
    dom.editModal = document.getElementById('editGameModal');
    dom.addModal = document.getElementById('addGameModal');
}

function tr(key, vars = {}) {
    if (typeof window.t === 'function') {
        return window.t(key, vars);
    }

    return String(key || '').replace(/\{(\w+)\}/g, (_, k) => (
        Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
    ));
}

function initializeI18n() {
    if (typeof window.applyI18n === 'function') {
        window.applyI18n();
    }
}

function bindWindowControls() {
    const minBtn = document.getElementById('min-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minBtn) {
        minBtn.addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => ipcRenderer.invoke('window-close'));
    }
}

function bindGlobalInteractions() {
    [dom.editModal, dom.addModal].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('mousedown', (event) => {
            if (event.target === modal) {
                if (modal.id === 'editGameModal') closeEditModal();
                if (modal.id === 'addGameModal') closeAddModal();
            }
        });
    });

    if (dom.grid) {
        dom.grid.addEventListener('dragover', handleGridDragOver);
        dom.grid.addEventListener('drop', handleGridDrop);
        dom.grid.addEventListener('dragleave', handleGridDragLeave);
    }
}

function initializeScale() {
    if (!dom.scaleSlider) return;

    if (!Number.isFinite(state.scale) || state.scale < 70 || state.scale > 160) {
        state.scale = 100;
    }

    dom.scaleSlider.value = String(state.scale);
    queueApplyScale(state.scale);

    dom.scaleSlider.addEventListener('input', (event) => {
        const next = Number(event.target.value);
        state.scale = Number.isFinite(next) ? next : 100;
        queueApplyScale(state.scale);
    });

    dom.scaleSlider.addEventListener('change', persistScaleSetting);
    dom.scaleSlider.addEventListener('pointerup', persistScaleSetting);
}

function queueApplyScale(scale) {
    pendingScale = Number.isFinite(scale) ? scale : 100;
    if (scaleRafId) return;

    scaleRafId = window.requestAnimationFrame(() => {
        applyScale(pendingScale);
        scaleRafId = 0;
    });
}

function persistScaleSetting() {
    localStorage.setItem('gameSelectorScale', String(state.scale));
}

function applyScale(scale) {
    const sizeScale = Math.max(0.7, Math.min(1.6, scale / 100));
    const gapScale = Math.max(0.7, Math.min(1.7, 0.8 + ((scale - 100) / 100)));
    document.documentElement.style.setProperty('--card-size-scale', sizeScale.toFixed(3));
    document.documentElement.style.setProperty('--card-gap-scale', gapScale.toFixed(3));
}

function initializeLayout() {
    applyLayout(state.layout, false);
}

function applyLayout(mode, animate = true) {
    if (!dom.grid) return;

    const useList = mode === 'list';
    const activeClass = 'active';

    if (animate) {
        dom.grid.classList.add('fade-out');
    }

    const apply = () => {
        dom.grid.classList.toggle('layout-list', useList);
        if (dom.layoutGridBtn) dom.layoutGridBtn.classList.toggle(activeClass, !useList);
        if (dom.layoutListBtn) dom.layoutListBtn.classList.toggle(activeClass, useList);
        dom.grid.classList.remove('fade-out');
    };

    if (animate) {
        window.setTimeout(apply, 180);
    } else {
        apply();
    }
}

function switchLayout(mode) {
    if (!mode || state.layout === mode) return;
    state.layout = mode;
    localStorage.setItem('gameSelectorLayout', mode);
    applyLayout(mode, true);
}

async function loadGames() {
    try {
        const games = await ipcRenderer.invoke('get-games-list');
        state.games = Array.isArray(games) ? games : [];
        renderGames();
    } catch (error) {
        console.error('Failed to load games:', error);
    }
}

function renderGames() {
    if (!dom.grid) return;
    dom.grid.innerHTML = '';

    if (!state.games.length) {
        dom.grid.appendChild(createEmptyState({
            message: tr('modlist.empty'),
            withAddAction: true,
        }));
        return;
    }

    state.games.forEach((game, index) => {
        dom.grid.appendChild(createGameCard(game, index));
    });
}

function createEmptyState({ message, withAddAction }) {
    const empty = document.createElement('div');
    empty.className = 'gs-empty';

    const icon = document.createElement('i');
    icon.className = 'fas fa-ghost';
    icon.style.fontSize = '3.5rem';
    icon.style.marginBottom = '1.2rem';
    icon.style.opacity = '0.3';
    icon.style.display = 'block';
    empty.appendChild(icon);

    const text = document.createElement('p');
    text.textContent = message || tr('modlist.empty');
    text.style.fontSize = '1.1rem';
    text.style.fontWeight = '500';
    empty.appendChild(text);

    if (withAddAction) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'neon-button primary';
        action.style.marginTop = '1.5rem';
        action.style.padding = '0.6rem 2rem';
        action.innerHTML = '<i class="fas fa-plus"></i> ' + tr('game_selector.add.button');
        action.addEventListener('click', () => openAddModal());
        empty.appendChild(action);
    }

    return empty;
}

function createGameCard(game, index) {
    const card = document.createElement('article');
    card.className = 'game-card';
    card.dataset.gameId = String(game.id || '');
    card.draggable = true;
    card.tabIndex = 0;
    card.style.animationDelay = `${index * 60}ms`;
    card.addEventListener('click', () => {
        if (Date.now() < state.suppressClickUntil || state.draggingId) return;
        selectGame(game.id);
    });
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectGame(game.id);
        }
    });
    card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openEditModal(game);
    });
    card.addEventListener('dragstart', handleCardDragStart);
    card.addEventListener('dragend', handleCardDragEnd);

    const imageWrap = document.createElement('div');
    imageWrap.className = 'game-card-image';

    if (game.cover_image && String(game.cover_image).trim()) {
        const img = document.createElement('img');
        img.src = game.cover_image;
        img.alt = game.name || game.id || 'Game Cover';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            imageWrap.classList.add('placeholder');
            imageWrap.innerHTML = '<i class="fas fa-gamepad" aria-hidden="true"></i>';
            imageWrap.appendChild(createCardOverlay());
        });
        imageWrap.appendChild(img);
    } else {
        imageWrap.classList.add('placeholder');
        imageWrap.innerHTML = '<i class="fas fa-gamepad" aria-hidden="true"></i>';
    }

    imageWrap.appendChild(createCardOverlay());

    const content = document.createElement('div');
    content.className = 'game-card-content';

    const title = document.createElement('div');
    title.className = 'game-title';
    title.textContent = game.name || game.id || 'Game';

    const desc = document.createElement('p');
    desc.className = 'game-desc';
    desc.textContent = (game.description && String(game.description).trim()) || tr('game_selector.no_description');

    content.appendChild(title);
    content.appendChild(desc);
    card.appendChild(imageWrap);
    card.appendChild(content);

    setupCardTilt(card);
    return card;
}

function handleCardDragStart(event) {
    const card = event.currentTarget;
    const gameId = card?.dataset?.gameId;
    if (!gameId) {
        event.preventDefault();
        return;
    }

    state.draggingId = gameId;
    state.dragChanged = false;
    state.dropTargetId = null;
    card.classList.add('gs-dragging');
    if (dom.grid) dom.grid.classList.add('gs-dragging');

    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', gameId);
    }
}

function handleCardDragEnd(event) {
    const card = event.currentTarget;
    if (card) card.classList.remove('gs-dragging');
    if (dom.grid) dom.grid.classList.remove('gs-dragging');
    clearDropTarget();

    const shouldPersist = state.dragChanged;
    state.draggingId = null;
    state.dragChanged = false;
    state.suppressClickUntil = Date.now() + 260;

    if (shouldPersist) {
        persistOrderFromDom().catch((error) => {
            console.error('Failed to persist game order:', error);
        });
    }
}

function handleGridDragOver(event) {
    if (!state.draggingId || !dom.grid) return;
    event.preventDefault();

    const target = event.target.closest('.game-card');
    const draggingCard = dom.grid.querySelector(`.game-card[data-game-id="${state.draggingId}"]`);

    if (!target || !draggingCard || target === draggingCard) {
        clearDropTarget();
        return;
    }

    const shouldBefore = shouldInsertBefore(target, event.clientX, event.clientY);
    const referenceNode = shouldBefore ? target : target.nextElementSibling;
    if (referenceNode !== draggingCard) {
        dom.grid.insertBefore(draggingCard, referenceNode);
        state.dragChanged = true;
    }

    setDropTarget(target);
}

function handleGridDrop(event) {
    if (!state.draggingId) return;
    event.preventDefault();
}

function handleGridDragLeave(event) {
    if (!state.draggingId || !dom.grid) return;
    if (!event.relatedTarget || !dom.grid.contains(event.relatedTarget)) {
        clearDropTarget();
    }
}

function shouldInsertBefore(target, cursorX, cursorY) {
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (state.layout === 'list') {
        return cursorY < centerY;
    }

    const deltaX = Math.abs(cursorX - centerX);
    const deltaY = Math.abs(cursorY - centerY);
    if (deltaY > deltaX * 1.1) {
        return cursorY < centerY;
    }
    return cursorX < centerX;
}

function setDropTarget(card) {
    const targetId = card?.dataset?.gameId || null;
    if (state.dropTargetId === targetId) return;
    clearDropTarget();
    if (!card || !targetId) return;
    card.classList.add('gs-drop-target');
    state.dropTargetId = targetId;
}

function clearDropTarget() {
    if (!dom.grid || !state.dropTargetId) return;
    const previous = dom.grid.querySelector(`.game-card[data-game-id="${state.dropTargetId}"]`);
    if (previous) previous.classList.remove('gs-drop-target');
    state.dropTargetId = null;
}

async function persistOrderFromDom() {
    if (!dom.grid) return;

    const orderedIds = Array.from(dom.grid.querySelectorAll('.game-card'))
        .map(card => String(card.dataset.gameId || '').trim())
        .filter(Boolean);

    if (!orderedIds.length) return;

    const gameMap = new Map(state.games.map(game => [String(game.id), game]));
    const reordered = orderedIds.map(id => gameMap.get(id)).filter(Boolean);
    if (reordered.length === state.games.length) {
        state.games = reordered;
    }

    const result = await ipcRenderer.invoke('save-games-order', { order: orderedIds });
    if (!result || !result.success) {
        console.error('Failed to save game order:', result?.message || 'Unknown error');
    }
}

function createCardOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'game-card-overlay';
    const btn = document.createElement('div');
    btn.className = 'play-btn-visual';
    btn.innerHTML = '<i class="fas fa-play"></i>';
    overlay.appendChild(btn);
    return overlay;
}

function setupCardTilt(card) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let rafId = 0;
    let nextTransform = '';

    card.addEventListener('mousemove', (event) => {
        if (state.layout === 'list') return;

        const rect = card.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateY = ((offsetX - centerX) / centerX) * 5;
        const rotateX = ((offsetY - centerY) / centerY) * -5;
        nextTransform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
        if (!rafId) {
            rafId = window.requestAnimationFrame(() => {
                card.style.transform = nextTransform;
                rafId = 0;
            });
        }
    });

    card.addEventListener('mouseleave', () => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        card.style.transform = '';
    });
}

function selectGame(gameId) {
    if (!gameId) return;
    ipcRenderer.invoke('select-game', gameId).catch(err => {
        console.error('Failed to select game:', err);
    });
}

function showModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    // Small delay to allow CSS transition
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
}

function hideModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show');
    window.setTimeout(() => {
        modal.style.display = 'none';
    }, 220);
}

function setPreview(previewId, imagePath, emptyText) {
    const preview = document.getElementById(previewId);
    if (!preview) return;

    if (imagePath && String(imagePath).trim()) {
        preview.innerHTML = `<img src="${imagePath}" alt="cover">`;
    } else {
        preview.textContent = emptyText;
    }
}

function openEditModal(game) {
    if (!game) return;

    state.editingGameId = game.id;
    setInputValue('editGameId', game.id || '');
    setInputValue('editGameName', game.name || '');
    setInputValue('editGameDesc', game.description || '');
    setInputValue('editGameExecutable', game.executable || '');
    setInputValue('editGameNexusUrl', game.nexusUrl || '');
    setInputValue('editGameImagePath', game.cover_image || '');
    setPreview('editGameImagePreview', game.cover_image || '', tr('game_selector.edit.cover_select'));
    showModalById('editGameModal');
}

function closeEditModal() {
    hideModalById('editGameModal');
    window.setTimeout(() => {
        state.editingGameId = null;
    }, 220);
}

function openAddModal() {
    setInputValue('addGameName', '');
    setInputValue('addGameDesc', '');
    setInputValue('addGameId', '');
    setInputValue('addGameExecutable', '');
    setInputValue('addGameNexusUrl', '');
    setInputValue('addGameImagePath', '');
    setPreview('addGameImagePreview', '', tr('game_selector.add.cover_select'));
    showModalById('addGameModal');
}

function closeAddModal() {
    hideModalById('addGameModal');
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = String(value || '');
}

function getInputValue(id) {
    const input = document.getElementById(id);
    return input ? String(input.value || '').trim() : '';
}

function sanitizeGameId(rawId) {
    return String(rawId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function createGameIdFromName(name) {
    const fromName = sanitizeGameId(String(name || '').replace(/\s+/g, ''));
    return fromName || `Game${Date.now()}`;
}

function isLocalPath(filePath) {
    if (!filePath) return false;
    return /^[a-zA-Z]:\\/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/');
}

async function persistCoverIfNeeded(gameName, imagePath) {
    let nextPath = String(imagePath || '').trim();
    if (!nextPath || !isLocalPath(nextPath) || nextPath.includes('game_cover')) {
        return nextPath;
    }

    const result = await ipcRenderer.invoke('save-game-cover', {
        gameName,
        sourcePath: nextPath,
    });

    if (!result || !result.success) {
        throw new Error(result?.message || 'Unknown cover save error');
    }

    return result.path;
}

async function triggerImageSelect(targetInputId = 'editGameImagePath', targetPreviewId = 'editGameImagePreview') {
    const result = await ipcRenderer.invoke('select-image-file');
    if (!result || !result.success) return;

    setInputValue(targetInputId, result.path || '');
    setPreview(targetPreviewId, result.path || '', tr('game_selector.edit.cover_select'));
}

async function saveGameDetails() {
    if (!state.editingGameId) return;

    const name = getInputValue('editGameName');
    const description = getInputValue('editGameDesc');
    const executable = getInputValue('editGameExecutable');
    const nexusUrl = getInputValue('editGameNexusUrl');
    let coverImage = getInputValue('editGameImagePath');

    if (!name) {
        window.alert(tr('game_selector.alert.name_required'));
        return;
    }

    try {
        coverImage = await persistCoverIfNeeded(name, coverImage);
    } catch (error) {
        const keepSaving = window.confirm(tr('game_selector.confirm.cover_failed', {
            error: error.message || 'Unknown error',
        }));
        if (!keepSaving) return;
    }

    const result = await ipcRenderer.invoke('update-game-details', {
        id: state.editingGameId,
        name,
        description,
        executable,
        nexusUrl,
        cover_image: coverImage,
    });

    if (!result || !result.success) {
        window.alert(tr('game_selector.alert.save_failed', { message: result?.message || 'Unknown error' }));
        return;
    }

    closeEditModal();
    await loadGames();
}

async function saveNewGame() {
    const name = getInputValue('addGameName');
    const description = getInputValue('addGameDesc');
    const inputGameId = getInputValue('addGameId');
    const executableRaw = getInputValue('addGameExecutable');
    const nexusUrl = getInputValue('addGameNexusUrl');
    let coverImage = getInputValue('addGameImagePath');

    if (!name) {
        window.alert(tr('game_selector.alert.name_required'));
        return;
    }

    const gameId = inputGameId ? sanitizeGameId(inputGameId) : createGameIdFromName(name);
    if (!gameId) {
        window.alert(tr('game_selector.alert.invalid_id'));
        return;
    }

    const executable = executableRaw || `${gameId}.exe`;

    try {
        coverImage = await persistCoverIfNeeded(name, coverImage);
    } catch (error) {
        const keepSaving = window.confirm(tr('game_selector.confirm.cover_failed', {
            error: error.message || 'Unknown error',
        }));
        if (!keepSaving) return;
    }

    const result = await ipcRenderer.invoke('add-game', {
        id: gameId,
        name,
        description,
        executable,
        nexusUrl,
        cover_image: coverImage,
    });

    if (!result || !result.success) {
        window.alert(tr('game_selector.alert.add_failed', { message: result?.message || 'Unknown error' }));
        return;
    }

    closeAddModal();
    await loadGames();
}

window.switchLayout = switchLayout;
window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;
window.triggerImageSelect = triggerImageSelect;
window.saveNewGame = saveNewGame;
window.closeEditModal = closeEditModal;
window.saveGameDetails = saveGameDetails;
