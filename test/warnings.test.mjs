import './setup.mjs';
import { expect } from 'chai';
import { createApp } from '../src/runtime/appLifecycle.ts';
import { resolveBootstrapPlan } from '../src/runtime/bootstrap.ts';
import {
  transitionRuntimeCoordinator,
} from '../src/runtime/runtimeCoordinator.ts';

var defaultEnvironmentState = {
  areInBrowser: true,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
  isInDevmode: false,
  userSettings: { name: 'Test User', wasm: { enabled: true }, runtime: { startLocallyWithoutHardware: true } },
  startupFlags: { noModuleMode: false },
  urlParams: {}
};

describe('Warnings', () => {
    it('starts browser-local runtime by default when webserial is unavailable', async () => {
        let environmentState = {
            ...defaultEnvironmentState,
            isWebSerialAvailable: false
        };
        let plan = resolveBootstrapPlan({
            noModuleMode: false,
            isWebSerialAvailable: false,
            wasmEnabled: true,
            startLocallyWithoutHardware: true,
        });

        const workerPort = new Proxy({
          kind: 'wasm-runtime',
          capabilities: () => ({ available: true, enabled: true, loaded: true }),
          ensureLoaded: async () => {},
          sendTransportCommand: async () => {},
          syncTransportState: async () => {},
          setHwInputValue: async () => {},
          setFailureMode: async () => true,
        }, {
          get(target, property) {
            if (property in target) return target[property];
            return async () => undefined;
          },
        });
        transitionRuntimeCoordinator({ type: 'select-wasm-port', port: workerPort });

        let app = createApp(null, environmentState, plan);
        try {
          await app.start();
        } finally {
          await app.stop();
          transitionRuntimeCoordinator({ type: 'select-wasm-port', port: null });
        }

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
        let plan = resolveBootstrapPlan({
            noModuleMode: false,
            isWebSerialAvailable: false,
            wasmEnabled: false,
            startLocallyWithoutHardware: true,
        });

        let app = createApp(null, environmentState, plan);
        await app.start();

        expect(app.modals).to.have.property('webserialWarning');
    });
});
