# Overview

We want to be able to run the expressions in the browser and visualise the "serial" connections directly, without any interop with the module other than syncing clocks and inputs.

## Module's responsibilities

- [ ] providing a `useq-report-current-time` module.
- [ ] send serial updates whenever the input controls change.
- [ ] turn `s1`, `s2` etc. into stubs

## WASM Interpreter's responsibilities

- [ ] `s1`, `s2` etc. are functions that take an expr and set it as the expr for those outputs
- [ ] `d1`, `a1` etc. just set the expr (so that `s1` can read it), but nothing is evaluated
- [ ] provide an `eval_code` method that takes a string from the editor, evals it, and returns nothing.
- [ ] provide an `fill_vis_buffers` function that takes 
  - [ ] 2D pointer, 
  - [ ] numChannels, 
  - [ ] numSamples, 
  - [ ] startTime,
  - [ ] endTime 

## Editor's responsibilities

- [ ] sync clocks with the module regularly
- [ ] open the vis panel on a separate window
- [ ] create and maintain the data buffers (2D array, numChannels x numSamples)
  - [ ] two of them that swap around, a currentBuffer and a nextBuffer
  - the size of the arrays don't change throughout the duration of the program (at least for now)
- [ ] as soon as one buffer is received, ask for the next
- [ ] whenever inputs change, ask for both current and next buffer again
- [ ] maintain two canvases
  - [ ] `plotCanvas` that plots the currently-active buffers once
  - [ ] `timeLineCanvas` that frequently clears and plots the line as it moves through the window
- [ ] whenever the window changes (by the user), redraw everything

### Editor state
```javascript

const numChannels = 8; // s1 through s8
const numSamples = 1024; // change to whatever

let windowDur = 5000; // milliseconds
let windowStart = 0;
let windowEnd = windowStart + windowDur;




```
