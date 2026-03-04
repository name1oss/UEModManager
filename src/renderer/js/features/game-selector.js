const { ipcRenderer } = require('electron');

// Global State
let allGames = [];
let editingGameId = null;
let currentLayout = localStorage.getItem('gameSelectorLayout') || 'grid';
let currentScale = localStorage.getItem('gameSelectorScale') || 100;

// Window Controls
document.getElementById('min-btn').addEventListener('click', () => {
    ipcRenderer.invoke('window-minimize');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.invoke('window-close');
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (typeof applyI18n === 'function') applyI18n();
    initLayout();
    initScale();
    loadGames();
});

function sanitizeGameId(rawId) {
    return String(rawId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function createGameIdFromName(name) {
    const fromName = sanitizeGameId(String(name || '').replace(/\s+/g, ''));
    return fromName || `Game${Date.now()}`;
}

function isLocalPath(p) {
    if (!p) return false;
    return /^[a-zA-Z]:\\/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function showModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('show');
}

function hideModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

async function persistCoverIfNeeded(gameName, imagePath) {
    let nextPath = String(imagePath || '').trim();
    if (!nextPath || !isLocalPath(nextPath) || nextPath.includes('game_cover')) {
        return nextPath;
    }

    const coverResult = await ipcRenderer.invoke('save-game-cover', { gameName, sourcePath: nextPath });
    if (!coverResult.success) {
        throw new Error(coverResult.message || 'Unknown cover save error');
    }
    return coverResult.path;
}

function initScale() {
    const slider = document.getElementById('card-scale-slider');
    if (slider) {
        slider.value = currentScale;
        document.documentElement.style.setProperty('--card-scale', currentScale / 100);

        slider.addEventListener('input', (e) => {
            currentScale = e.target.value;
            document.documentElement.style.setProperty('--card-scale', currentScale / 100);
            localStorage.setItem('gameSelectorScale', currentScale);
        });
    }
}

function initLayout() {
    // Apply initial layout without animation
    const grid = document.getElementById('games-grid');
    const btnGrid = document.getElementById('btn-layout-grid');
    const btnList = document.getElementById('btn-layout-list');

    if (currentLayout === 'list') {
        grid.classList.add('layout-list');
        btnGrid.classList.remove('active');
        btnList.classList.add('active');
    } else {
        grid.classList.remove('layout-list');
        btnList.classList.remove('active');
        btnGrid.classList.add('active');
    }
}

window.switchLayout = function (mode) {
    if (currentLayout === mode) return;

    const grid = document.getElementById('games-grid');
    const btnGrid = document.getElementById('btn-layout-grid');
    const btnList = document.getElementById('btn-layout-list');

    // 1. Fade Out
    grid.classList.add('fade-out');

    // 2. Wait for transition, then Switch
    setTimeout(() => {
        currentLayout = mode;
        localStorage.setItem('gameSelectorLayout', mode);

        // Disable transitions momentarily to snap to new size
        grid.classList.add('no-transition');

        if (mode === 'list') {
            grid.classList.add('layout-list');
            btnGrid.classList.remove('active');
            btnList.classList.add('active');
        } else {
            grid.classList.remove('layout-list');
            btnList.classList.remove('active');
            btnGrid.classList.add('active');
        }

        // Force Reflow
        void grid.offsetHeight;

        grid.classList.remove('no-transition');

        // 3. Fade In (small delay for DOM reflow)
        requestAnimationFrame(() => {
            grid.classList.remove('fade-out');
        });

    }, 200); // Matches CSS transition time
};

async function loadGames() {
    try {
        allGames = await ipcRenderer.invoke('get-games-list');
        renderGames(allGames);
    } catch (err) {
        console.error('Failed to load games:', err);
    }
}

function renderGames(games) {
    const grid = document.getElementById('games-grid');
    grid.innerHTML = '';

    games.forEach((game, index) => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.onclick = () => selectGame(game.id);

        // Staggered animation delay
        card.style.animationDelay = `${index * 100}ms`;

        // Context Menu for Edit
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openEditModal(game);
        });

        // Image Handling
        let imageDivClass = 'game-card-image';
        let imageHtml = '';
        if (game.cover_image && game.cover_image.trim() !== '') {
            imageHtml = `
                <img src="${game.cover_image}" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.add('placeholder');" 
                     alt="${game.name}">
                <div class="placeholder-icon" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; align-items:center; justify-content:center;">
                    <i class="fas fa-gamepad" style="font-size:3.5rem; color:rgba(255,255,255,0.05);"></i>
                </div>`;
        } else {
            imageDivClass += ' placeholder';
            imageHtml = `
                <i class="fas fa-gamepad"></i>`;
        }

        // Add standard overlay for interaction
        imageHtml += `
            <div class="game-card-overlay">
                <div class="play-btn-visual">
                    <i class="fas fa-play"></i>
                </div>
            </div>
        `;

        card.innerHTML = `
            <div class="${imageDivClass}">
                ${imageHtml}
            </div>
            <div class="game-card-content">
                <div class="game-title">${game.name}</div>
                <div class="game-desc">${game.description || t('game_selector.no_description')}</div>
            </div>
        `;

        // 3D Parallax Tilt Effect setup
        card.addEventListener('mousemove', (e) => {
            if (currentLayout === 'list') return; // Disable effect in list mode

            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left; // x position within the element
            const y = e.clientY - rect.top; // y position within the element

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Maximum rotation in degrees
            const maxTilt = 8;

            const rotateX = ((y - centerY) / centerY) * -maxTilt;
            const rotateY = ((x - centerX) / centerX) * maxTilt;

            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
        });

        card.addEventListener('mouseleave', () => {
            if (currentLayout === 'list') return;
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });

        grid.appendChild(card);
    });
}

// Game Selection
function selectGame(gameId) {
    if (!gameId) return;
    console.log('Selecting game:', gameId);
    ipcRenderer.invoke('select-game', gameId).catch(err => {
        console.error('Failed to select game:', err);
    });
}

// Edit Modal Logic
function openEditModal(game) {
    editingGameId = game.id;
    document.getElementById('editGameName').value = game.name;
    document.getElementById('editGameDesc').value = game.description || t('game_selector.no_description');
    document.getElementById('editGameImagePath').value = game.cover_image || '';

    const previewContainer = document.getElementById('editGameImagePreview');
    if (game.cover_image) {
        previewContainer.innerHTML = `<img src="${game.cover_image}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
        previewContainer.innerHTML = `<span style="color:rgba(255,255,255,0.3);">${t('game_selector.edit.cover_select')}</span>`;
    }

    showModalById('editGameModal');
}

function closeEditModal() {
    hideModalById('editGameModal');
    setTimeout(() => {
        editingGameId = null;
    }, 300);
}

function openAddModal() {
    const nameInput = document.getElementById('addGameName');
    const descInput = document.getElementById('addGameDesc');
    const idInput = document.getElementById('addGameId');
    const exeInput = document.getElementById('addGameExecutable');
    const imagePathInput = document.getElementById('addGameImagePath');
    const previewContainer = document.getElementById('addGameImagePreview');

    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (idInput) idInput.value = '';
    if (exeInput) exeInput.value = '';
    if (imagePathInput) imagePathInput.value = '';
    if (previewContainer) {
        previewContainer.innerHTML = `<span style="color:rgba(255,255,255,0.3); font-weight: 500;">${t('game_selector.add.cover_select')}</span>`;
    }

    showModalById('addGameModal');
}

function closeAddModal() {
    hideModalById('addGameModal');
}

async function triggerImageSelect(targetInputId = 'editGameImagePath', targetPreviewId = 'editGameImagePreview') {
    const result = await ipcRenderer.invoke('select-image-file');
    if (result.success) {
        const path = result.path;
        const input = document.getElementById(targetInputId);
        if (input) input.value = path;

        const previewContainer = document.getElementById(targetPreviewId);
        if (previewContainer) {
            previewContainer.innerHTML = `<img src="${path}" style="width:100%; height:100%; object-fit:cover;">`;
        }
    }
}

async function saveGameDetails() {
    if (!editingGameId) return;

    const name = document.getElementById('editGameName').value.trim();
    const desc = document.getElementById('editGameDesc').value.trim();
    let imagePath = document.getElementById('editGameImagePath').value.trim();

    if (!name) {
        alert(t('game_selector.alert.name_required'));
        return;
    }

    try {
        imagePath = await persistCoverIfNeeded(name, imagePath);
    } catch (e) {
        console.error('Error processing cover image:', e);
        if (!confirm(t('game_selector.confirm.cover_failed', { error: e.message || 'Unknown error' }))) {
            return;
        }
    }

    const result = await ipcRenderer.invoke('update-game-details', {
        id: editingGameId,
        name: name,
        description: desc,
        cover_image: imagePath
    });

    if (result.success) {
        closeEditModal();
        loadGames(); // Reload list
    } else {
        alert(t('game_selector.alert.save_failed', { message: result.message }));
    }
}

async function saveNewGame() {
    const name = document.getElementById('addGameName').value.trim();
    const desc = document.getElementById('addGameDesc').value.trim();
    const inputGameId = document.getElementById('addGameId').value.trim();
    const executableRaw = document.getElementById('addGameExecutable').value.trim();
    let imagePath = document.getElementById('addGameImagePath').value.trim();

    if (!name) {
        alert(t('game_selector.alert.name_required'));
        return;
    }

    const gameId = inputGameId ? sanitizeGameId(inputGameId) : createGameIdFromName(name);
    if (!gameId) {
        alert(t('game_selector.alert.invalid_id'));
        return;
    }

    const executable = executableRaw || `${gameId}.exe`;

    try {
        imagePath = await persistCoverIfNeeded(name, imagePath);
    } catch (e) {
        console.error('Error processing add-game cover image:', e);
        if (!confirm(t('game_selector.confirm.cover_failed', { error: e.message || 'Unknown error' }))) {
            return;
        }
    }

    const result = await ipcRenderer.invoke('add-game', {
        id: gameId,
        name,
        description: desc,
        executable,
        cover_image: imagePath
    });

    if (!result || !result.success) {
        alert(t('game_selector.alert.add_failed', { message: result?.message || 'Unknown error' }));
        return;
    }

    closeAddModal();
    await loadGames();
}

window.openAddModal = openAddModal;
window.closeAddModal = closeAddModal;
window.triggerImageSelect = triggerImageSelect;
window.saveNewGame = saveNewGame;
