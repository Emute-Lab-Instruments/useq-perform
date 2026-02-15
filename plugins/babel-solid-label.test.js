import { describe, it, expect } from 'vitest';
import { transformSync } from '@babel/core';

const PLUGIN = './plugins/babel-solid-label.cjs';

function transform(code, opts = {}) {
  const result = transformSync(code, {
    plugins: [
      ['@babel/plugin-syntax-jsx'],
      [PLUGIN, { sourceRoot: '/project', ...opts }],
    ],
    filename: opts.filename || '/project/src/ui/Example.tsx',
    configFile: false,
    babelrc: false,
  });
  return result.code;
}

describe('babel-solid-label', () => {
  it('labels a function declaration component', () => {
    const code = `function MyPanel() { return <div class="panel">hello</div>; }`;
    const out = transform(code);
    expect(out).toContain('data-component="MyPanel"');
    expect(out).toContain('data-source="src/ui/Example.tsx"');
  });

  it('labels an arrow function component', () => {
    const code = `const Sidebar = () => <nav>links</nav>;`;
    const out = transform(code);
    expect(out).toContain('data-component="Sidebar"');
    expect(out).toContain('data-source="src/ui/Example.tsx"');
  });

  it('labels an arrow function with block body', () => {
    const code = `const Card = () => { return <div>card</div>; };`;
    const out = transform(code);
    expect(out).toContain('data-component="Card"');
  });

  it('labels a function expression in const', () => {
    const code = `const Header = function() { return <header>top</header>; };`;
    const out = transform(code);
    expect(out).toContain('data-component="Header"');
  });

  it('handles parenthesized return', () => {
    const code = `function Layout() { return (<div><slot /></div>); }`;
    const out = transform(code);
    expect(out).toContain('data-component="Layout"');
  });

  it('skips fragments', () => {
    const code = `function Modal() { return <><div>overlay</div><div>dialog</div></>; }`;
    const out = transform(code);
    expect(out).not.toContain('data-component');
  });

  it('skips lowercase functions', () => {
    const code = `function helper() { return <div>not a component</div>; }`;
    const out = transform(code);
    expect(out).not.toContain('data-component');
  });

  it('skips Solid built-in root elements', () => {
    const code = `function Wrapper() { return <Show when={true}><div>child</div></Show>; }`;
    const out = transform(code);
    expect(out).not.toContain('data-component');
  });

  it('skips already-labeled elements', () => {
    const code = `function Panel() { return <div data-component="Custom">hi</div>; }`;
    const out = transform(code);
    // Should still have exactly one data-component (the existing one), not a duplicate
    const matches = out.match(/data-component/g);
    expect(matches).toHaveLength(1);
    expect(out).toContain('data-component="Custom"');
    expect(out).not.toContain('data-component="Panel"');
  });

  it('labels multiple components in the same file', () => {
    const code = `
      function Alpha() { return <div>a</div>; }
      const Beta = () => <span>b</span>;
    `;
    const out = transform(code);
    expect(out).toContain('data-component="Alpha"');
    expect(out).toContain('data-component="Beta"');
  });

  it('skips functions that do not return JSX', () => {
    const code = `function GetValue() { return 42; }`;
    const out = transform(code);
    expect(out).not.toContain('data-component');
  });

  it('computes data-source relative to sourceRoot', () => {
    const code = `function Deep() { return <div>deep</div>; }`;
    const out = transform(code, {
      filename: '/project/src/ui/help/HelpPanel.tsx',
    });
    expect(out).toContain('data-source="src/ui/help/HelpPanel.tsx"');
  });
});
