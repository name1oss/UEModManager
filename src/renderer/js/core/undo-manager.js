'use strict';

// ==========================================================================
// UNDO MANAGER
// Implements a Command Pattern undo stack for reversible user actions.
// Usage: window.undoManager.push({ description, undo })
//        window.undoManager.undo()   (also triggered by Ctrl+Z)
// ==========================================================================

class UndoManager {
    /**
     * @param {number} maxSize - Maximum number of undo steps to retain.
     */
    constructor(maxSize = 50) {
        this.stack = [];
        this.maxSize = maxSize;
        this._isBusy = false; // Guard against concurrent undos
    }

    /**
     * Push a reversible action onto the stack.
     * @param {{ description: string, undo: () => (void|Promise<void>) }} action
     */
    push(action) {
        if (!action || typeof action.undo !== 'function') {
            console.warn('[UndoManager] Invalid action pushed, ignoring.', action);
            return;
        }

        this.stack.push(action);

        // Trim oldest entries if over the limit
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        }

        console.log(`[UndoManager] Pushed: "${action.description}" (stack size: ${this.stack.length})`);
    }

    /**
     * Undo the most recent action.
     */
    async undo() {
        if (this._isBusy) return;

        if (this.stack.length === 0) {
            if (typeof showToast === 'function') {
                showToast('toast.undo.nothing', 'info', 2000);
            }
            return;
        }

        const action = this.stack.pop();
        console.log(`[UndoManager] Undoing: "${action.description}"`);

        this._isBusy = true;
        try {
            await Promise.resolve(action.undo());
            if (typeof showToast === 'function') {
                showToast('toast.undo.success', 'info', 2500, { desc: action.description });
            }
        } catch (err) {
            console.error('[UndoManager] Undo failed:', err);
            if (typeof showToast === 'function') {
                showToast('toast.undo.fail', 'error', 3000, { desc: action.description });
            }
        } finally {
            this._isBusy = false;
        }
    }

    /**
     * Clear all undo history (e.g. on game switch).
     */
    clear() {
        this.stack = [];
        console.log('[UndoManager] Stack cleared.');
    }

    /** How many steps can currently be undone. */
    get size() {
        return this.stack.length;
    }
}

// Expose globally so all renderer scripts can access it
window.undoManager = new UndoManager(50);
