export const defaultFontSize = 16;
export const defaultTheme = 'uSEQ Dark';

// export const defaultEditorStartingCode = Array(100).fill("\n").join("");

const defaultCode =
`(do
  (a1 (slow 2 bar))
  (a2 (slow 3 bar))
  (a3 (pow 2 (slow 4 bar)))
  ;;gates
  (d1 (sqr bar))
  (d2 (* (sqr bar)
        (sqr (slow 4 bar))))
  (d3 (euclid 16 7 bar)))`;

export const defaultThemeEditorStartingCode = 
`(do
  ;; CV outs
  (a1 beat) :keywords
  (a2 (slow 2 beat)) "this is a string"
  (a3 (slow ([3 3 6 8 9 8 3] (slow 2 bar)) beat))
  ;; Gate outs
  (d1 (sqr beat))
  (d2 (sqr (fast 2 beat)))
  (d3 (sqr (fast 3 beat))))`;

export const defaultMainEditorStartingCode = `${defaultCode}${Array(91).fill('\n').join('')}`;