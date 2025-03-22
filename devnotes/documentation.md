# Overview

The editor should have built-in documentation that's easily accessible and can be used to quickly find functions and code examples.

## Features

- [ ] A `Documentation` button in the button toolbar that opens the documentation panel. Use an appropriate Lucide icon.
- [ ] It opens on the right of the screen by default (like the help panel), but it has a button in the top left corner to expand to the center and fill most of the screen (again like the help panel).
- [ ] By default, it shows an unfiltered vertical & scrollable list of all the functions in alphabetical order - just their names, so that they don't take up a ton of space.
- [ ] Each function name can be clicked to expand and show its full description and example code snippets.
- [ ] each example is also tagged - some example tags are `maths`, `sequencing` (e.g. from-list, triggers, gates, euclidean and so on), `lists`, timing, inputs, outputs, system, playback (e.g. starting, stopping, rewinding time etc.), scheduling, randomness, functional programming, evaluation control (do, for, if etc.) - feel free to add more.
- [ ] multiple tags can be selected and the list of functions gets filtered by their union.
- [ ] functions can be "starred" - added to favourites.
- [ ] (advanced & optional) when you're on a function symbol, you should be able to press a key binding (say, alt-f) which opens the built-in documentation with that function expanded (if it exists).

## AI Implementation notes

- You will find the current implementation documents, taken straight from our website, inside ./local/documentation. 
- They each contain hints about how each function should be tagged, but don't be afraid to add your own tags if you think they're more appropriate.
- It might be helpful if you extract all of the functions from there and you move them all into one file.
- You can write and execute scripts to help you find and manipulate the existing documentation, if you'd like.
- Feel free to expand on the documentation notes for functions that don't have much going on, or to add more examples. 
- The syntax of the language we're using is very similar to Clojure, but the semantics are somewhat different - we don't have immutability by default etc.