import { dbg } from "../../utils.mjs";
import { activeUserSettings, updateUserSettings } from "../../utils/persistentUserSettings.mjs";

/**
 * Creates the keybindings settings tab
 * @returns {jQuery} The keybindings tab container
 */
export function makeKeybindingsTab() {
    dbg("makeKeybindingsTab", "Creating keybindings tab");
    
    const $container = $('<div>').addClass('panel-tab-content');
    
    // Introduction section
    // const $introSection = createSection('Keyboard Shortcuts');
    // const $introText = $('<p>').text(
    //     'Customize keyboard shortcuts for various actions. Click on a shortcut to edit it.'
    // );
    // $introSection.append($introText);
    
    // Core shortcuts section
    const $coreSection = createSection('Core Actions');
    buildKeyBindingsGroup($coreSection, getCoreKeybindings());
    
    // Editor shortcuts section
    const $editorSection = createSection('Editor Actions');
    buildKeyBindingsGroup($editorSection, getEditorKeybindings());
    
    // Navigation shortcuts section
    const $navigationSection = createSection('Navigation');
    buildKeyBindingsGroup($navigationSection, getNavigationKeybindings());
    
    // Add all sections to container
    $container.append($coreSection, $editorSection, $navigationSection);
    
    // Add reset button at the bottom
    // const $resetButtonContainer = $('<div>').addClass('panel-section');
    // const $resetButton = $('<button>')
    //     .addClass('panel-button reset')
    //     .text('Reset Keybindings')
    //     .on('click', () => {
    //         if (confirm('Are you sure you want to reset all keybindings to default values?')) {
    //             resetKeybindings();
    //             // Refresh the tab
    //             const $parent = $container.parent();
    //             $container.remove();
    //             $parent.append(makeKeybindingsTab());
    //         }
    //     });
    
    // $resetButtonContainer.append($resetButton);
    // $container.append($resetButtonContainer);
    
    return $container;
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    const $section = $('<div>').addClass('panel-section');
    const $sectionTitle = $('<h3>')
        .addClass('panel-section-title')
        .text(title);
    $section.append($sectionTitle);
    return $section;
}

/**
 * Build a group of key bindings
 */
function buildKeyBindingsGroup($container, keybindings) {
    keybindings.forEach(binding => {
        const $row = $('<div>').addClass('panel-row');
        
        const $label = $('<label>')
            .addClass('panel-label')
            .text(binding.description);
        
        const $keyBindingContainer = $('<div>')
            .addClass('panel-control');
        
        const $keyBinding = $('<span>')
            .addClass('key-binding')
            .attr('data-action', binding.action)
            .text(binding.key)
            .on('click', function() {
                editKeybinding($(this), binding);
            });
        
        $keyBindingContainer.append($keyBinding);
        $row.append($label, $keyBindingContainer);
        $container.append($row);
    });
}

/**
 * Opens an edit dialog for changing a keybinding
 */
function editKeybinding($element, binding) {
    // Create a modal/popup for editing the keybinding
    const $modal = $('<div>').addClass('keybinding-modal');
    const $overlay = $('<div>').addClass('keybinding-overlay');
    
    const $content = $('<div>').addClass('keybinding-content');
    const $title = $('<h4>').text(`Edit Shortcut for: ${binding.description}`);
    
    const $instructions = $('<p>').text('Press the keys you want to use for this action.');
    const $currentBinding = $('<div>').addClass('current-binding').text('Current: ' + binding.key);
    
    const $newBinding = $('<div>')
        .addClass('new-binding')
        .text('Press keys...')
        .attr('tabindex', 0) // Make it focusable
        .on('keydown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Build the key string
            let keyString = '';
            if (e.ctrlKey) keyString += 'Ctrl-';
            if (e.altKey) keyString += 'Alt-';
            if (e.shiftKey) keyString += 'Shift-';
            if (e.metaKey) keyString += 'Meta-';
            
            // Get the key name
            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
                // Don't add modifier keys on their own
                return;
            }
            
            keyString += key;
            $(this).text(keyString);
        });
    
    // Buttons
    const $buttonContainer = $('<div>').addClass('keybinding-buttons');
    const $cancelButton = $('<button>')
        .addClass('panel-button')
        .text('Cancel')
        .on('click', function() {
            $modal.remove();
            $overlay.remove();
        });
    
    const $saveButton = $('<button>')
        .addClass('panel-button primary')
        .text('Save')
        .on('click', function() {
            const newKey = $newBinding.text();
            if (newKey !== 'Press keys...') {
                saveKeybinding(binding.action, newKey);
                $element.text(newKey); // Update the displayed keybinding
            }
            $modal.remove();
            $overlay.remove();
        });
    
    $buttonContainer.append($cancelButton, $saveButton);
    $content.append($title, $instructions, $currentBinding, $newBinding, $buttonContainer);
    $modal.append($content);
    
    // Add to document
    $('body').append($overlay, $modal);
    
    // Focus the input
    $newBinding.focus();
}

/**
 * Save a keybinding to user settings
 */
function saveKeybinding(action, key) {
    // Get current keybindings or initialize empty object
    const currentKeymaps = activeUserSettings.keymaps || {};
    
    // Update the keybinding
    const updatedKeymaps = {
        ...currentKeymaps,
        [action]: key
    };
    
    // Save to user settings
    updateUserSettings({ keymaps: updatedKeymaps });
}

/**
 * Reset all keybindings to defaults
 */
function resetKeybindings() {
    // Clear custom keybindings
    updateUserSettings({ keymaps: {} });
}

/**
 * Get the user's current keybinding or the default
 */
function getEffectiveKeybinding(action, defaultKey) {
    if (activeUserSettings.keymaps && activeUserSettings.keymaps[action]) {
        return activeUserSettings.keymaps[action];
    }
    return defaultKey;
}

/**
 * Get core application keybindings
 */
function getCoreKeybindings() {
    return [
        {
            description: 'Execute Code (now)',
            action: 'evalNow',
            key: getEffectiveKeybinding('evalNow', 'Ctrl-Enter')
        },
        {
            description: 'Execute Code (quantised)',
            action: 'evalQuantised',
            key: getEffectiveKeybinding('evalQuantised', 'Alt-Enter')
        },
        {
            description: 'Toggle Help Panel',
            action: 'toggleHelp',
            key: getEffectiveKeybinding('toggleHelp', 'Alt-h')
        },
        // {
        //     description: 'Toggle Visualization',
        //     action: 'toggleVid',
        //     key: getEffectiveKeybinding('toggleVid', 'Alt-v')
        // },
        {
            description: 'Toggle Signal Visualization',
            action: 'toggleSerialVis',
            key: getEffectiveKeybinding('toggleSerialVis', 'Alt-g')
        },
        {
            description: 'Show Documentation for Symbol around cursor',
            action: 'showDocumentationForSymbol',
            key: getEffectiveKeybinding('showDocumentationForSymbol', 'Alt-f')
        }
    ];
}

/**
 * Get editor-specific keybindings
 */
function getEditorKeybindings() {
    return [
        {
            description: 'Delete from cursor till end of current list',
            action: 'slurpForward',
            key: getEffectiveKeybinding('slurpForward', 'Ctrl-k')
        },
         {
            description: 'Slurp Forward',
            action: 'slurpForward',
            key: getEffectiveKeybinding('slurpForward', 'Ctrl-]')
        },
        {
            description: 'Slurp Backward',
            action: 'slurpBackward',
            key: getEffectiveKeybinding('slurpBackward', 'Ctrl-[')
        },
        {
            description: 'Barf Forward',
            action: 'barfForward',
            key: getEffectiveKeybinding('barfForward', 'Ctrl-\'')
        },
        {
            description: 'Barf Backward',
            action: 'barfBackward',
            key: getEffectiveKeybinding('barfBackward', 'Ctrl-;')
        },
        {
            description: 'Undo',
            action: 'undo',
            key: getEffectiveKeybinding('undo', 'Ctrl-z')
        },
        {
            description: 'Redo',
            action: 'redo',
            key: getEffectiveKeybinding('redo', 'Ctrl-y')
        }
    ];
}

/**
 * Get navigation keybindings
 */
function getNavigationKeybindings() {
    return [
        {
            description: 'Go to Start of Line',
            action: 'goLineStart',
            key: getEffectiveKeybinding('goLineStart', 'Home')
        },
        {
            description: 'Go to End of Line',
            action: 'goLineEnd',
            key: getEffectiveKeybinding('goLineEnd', 'End')
        },
        // {
        //     description: 'Go to Previous Match',
        //     action: 'findPrevious',
        //     key: getEffectiveKeybinding('findPrevious', 'Ctrl-Shift-g')
        // },
        // {
        //     description: 'Go to Next Match',
        //     action: 'findNext',
        //     key: getEffectiveKeybinding('findNext', 'Ctrl-g')
        // }
    ];
}