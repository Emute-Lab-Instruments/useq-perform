export const defaultFontSize = 16;
export const defaultTheme = 'uSEQ Dark';

// export const defaultEditorStartingCode = Array(100).fill("\n").join("");

export const defaultEditorStartingCode = 
`(do 
    (a1 beat))
    (a2 (slow 2 beat))
    (a3 (slow 3 beat))
    (d1 (sqr beat))
    (d2 (sqr (fast 2 beat)))
    (d3 (sqr (fast 3 beat)))
${Array(94).fill('\n').join('')}`;