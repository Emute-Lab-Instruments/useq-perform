import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createStore } from 'solid-js/store';
import { MidiSettings, type MidiPermissionState } from '@src/ui/settings/MidiSettings';
import type { MidiInputDescriptor } from '@src/contracts/midi';

interface WrapperProps {
  initialPermission: MidiPermissionState;
  initialInputs: MidiInputDescriptor[];
  /**
   * What permission becomes when the user clicks "Request MIDI access" in the
   * story (lets us simulate a granted/denied response without real Web MIDI).
   */
  permissionAfterRequest?: MidiPermissionState;
  inputsAfterRequest?: MidiInputDescriptor[];
}

function MidiSettingsWrapper(props: WrapperProps) {
  const [state, setState] = createStore<{
    permission: MidiPermissionState;
    inputs: MidiInputDescriptor[];
  }>({
    permission: props.initialPermission,
    inputs: props.initialInputs,
  });

  const handleRequestPermission = () => {
    if (props.permissionAfterRequest !== undefined) {
      setState('permission', props.permissionAfterRequest);
    }
    if (props.inputsAfterRequest !== undefined) {
      setState('inputs', props.inputsAfterRequest);
    }
  };

  const handleToggleInput = (id: string, enabled: boolean) => {
    setState('inputs', (inputs) =>
      inputs.map((input) => (input.id === id ? { ...input, enabled } : input)),
    );
  };

  return (
    <div style={{ width: '480px', padding: '16px', background: 'var(--panel-bg, #1a1a1a)' }}>
      <MidiSettings
        permission={state.permission}
        inputs={state.inputs}
        onRequestPermission={handleRequestPermission}
        onToggleInput={handleToggleInput}
      />
    </div>
  );
}

const meta: Meta<typeof MidiSettingsWrapper> = {
  title: 'Settings/Midi',
  tags: ['autodocs'],
  component: MidiSettingsWrapper,
};
export default meta;

type Story = StoryObj<typeof MidiSettingsWrapper>;

const TWO_INPUTS: MidiInputDescriptor[] = [
  {
    id: 'launch-control-xl',
    name: 'Launch Control XL',
    manufacturer: 'Novation',
    state: 'connected',
    enabled: true,
  },
  {
    id: 'mpk-mini',
    name: 'MPK Mini Mk3',
    manufacturer: 'Akai',
    state: 'connected',
    enabled: false,
  },
];

const ONE_DISCONNECTED: MidiInputDescriptor[] = [
  {
    id: 'launch-control-xl',
    name: 'Launch Control XL',
    manufacturer: 'Novation',
    state: 'connected',
    enabled: true,
  },
  {
    id: 'mpk-mini',
    name: 'MPK Mini Mk3',
    manufacturer: 'Akai',
    state: 'disconnected',
    enabled: true,
  },
];

const MIXED_MANY: MidiInputDescriptor[] = [
  {
    id: 'launch-control-xl',
    name: 'Launch Control XL',
    manufacturer: 'Novation',
    state: 'connected',
    enabled: true,
  },
  {
    id: 'mpk-mini',
    name: 'MPK Mini Mk3',
    manufacturer: 'Akai',
    state: 'connected',
    enabled: true,
  },
  {
    id: 'midi-fighter-twister',
    name: 'MIDI Fighter Twister',
    manufacturer: 'DJ TechTools',
    state: 'connected',
    enabled: false,
  },
  {
    id: 'iac-bus-1',
    name: 'IAC Driver Bus 1',
    manufacturer: '',
    state: 'connected',
    enabled: true,
  },
  {
    id: 'launchpad-pro',
    name: 'Launchpad Pro Mk3',
    manufacturer: 'Novation',
    state: 'disconnected',
    enabled: true,
  },
  {
    id: 'old-keystation',
    name: 'Keystation 49 (USB)',
    manufacturer: 'M-Audio',
    state: 'disconnected',
    enabled: false,
  },
];

export const PermissionUnknown: Story = {
  args: {
    initialPermission: 'unknown',
    initialInputs: [],
    permissionAfterRequest: 'granted',
    inputsAfterRequest: TWO_INPUTS,
  },
};

export const PermissionDenied: Story = {
  args: {
    initialPermission: 'denied',
    initialInputs: [],
    permissionAfterRequest: 'denied',
  },
};

export const BrowserUnsupported: Story = {
  args: {
    initialPermission: 'unsupported',
    initialInputs: [],
  },
};

export const GrantedNoDevices: Story = {
  args: {
    initialPermission: 'granted',
    initialInputs: [],
  },
};

export const GrantedTwoDevices: Story = {
  args: {
    initialPermission: 'granted',
    initialInputs: TWO_INPUTS,
  },
};

export const OneDisconnected: Story = {
  args: {
    initialPermission: 'granted',
    initialInputs: ONE_DISCONNECTED,
  },
};

export const MixedManyDevices: Story = {
  args: {
    initialPermission: 'granted',
    initialInputs: MIXED_MANY,
  },
};
