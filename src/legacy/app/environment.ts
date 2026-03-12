import { activeUserSettings } from '../utils/persistentUserSettings.ts';
import { checkForWebserialSupport } from '../io/serialComms.ts';
import { handleURLParameters, devmode, disableWebSerial } from '../urlParams.ts';

export function examineEnvironment() {
  // Handle URL parameters first to set up global state
  handleURLParameters();

  // Desktop/Electron runtime support is out of scope for the reset.
  const areInBrowser = typeof window !== 'undefined' && window.navigator;
  const areInDesktopApp = false;

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
