export const SAMPLE_CODE = `(do
  (set-bpm 120)
  (set-time-sig 4 4)

  (def speed (from-list [3 3 6 8 9 8 3] (slow 2 bar)))
  (def mel (interp [0.2 0.5 0.8 0.3 0.6] (fast speed bar)))

  ;; CV outs
  (a1 (sin (fast 8 bar)))
  (a2 (* mel (tri 0.3 bar)))
  (a3 (scale 0 1 0.2 0.8
         (+ (* 0.5 (sin (fast 4 bar)))
            (* 0.5 (tri bar)))))

  ;; gate outs
  (d1 (sqr beat))
  (d2 (euclid 7 16 bar))
  (d3 (gates [1 0 1 1 0 1 0 1] 0.3 bar)))`;
