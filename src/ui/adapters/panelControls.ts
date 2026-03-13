interface PanelControlHandlers {
  hideAllPanels: () => void;
  togglePanelVisibility: (panelId: string) => void;
}

let handlers: PanelControlHandlers | null = null;

export function registerPanelControls(nextHandlers: PanelControlHandlers): void {
  handlers = nextHandlers;
}

export function hideChromePanels(): void {
  handlers?.hideAllPanels();
}

export function toggleChromePanel(panelId: string): boolean {
  if (!handlers) {
    return false;
  }

  handlers.togglePanelVisibility(panelId);
  return true;
}
