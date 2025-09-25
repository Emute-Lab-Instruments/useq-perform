import { activeUserSettings } from '../utils/persistentUserSettings.mjs';
import { checkForWebserialSupport } from '../io/serialComms.mjs';
import { handleURLParameters, devmode, disableWebSerial } from '../urlParams.mjs';

export function examineEnvironment() {
  // Handle URL parameters first to set up global state
  handleURLParameters();

  // Detect if we're in a browser vs desktop app
  const areInBrowser = typeof window !== 'undefined' && window.navigator;
  const areInDesktopApp = !areInBrowser || (window.electronAPI !== undefined);

  // Check for Web Serial API support (can be disabled via URL parameter)
  const isWebSerialAvailable = disableWebSerial ? false : checkForWebserialSupport();

  // Get current URL parameters
  const urlParams = new URLSearchParams(window.location.search);

  return {
    areInBrowser,
    areInDesktopApp,
    isWebSerialAvailable,
    isInDevmode: devmode,
    userSettings: activeUserSettings,
    urlParams: Object.fromEntries(urlParams.entries())
  };
}