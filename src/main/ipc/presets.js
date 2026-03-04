const crypto = require('crypto');

function registerPresetHandlers({ ipcMain, fs, path, presetsDir, getActiveGameId }) {
    ipcMain.handle('get-presets', async () => {
        try {
            const gamePresetDir = path.join(presetsDir, getActiveGameId());
            await fs.ensureDir(gamePresetDir);

            const files = await fs.readdir(gamePresetDir);
            const presets = [];
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const presetData = await fs.readJson(path.join(gamePresetDir, file));
                    presets.push(presetData);
                } catch (error) {
                    // Ignore single-file parse errors
                }
            }

            return presets.sort((a, b) => b.created_at - a.created_at);
        } catch (error) {
            console.error('Failed to get presets:', error);
            return [];
        }
    });

    ipcMain.handle('save-preset', async (event, { name, color, activeMods, activeSubMods }) => {
        try {
            if (!name) return { success: false, message: 'Preset name cannot be empty.' };

            const gamePresetDir = path.join(presetsDir, getActiveGameId());
            await fs.ensureDir(gamePresetDir);

            const id = crypto.randomUUID();
            const now = Date.now();
            const presetPath = path.join(gamePresetDir, `${id}.json`);

            const presetData = {
                id,
                name,
                color: color || '#7aa2f7',
                mods: activeMods || [],
                sub_mods: activeSubMods || [],
                created_at: now,
            };

            await fs.writeJson(presetPath, presetData, { spaces: 2 });
            return { success: true };
        } catch (error) {
            console.error('Failed to save preset:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('update-preset', async (event, { id, name, color }) => {
        try {
            if (!name) return { success: false, message: 'Preset name cannot be empty.' };

            const gamePresetDir = path.join(presetsDir, getActiveGameId());
            const presetPath = path.join(gamePresetDir, `${id}.json`);

            if (!(await fs.pathExists(presetPath))) {
                return { success: false, message: 'Preset file not found.' };
            }

            const presetData = await fs.readJson(presetPath);
            presetData.name = name;
            presetData.color = color;
            await fs.writeJson(presetPath, presetData, { spaces: 2 });
            return { success: true };
        } catch (error) {
            console.error('Failed to update preset:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('delete-preset', async (event, id) => {
        try {
            const gamePresetDir = path.join(presetsDir, getActiveGameId());
            const presetPath = path.join(gamePresetDir, `${id}.json`);

            if (await fs.pathExists(presetPath)) {
                await fs.remove(presetPath);
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to delete preset:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-preset-by-id', async (event, id) => {
        try {
            const gamePresetDir = path.join(presetsDir, getActiveGameId());
            const presetPath = path.join(gamePresetDir, `${id}.json`);

            if (await fs.pathExists(presetPath)) {
                return await fs.readJson(presetPath);
            }
            return null;
        } catch (error) {
            console.error('Failed to get preset by id:', error);
            return null;
        }
    });
}

module.exports = {
    registerPresetHandlers,
};
