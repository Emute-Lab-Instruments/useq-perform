import { expect } from "chai";
import "./setup.mjs";
import { examineEnvironment } from "../src/legacy/app/environment.ts";
import { createAppUI } from "../src/legacy/ui/ui.ts";
import { createApp } from "../src/legacy/app/application.ts";

// Test setup
let environmentState, appUI;

before(async () => {
    // Create test environment state
    environmentState = {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: false,
        isInDevmode: false,
        userSettings: { name: 'Test User' },
        urlParams: {}
    };
});

// environmentState
it('contains the expected keys and methods', () => {
    expect(environmentState).to.have.property('areInBrowser');
    expect(environmentState).to.have.property('areInDesktopApp');
    expect(environmentState).to.have.property('isWebSerialAvailable');
    expect(environmentState).to.have.property('isInDevmode');
    expect(environmentState).to.have.property('userSettings');
    expect(environmentState).to.have.property('urlParams');
});

// appUI
it('contains the expected keys and methods', async () => {
    // Settings and help panels are now managed by the Solid adapter (solid-panel-root),
    // not returned as DOM references from createAppUI.
    appUI = await createAppUI(environmentState);
    expect(appUI).to.have.property('mainEditor');
    expect(appUI).to.have.property('serialVis');
    expect(appUI).to.have.property('logConsole');
    expect(appUI).to.have.property('statusBar');
});
