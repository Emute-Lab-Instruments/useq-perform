export const defaultFontSize = 16;
export const defaultTheme = 'uSEQ Dark';

// export const defaultEditorStartingCode = Array(100).fill("\n").join("");

export const defaultThemeEditorStartingCode = 
`(do
  ;; CV outs
  (a1 beat)
  (a2 (slow 2 beat))
  (a3 (slow 3 beat))
  ;; Gate outs
  (d1 (sqr beat))
  (d2 (sqr (fast 2 beat)))
  (d3 (sqr (fast 3 beat))))`;

export const defaultMainEditorStartingCode = `${defaultThemeEditorStartingCode}${Array(91).fill('\n').join('')}`;