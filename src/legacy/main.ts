import './styles/index.css';
import { createAppUI } from './ui/ui.ts';
import { examineEnvironment } from './app/environment.ts';
import { createApp } from './app/application.ts';
import { loadConfiguration } from './config/configLoader.ts';
import { activeUserSettings } from './utils/persistentUserSettings.ts';

// Main entry point
document.addEventListener('DOMContentLoaded', async () => {
  // Load configuration from default-config.json + localStorage + URL params
  try {
    const config = await loadConfiguration();
    // Merge into activeUserSettings
    Object.assign(activeUserSettings, config);
    window.dispatchEvent(new CustomEvent('useq-settings-changed', { detail: activeUserSettings }));
    console.log('Configuration loaded successfully');
  } catch (error) {
    console.warn('Failed to load configuration, using defaults:', error);
  }

  let environmentState = examineEnvironment();
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState);
  await app.start();
});
