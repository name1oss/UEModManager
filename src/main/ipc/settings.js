function registerSettingsHandlers({
    ipcMain,
    BrowserWindow,
    getDb,
    getSettings,
    getSettingsIdForGame,
    ensureSettingsRow,
    getActiveGameId,
}) {
    ipcMain.handle('get-all-settings', () => {
        return getSettings();
    });

    ipcMain.handle('save-all-settings', (event, settings) => {
        try {
            const db = getDb();
            const id = getSettingsIdForGame(getActiveGameId());
            ensureSettingsRow(id);

            const stmt = db.prepare(`
                UPDATE settings
                SET mods_dir = ?, game_path = ?, nexus_download_dir = ?, background_images_dir = ?, background_image_name = ?, background_opacity = ?, background_blur = ?, theme = ?, color_preset = ?, foreground_transparency = ?, preview_delay = ?, preview_interval = ?, scroll_trigger_distance = ?
                WHERE id = ?
            `);

            const info = stmt.run(
                settings.mods_dir,
                settings.game_path,
                settings.nexus_download_dir || '',
                settings.background_images_dir,
                settings.background_image_name,
                settings.background_opacity,
                settings.background_blur,
                settings.theme,
                settings.color_preset,
                settings.foreground_transparency !== undefined ? settings.foreground_transparency : 1.0,
                settings.preview_delay !== undefined ? settings.preview_delay : 600,
                settings.preview_interval !== undefined ? settings.preview_interval : 2000,
                settings.scroll_trigger_distance !== undefined ? settings.scroll_trigger_distance : 100,
                id
            );

            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('settings-updated', settings);
            });

            return { success: info.changes > 0 };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });
}

module.exports = {
    registerSettingsHandlers,
};
