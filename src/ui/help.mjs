export function initHelpPanel(){
    // Mac toggle switch functionality
  document.getElementById('macToggle').addEventListener('change', (e) => {
    const helpPanel = document.getElementById('panel-help');
    if (e.target.checked) {
      helpPanel.classList.add('show-mac');
    } else {
      helpPanel.classList.remove('show-mac');
    }
  });

  // Handle ESC key to close help panel
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape' && interfaceStates.helpPanelState === panelStates.PANEL) {
      $("#panel-help").hide();
      interfaceStates.helpPanelState = panelStates.OFF;
    }
  });
}