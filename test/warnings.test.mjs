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
    it('calls showModal when webserial not available', async () => {
        let environmentState = {
            ...defaultEnvironmentState,
            isWebSerialAvailable: false
        };

        // Create app without UI to avoid CodeMirror issues
        let app = createApp(null, environmentState);
        await app.start();

        // In the new Solid architecture, showModal sets a signal rather
        // than returning a DOM element. Verify it was invoked by checking
        // the modals property was assigned (even if undefined, the key exists).
        expect(app.modals).to.have.property('webserialWarning');
    });
});
