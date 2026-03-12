import './setup.mjs';
import { expect } from 'chai';
import { createApp } from '../src/legacy/app/application.ts';

var defaultEnvironmentState = {
  areInBrowser: true,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
  isInDevmode: false,
  userSettings: { name: 'Test User' },
  urlParams: {}
};

describe('Warnings', () => {
    it('starts browser-local runtime by default when webserial is unavailable', async () => {
        let environmentState = {
            ...defaultEnvironmentState,
            isWebSerialAvailable: false
        };

        // Create app without UI to avoid CodeMirror issues
        let app = createApp(null, environmentState);
        await app.start();

        expect(app.modals).to.not.have.property('webserialWarning');
    });

    it('still shows the warning modal when webserial is unavailable and WASM is disabled', async () => {
        let environmentState = {
            ...defaultEnvironmentState,
            isWebSerialAvailable: false,
            userSettings: {
              ...defaultEnvironmentState.userSettings,
              wasm: { enabled: false }
            }
        };

        let app = createApp(null, environmentState);
        await app.start();

        expect(app.modals).to.have.property('webserialWarning');
    });
});
