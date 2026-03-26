import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Editor Decorations / Eval Highlight',
  name: 'Connected mode (yellow flash)',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/evalHighlight.ts',
  ],
  description: 'When the device is connected and the user evaluates code, the top-level expression containing the cursor receives a yellow background flash (cm-evaluated-code decoration) that fades out over 1 second via CSS animation. The first expression (sine 440) should show the yellow highlight.',
  editor: {
    editorContent: '(sine 440)\n(tri 220)',
    cursorPosition: 1, // inside (sine 440)
  },
});
