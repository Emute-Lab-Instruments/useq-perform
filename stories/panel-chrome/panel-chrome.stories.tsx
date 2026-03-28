import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DesignSelector } from '@src/ui/panel-chrome/DesignSelector';
import { PanelChrome } from '@src/ui/panel-chrome/PanelChrome';
import { DrawerChrome } from '@src/ui/panel-chrome/DrawerChrome';
import { PaneChrome } from '@src/ui/panel-chrome/PaneChrome';
import { TileChrome } from '@src/ui/panel-chrome/TileChrome';

const meta: Meta = {
  title: 'Panel Chrome',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** Design selector widget with devmode enabled. */
export const DesignSelector_: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
        display: 'flex',
        'align-items': 'flex-end',
        padding: '1rem',
      }}
    >
      <DesignSelector devmode={true} />
    </div>
  ),
};

/** DrawerChrome in default right-aligned state. */
export const DrawerDefault: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
        display: 'flex',
        'justify-content': 'flex-end',
      }}
    >
      <DrawerChrome panelId="inspector-drawer" title="Settings" onClose={() => console.log('[Inspector] close')}>
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Drawer panel content, slides in from the right.</p>
          <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
            Drag the left edge to resize. Click collapse button to minimize to a vertical tab.
          </p>
        </div>
      </DrawerChrome>
    </div>
  ),
};

/** DrawerChrome in collapsed state. */
export const DrawerCollapsed: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
        display: 'flex',
        'justify-content': 'flex-end',
      }}
    >
      <PanelChrome
        design="drawer"
        panelId="inspector-drawer-collapse"
        title="Help"
        onClose={() => console.log('[Inspector] close')}
      >
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Click the collapse button (&laquo;) in the title bar to minimize this drawer to a vertical tab.</p>
          <p>Click the vertical tab to restore the drawer.</p>
        </div>
      </PanelChrome>
    </div>
  ),
};

/** PaneChrome in default state. */
export const PaneDefault: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
      }}
    >
      <PaneChrome panelId="inspector-pane" title="Settings" onClose={() => console.log('[Inspector] close')}>
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Sample panel content rendered inside PaneChrome.</p>
          <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
            Try dragging the title bar to move, edges to resize, or the left-edge button to expand.
          </p>
        </div>
      </PaneChrome>
    </div>
  ),
};

/** PaneChrome in expanded state. */
export const PaneExpanded: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
      }}
    >
      <PanelChrome
        design="pane"
        panelId="inspector-pane-expand"
        title="Help"
        onClose={() => console.log('[Inspector] close')}
      >
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Click the left-edge caret button to toggle expanded mode (90% viewport).</p>
          <p>When expanded, the caret should flip direction.</p>
        </div>
      </PanelChrome>
    </div>
  ),
};

/** TileChrome in right-third default slot. */
export const TileRightThird: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
      }}
    >
      <TileChrome panelId="inspector-tile" title="Settings" onClose={() => console.log('[Inspector] close')}>
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Tile panel in right-third slot.</p>
          <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
            Click the grid button in the title bar to see the layout picker with 6 snap positions.
          </p>
        </div>
      </TileChrome>
    </div>
  ),
};

/** TileChrome in center-large expanded position. */
export const TileCenterLarge: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0f172a',
      }}
    >
      <PanelChrome
        design="tile"
        panelId="inspector-tile-center"
        title="Help"
        onClose={() => console.log('[Inspector] close')}
      >
        <div style={{ padding: '1rem', color: '#a0a0c0' }}>
          <p>Tile panel starting in right-third slot.</p>
          <p>Click the expand button to snap to center-large position.</p>
          <p style={{ opacity: 0.5, 'font-size': '0.85rem' }}>
            Use the layout picker to try all 6 tile positions: right-third, right-half, bottom-half, bottom-right,
            center-large, top-right.
          </p>
        </div>
      </PanelChrome>
    </div>
  ),
};
