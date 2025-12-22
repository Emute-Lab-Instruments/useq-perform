import { createAppUI } from './ui/ui.mjs';
import { examineEnvironment } from './app/environment.mjs';
import { createApp } from './app/application.mjs';
import { loadConfiguration } from './config/configLoader.mjs';
import { activeUserSettings } from './utils/persistentUserSettings.mjs';

// Main entry point
$(document).ready(async () => {
  // Load configuration from default-config.json + localStorage + URL params
  try {
    const config = await loadConfiguration();
    // Merge into activeUserSettings
    Object.assign(activeUserSettings, config);
    window.dispatchEvent(new CustomEvent('useq-settings-changed', { detail: activeUserSettings }));
    console.log('✅ Configuration loaded successfully');
  } catch (error) {
    console.warn('⚠️ Failed to load configuration, using defaults:', error);
  }

  let environmentState = examineEnvironment();
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState);
  await app.start();
});
