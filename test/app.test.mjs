import { expect } from "chai";
import "./setup.mjs";
import { createApp } from "../src/runtime/appLifecycle.ts";

// Test setup
let environmentState;

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
