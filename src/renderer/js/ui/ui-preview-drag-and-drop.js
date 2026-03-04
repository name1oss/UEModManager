// ui-preview-drag-and-drop.js
// Handles drag and drop functionality for the Preview Image Editor modal

document.addEventListener('DOMContentLoaded', () => {
    initializePreviewDragAndDrop();
});

function initializePreviewDragAndDrop() {
    const dropZone = document.getElementById('previewImageDropZone');
    const uploadInput = document.getElementById('previewImageUploadInput');

    if (!dropZone || !uploadInput) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    // Handle dropped files
    dropZone.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight(e) {
        dropZone.classList.add('highlight');
        dropZone.style.borderColor = 'var(--accent-blue)';
        dropZone.style.backgroundColor = 'var(--bg-card-hover)';
    }

    function unhighlight(e) {
        dropZone.classList.remove('highlight');
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.backgroundColor = 'var(--bg-card)';
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            handleFiles(files);
        }
    }

    function handleFiles(files) {
        const file = files[0];

        // Validation: Check if it's an image
        if (!file.type.startsWith('image/') && !file.name.match(/\.(dds|webp)$/i)) {
            showToast('preview.upload.invalid_file', 'warning');
            return;
        }

        // Update the file input manually (needed for upload logic)
        // Note: setting files property of input is limited for security, 
        // but DataTransfer object in modern browsers helps.
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        uploadInput.files = dataTransfer.files;

        // Trigger change event to update UI
        uploadInput.dispatchEvent(new Event('change'));
    }
}

// Re-initialize when modal opens (in case DOM wasn't ready)
// We hook into the global scope or event if possible, but simplicity relies on element existence.
// Since the modal HTML exists in index.html static content, DOMContentLoaded is usually enough.
