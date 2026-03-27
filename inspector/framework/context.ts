import type { ResolvedScenario } from './scenario';

/**
 * Build a markdown context bundle for a scenario.
 * Includes scenario metadata, source file paths, and scenario config.
 * Source file contents are NOT included (they'd need filesystem access).
 */
export function buildContextBundle(scenario: ResolvedScenario): string {
  const lines: string[] = [];

  lines.push(`## Scenario: ${scenario.name}`);
  lines.push(`Category: ${scenario.category}`);
  lines.push(`Type: ${scenario.type}`);
  lines.push('');

  if (scenario.description) {
    lines.push(scenario.description);
    lines.push('');
  }

  if (scenario.sourceFiles.length > 0) {
    lines.push('### Source Files');
    for (const file of scenario.sourceFiles) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  if (scenario.editor) {
    lines.push('### Editor Setup');
    lines.push('```typescript');
    lines.push(JSON.stringify({
      editorContent: scenario.editor.editorContent,
      ...(scenario.editor.extensions && { extensions: scenario.editor.extensions }),
      ...(scenario.editor.cursorPosition !== undefined && { cursorPosition: scenario.editor.cursorPosition }),
    }, null, 2));
    lines.push('```');
    lines.push('');
  }

  if (scenario.grepTerms && scenario.grepTerms.length > 0) {
    lines.push('### Greppable Terms');
    lines.push('Use these to find the relevant code:');
    for (const term of scenario.grepTerms) {
      lines.push(`- \`${term}\``);
    }
    lines.push('');
  }

  if (scenario.settings) {
    lines.push('### Settings Overrides');
    lines.push('```json');
    lines.push(JSON.stringify(scenario.settings, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Copy a scenario's context bundle to the clipboard.
 * Returns true on success, false on failure.
 */
export async function copyContextToClipboard(scenario: ResolvedScenario): Promise<boolean> {
  const bundle = buildContextBundle(scenario);
  try {
    await navigator.clipboard.writeText(bundle);
    return true;
  } catch {
    return false;
  }
}
