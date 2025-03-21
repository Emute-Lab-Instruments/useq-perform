import { toggleAuxPanel } from './ui.mjs';

export function initHelpPanel(){
    const helpPanel = document.getElementById('panel-help');
    
    // Create and add the toggle position button
    const togglePositionButton = document.createElement('button');
    togglePositionButton.id = 'panel-help-toggle-position';
    togglePositionButton.innerHTML = '⇄';
    togglePositionButton.title = 'Toggle panel position';
    helpPanel.appendChild(togglePositionButton);
    
    // Add toggle position functionality
    togglePositionButton.addEventListener('click', () => {
        helpPanel.classList.toggle('centered');
    });
    
    // Mac toggle switch functionality
    document.getElementById('macToggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            helpPanel.classList.add('show-mac');
        } else {
            helpPanel.classList.remove('show-mac');
        }
    });

    // Handle ESC key to close help panel globally
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $("#panel-help").is(":visible")) {
            toggleAuxPanel("#panel-help");
        }
    });
}