import { dbg } from "../../utils.mjs";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { baseExtensions } from "../../editors/extensions.mjs";
import { themes } from "../../editors/themes/themeManager.mjs";
import { activeUserSettings } from "../../utils/persistentUserSettings.mjs";

const STORAGE_KEYS = Object.freeze({
    snippets: "codeSnippets:snippets",
    starred: "codeSnippets:starred",
    nextId: "codeSnippets:nextId"
});

const state = {
    snippets: [],
    starredSnippets: new Set(),
    selectedTags: new Set(),
    allTags: new Set(),
    searchTerm: "",
    nextId: 1,
    editors: new Map(),
    visualizationStates: new Map()
};

const ui = {
    root: null,
    searchInput: null,
    tagsWrapper: null,
    clearTagsButton: null,
    snippetsContainer: null,
    addSnippetButton: null,
    editModal: null
};

function loadFromStorage() {
    try {
        const snippetsData = localStorage.getItem(STORAGE_KEYS.snippets);
        if (snippetsData) {
            state.snippets = JSON.parse(snippetsData);
            state.snippets.forEach(snippet => {
                if (snippet.tags) {
                    snippet.tags.forEach(tag => state.allTags.add(tag));
                }
            });
        }

        const starredData = localStorage.getItem(STORAGE_KEYS.starred);
        if (starredData) {
            state.starredSnippets = new Set(JSON.parse(starredData));
        }

        const nextIdData = localStorage.getItem(STORAGE_KEYS.nextId);
        if (nextIdData) {
            state.nextId = parseInt(nextIdData, 10);
        }
    } catch (error) {
        dbg("CodeSnippets", "Failed to load from storage", error);
    }
}

function saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.snippets, JSON.stringify(state.snippets));
        localStorage.setItem(STORAGE_KEYS.starred, JSON.stringify(Array.from(state.starredSnippets)));
        localStorage.setItem(STORAGE_KEYS.nextId, state.nextId.toString());
    } catch (error) {
        dbg("CodeSnippets", "Failed to save to storage", error);
    }
}

function createSnippetEditor(snippet) {
    const currentTheme = activeUserSettings.editor?.theme || "oneDark";
    const themeExtension = themes[currentTheme];

    const state = EditorState.create({
        doc: snippet.code || "",
        extensions: [
            ...baseExtensions,
            themeExtension,
            EditorView.editable.of(false),
            EditorView.theme({
                ".cm-content": {
                    fontSize: "12px",
                    minHeight: "60px",
                    maxHeight: "200px"
                },
                ".cm-scroller": {
                    overflow: "auto"
                }
            })
        ]
    });

    return new EditorView({ state });
}

function createSnippetElement(snippet) {
    const $container = $('<div>', {
        class: 'code-snippet-item',
        'data-snippet-id': snippet.id
    });

    // Header with title and actions
    const $header = $('<div>', { class: 'code-snippet-header' });

    const $titleRow = $('<div>', { class: 'code-snippet-title-row' });

    // Star button
    const $starButton = $('<button>', {
        class: 'code-snippet-star' + (state.starredSnippets.has(snippet.id) ? ' starred' : ''),
        html: state.starredSnippets.has(snippet.id) ? '★' : '☆',
        title: 'Toggle favorite'
    });

    $starButton.on('click', (e) => {
        e.stopPropagation();
        if (state.starredSnippets.has(snippet.id)) {
            state.starredSnippets.delete(snippet.id);
            $starButton.removeClass('starred').html('☆');
        } else {
            state.starredSnippets.add(snippet.id);
            $starButton.addClass('starred').html('★');
        }
        saveToStorage();
    });

    const $title = $('<div>', {
        class: 'code-snippet-title',
        text: snippet.title || 'Untitled Snippet'
    });

    $titleRow.append($starButton, $title);
    $header.append($titleRow);

    // Tags
    if (snippet.tags && snippet.tags.length > 0) {
        const $tags = $('<div>', { class: 'code-snippet-tags' });
        snippet.tags.forEach(tag => {
            const $tag = $('<span>', {
                class: 'code-snippet-tag',
                text: tag
            });
            $tags.append($tag);
        });
        $header.append($tags);
    }

    $container.append($header);

    // Editor container
    const $editorContainer = $('<div>', {
        class: 'code-snippet-editor-container'
    });

    const editor = createSnippetEditor(snippet);
    $editorContainer.append(editor.dom);
    state.editors.set(snippet.id, editor);

    $container.append($editorContainer);

    // Action buttons
    const $actions = $('<div>', { class: 'code-snippet-actions' });

    const $copyButton = $('<button>', {
        class: 'code-snippet-action-btn',
        html: '📋',
        title: 'Copy to clipboard'
    });

    $copyButton.on('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(snippet.code).then(() => {
            $copyButton.html('✓');
            setTimeout(() => $copyButton.html('📋'), 1500);
        });
    });

    const $insertButton = $('<button>', {
        class: 'code-snippet-action-btn',
        html: '⬆',
        title: 'Insert at top of main editor'
    });

    $insertButton.on('click', (e) => {
        e.stopPropagation();
        const mainEditor = EditorView.findFromDOM($('#panel-main-editor .cm-editor')[0]);
        if (mainEditor) {
            const transaction = mainEditor.state.update({
                changes: {
                    from: 0,
                    to: 0,
                    insert: snippet.code + '\n'
                }
            });
            mainEditor.dispatch(transaction);
            $insertButton.html('✓');
            setTimeout(() => $insertButton.html('⬆'), 1500);
        }
    });

    const $visButton = $('<button>', {
        class: 'code-snippet-action-btn',
        html: '👁',
        title: 'Toggle visualization'
    });

    $visButton.on('click', async (e) => {
        e.stopPropagation();
        const isActive = state.visualizationStates.get(snippet.id);
        state.visualizationStates.set(snippet.id, !isActive);
        $visButton.toggleClass('active', !isActive);

        // Import and use the visualization controller
        if (!isActive) {
            try {
                const { toggleVisualisation } = await import('../../serialVis/visualisationController.mjs');
                // Use a unique identifier for this snippet's visualization
                const exprType = `S${snippet.id}`;
                await toggleVisualisation(exprType, snippet.code);
            } catch (error) {
                console.error('Failed to toggle visualization:', error);
            }
        } else {
            // Clear by toggling off - the controller handles this
            try {
                const { toggleVisualisation } = await import('../../serialVis/visualisationController.mjs');
                const exprType = `S${snippet.id}`;
                await toggleVisualisation(exprType, ''); // Empty string to clear
            } catch (error) {
                console.error('Failed to clear visualization:', error);
            }
        }
    });

    const $editButton = $('<button>', {
        class: 'code-snippet-action-btn',
        html: '✏',
        title: 'Edit snippet'
    });

    $editButton.on('click', (e) => {
        e.stopPropagation();
        showEditModal(snippet);
    });

    const $deleteButton = $('<button>', {
        class: 'code-snippet-action-btn delete',
        html: '🗑',
        title: 'Delete snippet'
    });

    $deleteButton.on('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this snippet?')) {
            deleteSnippet(snippet.id);
        }
    });

    $actions.append($copyButton, $insertButton, $visButton, $editButton, $deleteButton);
    $container.append($actions);

    // Make draggable
    $container.attr('draggable', true);
    $container.on('dragstart', (e) => {
        e.originalEvent.dataTransfer.effectAllowed = 'copy';
        e.originalEvent.dataTransfer.setData('text/plain', snippet.code);
        $container.addClass('dragging');
    });

    $container.on('dragend', () => {
        $container.removeClass('dragging');
    });

    return $container;
}

function showEditModal(snippet = null) {
    const isNew = !snippet;
    const modalTitle = isNew ? 'Add Code Snippet' : 'Edit Code Snippet';

    const $modal = $('<div>', { class: 'code-snippet-modal' });
    const $backdrop = $('<div>', { class: 'code-snippet-modal-backdrop' });

    const $content = $('<div>', { class: 'code-snippet-modal-content' });
    const $header = $('<div>', { class: 'code-snippet-modal-header' });
    const $title = $('<h3>', { text: modalTitle });
    const $close = $('<button>', { class: 'code-snippet-modal-close', html: '×' });

    $header.append($title, $close);
    $content.append($header);

    const $body = $('<div>', { class: 'code-snippet-modal-body' });

    // Title input
    const $titleGroup = $('<div>', { class: 'code-snippet-form-group' });
    $titleGroup.append($('<label>', { text: 'Title:' }));
    const $titleInput = $('<input>', {
        type: 'text',
        class: 'code-snippet-input',
        value: snippet?.title || '',
        placeholder: 'Enter snippet title'
    });
    $titleGroup.append($titleInput);
    $body.append($titleGroup);

    // Tags input
    const $tagsGroup = $('<div>', { class: 'code-snippet-form-group' });
    $tagsGroup.append($('<label>', { text: 'Tags (comma-separated):' }));
    const $tagsInput = $('<input>', {
        type: 'text',
        class: 'code-snippet-input',
        value: snippet?.tags?.join(', ') || '',
        placeholder: 'e.g., math, animation, utility'
    });
    $tagsGroup.append($tagsInput);
    $body.append($tagsGroup);

    // Code editor
    const $codeGroup = $('<div>', { class: 'code-snippet-form-group' });
    $codeGroup.append($('<label>', { text: 'Code:' }));

    const currentTheme = activeUserSettings.editor?.theme || "oneDark";
    const themeExtension = themes[currentTheme];

    const editorState = EditorState.create({
        doc: snippet?.code || "",
        extensions: [
            ...baseExtensions,
            themeExtension,
            EditorView.theme({
                ".cm-content": {
                    minHeight: "200px",
                    maxHeight: "400px"
                },
                ".cm-scroller": {
                    overflow: "auto"
                }
            })
        ]
    });

    const editorView = new EditorView({
        state: editorState
    });

    $codeGroup.append(editorView.dom);
    $body.append($codeGroup);

    // Use main editor button
    const $useMainButton = $('<button>', {
        class: 'code-snippet-use-main-btn',
        text: 'Use code from main editor'
    });

    $useMainButton.on('click', () => {
        const mainEditor = EditorView.findFromDOM($('#panel-main-editor .cm-editor')[0]);
        if (mainEditor) {
            const code = mainEditor.state.doc.toString();
            editorView.dispatch({
                changes: { from: 0, to: editorView.state.doc.length, insert: code }
            });
        }
    });

    $body.append($useMainButton);

    $content.append($body);

    // Footer with buttons
    const $footer = $('<div>', { class: 'code-snippet-modal-footer' });
    const $cancelBtn = $('<button>', { class: 'code-snippet-btn-cancel', text: 'Cancel' });
    const $saveBtn = $('<button>', { class: 'code-snippet-btn-save', text: 'Save' });

    $footer.append($cancelBtn, $saveBtn);
    $content.append($footer);

    $modal.append($backdrop, $content);

    // Event handlers
    const closeModal = () => {
        $modal.remove();
    };

    $backdrop.on('click', closeModal);
    $close.on('click', closeModal);
    $cancelBtn.on('click', closeModal);

    $saveBtn.on('click', () => {
        const title = $titleInput.val().trim();
        const tags = $tagsInput.val().split(',').map(t => t.trim()).filter(t => t);
        const code = editorView.state.doc.toString();

        if (!title) {
            alert('Please enter a title');
            return;
        }

        if (isNew) {
            const newSnippet = {
                id: state.nextId++,
                title,
                tags,
                code,
                createdAt: Date.now()
            };
            state.snippets.push(newSnippet);
            tags.forEach(tag => state.allTags.add(tag));
        } else {
            snippet.title = title;
            snippet.tags = tags;
            snippet.code = code;

            // Update tags set
            state.allTags.clear();
            state.snippets.forEach(s => {
                if (s.tags) {
                    s.tags.forEach(tag => state.allTags.add(tag));
                }
            });

            // Update editor
            const editor = state.editors.get(snippet.id);
            if (editor) {
                editor.dispatch({
                    changes: { from: 0, to: editor.state.doc.length, insert: code }
                });
            }
        }

        saveToStorage();
        renderSnippets();
        closeModal();
    });

    $('body').append($modal);
    $titleInput.focus();
}

function deleteSnippet(id) {
    state.snippets = state.snippets.filter(s => s.id !== id);
    state.starredSnippets.delete(id);
    state.visualizationStates.delete(id);

    const editor = state.editors.get(id);
    if (editor) {
        editor.destroy();
        state.editors.delete(id);
    }

    // Update tags
    state.allTags.clear();
    state.snippets.forEach(snippet => {
        if (snippet.tags) {
            snippet.tags.forEach(tag => state.allTags.add(tag));
        }
    });

    saveToStorage();
    renderSnippets();
}

function filterSnippets() {
    let filtered = state.snippets;

    // Filter by search term
    if (state.searchTerm) {
        const term = state.searchTerm.toLowerCase();
        filtered = filtered.filter(snippet =>
            snippet.title.toLowerCase().includes(term) ||
            snippet.code.toLowerCase().includes(term) ||
            (snippet.tags && snippet.tags.some(tag => tag.toLowerCase().includes(term)))
        );
    }

    // Filter by selected tags
    if (state.selectedTags.size > 0) {
        filtered = filtered.filter(snippet =>
            snippet.tags && snippet.tags.some(tag => state.selectedTags.has(tag))
        );
    }

    // Sort: starred first, then by creation date
    filtered.sort((a, b) => {
        const aStarred = state.starredSnippets.has(a.id);
        const bStarred = state.starredSnippets.has(b.id);

        if (aStarred && !bStarred) return -1;
        if (!aStarred && bStarred) return 1;

        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return filtered;
}

function renderSnippets() {
    if (!ui.snippetsContainer) return;

    ui.snippetsContainer.empty();

    const filtered = filterSnippets();

    if (filtered.length === 0) {
        const $empty = $('<div>', {
            class: 'code-snippets-empty',
            text: state.snippets.length === 0 ?
                'No snippets yet. Click "Add Snippet" to create one!' :
                'No snippets match your filters.'
        });
        ui.snippetsContainer.append($empty);
    } else {
        filtered.forEach(snippet => {
            ui.snippetsContainer.append(createSnippetElement(snippet));
        });
    }
}

function renderTags() {
    if (!ui.tagsWrapper) return;

    ui.tagsWrapper.empty();

    Array.from(state.allTags).sort().forEach(tag => {
        const $tag = $('<button>', {
            class: 'code-snippet-filter-tag' + (state.selectedTags.has(tag) ? ' selected' : ''),
            text: tag
        });

        $tag.on('click', () => {
            if (state.selectedTags.has(tag)) {
                state.selectedTags.delete(tag);
                $tag.removeClass('selected');
            } else {
                state.selectedTags.add(tag);
                $tag.addClass('selected');
            }

            ui.clearTagsButton.prop('disabled', state.selectedTags.size === 0);
            renderSnippets();
        });

        ui.tagsWrapper.append($tag);
    });
}

export function makeCodeSnippets() {
    dbg("CodeSnippets", "makeCodeSnippets", "Starting");

    loadFromStorage();

    // Create main container
    ui.root = $('<div>', {
        class: 'code-snippets-container',
        id: 'code-snippets'
    });

    // Header with search and add button
    const $header = $('<div>', { class: 'code-snippets-header' });

    const $searchBar = $('<div>', { class: 'code-snippets-search-bar' });

    ui.searchInput = $('<input>', {
        type: 'text',
        class: 'code-snippets-search',
        placeholder: 'Search snippets...'
    });

    ui.searchInput.on('input', (e) => {
        state.searchTerm = e.target.value;
        renderSnippets();
    });

    ui.addSnippetButton = $('<button>', {
        class: 'code-snippet-add-btn',
        text: '+ Add Snippet'
    });

    ui.addSnippetButton.on('click', () => {
        showEditModal();
    });

    $searchBar.append(ui.searchInput, ui.addSnippetButton);
    $header.append($searchBar);

    // Tags filter
    const $tagsFilter = $('<div>', { class: 'code-snippets-tags-filter' });

    const $tagsLabel = $('<span>', {
        class: 'code-snippets-tags-label',
        text: 'Filter by tags:'
    });

    ui.tagsWrapper = $('<div>', { class: 'code-snippets-tags-wrapper' });

    ui.clearTagsButton = $('<button>', {
        class: 'code-snippets-clear-tags',
        text: 'Clear',
        disabled: true
    });

    ui.clearTagsButton.on('click', () => {
        state.selectedTags.clear();
        ui.clearTagsButton.prop('disabled', true);
        renderTags();
        renderSnippets();
    });

    $tagsFilter.append($tagsLabel, ui.tagsWrapper, ui.clearTagsButton);
    $header.append($tagsFilter);

    ui.root.append($header);

    // Snippets container
    ui.snippetsContainer = $('<div>', { class: 'code-snippets-list' });
    ui.root.append(ui.snippetsContainer);

    // Initial render
    renderTags();
    renderSnippets();

    return ui.root;
}