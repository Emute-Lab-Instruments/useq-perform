import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const sampleCode = `; ModuLisp sample for theme comparison
(define lfo (sine 0.25))
(define env (ar 0.01 0.3))

a1 (sine (* 55 (+ 1 (* lfo 0.5))))
a2 (* env (tri 110))

d1 (> (phase 2) 0.5)

; string and number literals
(define name "useq")
(define pi 3.14159)`;

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Themes',
  tags: ['autodocs'],
  component: ScenarioEditor,
  args: {
    editorContent: sampleCode,
    readOnly: true,
  },
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const UseqDark: Story = { args: { theme: 'uSEQ Dark' } };
export const Useq1337: Story = { args: { theme: 'uSEQ 1337' } };
export const Amy: Story = { args: { theme: 'Amy' } };
export const AyuLight: Story = { args: { theme: 'Ayu Light' } };
export const Bespin: Story = { args: { theme: 'Bespin' } };
export const BirdsOfParadise: Story = { args: { theme: 'Birds of Paradise' } };
export const Clouds: Story = { args: { theme: 'Clouds' } };
export const Cobalt: Story = { args: { theme: 'Cobalt' } };
export const CoolGlow: Story = { args: { theme: 'Cool Glow' } };
export const Dracula: Story = { args: { theme: 'Dracula' } };
export const Espresso: Story = { args: { theme: 'Espresso' } };
export const NightLights: Story = { args: { theme: 'Night Lights' } };
export const NoctisLilac: Story = { args: { theme: 'Noctis Lilac' } };
export const RosePineDawn: Story = { args: { theme: 'Rosé Pine Dawn' } };
export const Smoothy: Story = { args: { theme: 'Smoothy' } };
export const SolarizedLight: Story = { args: { theme: 'Solarized Light' } };
export const Tomorrow: Story = { args: { theme: 'Tomorrow' } };

const darkVsLightCode = `(define lfo (sine 0.5))
(tri (* lfo 200) 0.7)`;

export const DarkVsLight: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1rem' }}>
      <ScenarioEditor editorContent={darkVsLightCode} theme="uSEQ Dark" readOnly={true} />
      <ScenarioEditor editorContent={darkVsLightCode} theme="Solarized Light" readOnly={true} />
    </div>
  ),
};
