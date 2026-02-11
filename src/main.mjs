import { createAppUI } from './ui/ui.mjs';
import { examineEnvironment } from './app/environment.mjs';
import { createApp } from './app/application.mjs';
import { loadConfiguration } from './config/configLoader.mjs';
import { activeUserSettings } from './utils/persistentUserSettings.mjs';

const SOLID_BOOT_TIMEOUT_MS = 2000;
const SOLID_BOOT_STEP_MS = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSolidUiBootstrapped() {
  return Boolean(
    document.getElementById('panel-top-toolbar-root') &&
    document.getElementById('panel-toolbar-root') &&
    typeof window.mountSettingsPanel === 'function' &&
    typeof window.mountHelpPanel === 'function'
  );
}

async function waitForSolidUiBootstrap() {
  const deadline = Date.now() + SOLID_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isSolidUiBootstrapped()) {
      return true;
    }
    await sleep(SOLID_BOOT_STEP_MS);
  }
  return isSolidUiBootstrapped();
}

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

  const solidBootstrapped = await waitForSolidUiBootstrap();
  if (!solidBootstrapped) {
    console.warn('Solid UI islands were not fully ready before app start; continuing with runtime fallback.');
  }

  let environmentState = examineEnvironment();
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState);
  await app.start();
});
