import { expect } from "chai";
import "./setup.mjs";
import { examineEnvironment } from "../src/app/environment.mjs";
import { createAppUI } from "../src/ui/ui.mjs";
import { createApp } from "../src/app/application.mjs";

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
    // main editor, serialVis, settingsPanel, logConsole, toolbar, statusBar, transportControls
    appUI = await createAppUI(environmentState);
    expect(appUI).to.have.property('mainEditor');
    expect(appUI).to.have.property('serialVis');
    expect(appUI).to.have.property('settingsPanel');
    expect(appUI).to.have.property('helpPanel');
    expect(appUI).to.have.property('logConsole');
    expect(appUI).to.have.property('toolbar');
    expect(appUI).to.have.property('statusBar');
    expect(appUI).to.have.property('transportControls');
});

// toolbar
it('contains the expected keys and methods', async () => {
    // connectionBtn, visBtn, saveBtn, loadBtn, fontDecreaseBtn, fontIncreaseBtn, undoBtn, redoBtn, helpBtn, settingsBtn
    if (!appUI) appUI = await createAppUI(environmentState);
    expect(appUI.toolbar).to.have.property('connectionBtn');
    expect(appUI.toolbar).to.have.property('visBtn');
    expect(appUI.toolbar).to.have.property('saveBtn');
    expect(appUI.toolbar).to.have.property('loadBtn');
    expect(appUI.toolbar).to.have.property('fontDecreaseBtn');
    expect(appUI.toolbar).to.have.property('fontIncreaseBtn');
    expect(appUI.toolbar).to.have.property('undoBtn');
    expect(appUI.toolbar).to.have.property('redoBtn');
    expect(appUI.toolbar).to.have.property('helpBtn');
    expect(appUI.toolbar).to.have.property('settingsBtn');
});

it('has devmode buttons when in devmode', async () => {
    let environmentState = {'isInDevmode': true};
    let appUI = await createAppUI(environmentState);
    expect (appUI.toolbar).to.have.property('devmodeBtn');
});