# uSEQ User Guide

Welcome to the world of livecoding in your modular system! This guide will help you get started with uSEQ and show you how to make some cool sounds with just a few lines of code.

## Table of Contents

- [uSEQ User Guide](#useq-user-guide)
  - [Table of Contents](#table-of-contents)
  - [What is uSEQ?](#what-is-useq)
  - [Getting Connected](#getting-connected)
  - [The Basics](#the-basics)
    - [Understanding the Interface](#understanding-the-interface)
    - [How Code Works on uSEQ](#how-code-works-on-useq)
  - [Your First Sounds](#your-first-sounds)
    - [Making a Square Wave](#making-a-square-wave)
    - [Creating Rhythms](#creating-rhythms)
    - [Adding Modulation](#adding-modulation)
  - [What is uSEQ?](#what-is-useq-1)
  - [Core ModuLisp Concepts](#core-modulisp-concepts)
    - [Working with Time](#working-with-time)
    - [Creating Expressions for Outputs](#creating-expressions-for-outputs)
  - [Working with the Editor](#working-with-the-editor)
    - [Saving and Loading Code](#saving-and-loading-code)
    - [Keyboard Shortcuts](#keyboard-shortcuts)
    - [Structural Editing](#structural-editing)
  - [Common Functions](#common-functions)
  - [Tips and Tricks](#tips-and-tricks)
  - [Troubleshooting](#troubleshooting)
  - [Going Further](#going-further)
  - [Advanced Concepts](#advanced-concepts)
    - [Understanding Time in ModuLisp](#understanding-time-in-modulisp)
    - [Temporal Control Functions](#temporal-control-functions)
      - [eval-at-time](#eval-at-time)
      - [offset, fast, and slow](#offset-fast-and-slow)
    - [Creating Predictable Randomness](#creating-predictable-randomness)
    - [The ModuLisp Architecture](#the-modulisp-architecture)

## What is uSEQ?

uSEQ is your gateway to creative coding inside your eurorack system. It's a flexible control-rate voltage generator and processor that you can control through simple code. Instead of being locked into a specific function, uSEQ lets you decide exactly how it should behave by writing small bits of code.

The module features:
- 2 CV inputs with attenuverters
- 2 pulse inputs
- 3 CV (aka 'analog') outputs
- 3 pulse (aka 'digital)' outputs
- A momentary switch and three-way toggle switch
- A live coding language called `ModuLisp` that's designed specifically for sequencing and modulating

Whether you want to create complex rhythms, generate waveforms, or process incoming signals in unusual ways, uSEQ has you covered.

## Getting Connected

Getting started with uSEQ is easy:

1. Connect your uSEQ module to your computer using a USB cable
2. Open the editor at https://useq.emutelabinstruments.co.uk/ (or use the embedded editor on this site)
3. Click the "Connect" button in the corner of the editor
4. Select your uSEQ device from the list (it's usually at the top and might have "rp2040" in the name)

That's it! Once connected, the editor will show you're ready to start coding.

## The Basics

### Understanding the Interface

Your uSEQ module has several parts:
- **CV Outputs (a1, a2, a3)**: These output continuous voltage signals (-5V to +5V)
- **Pulse Outputs (d1, d2, d3)**: These output gates/triggers (0V or +5V)
- **CV Inputs (cv1, cv2)**: These receive external voltage with attenuverters to control the level
- **Pulse Inputs (p1, p2)**: These receive external gate or trigger signals
- **Controls**: A momentary button and a three-way toggle switch for hands-on interaction

### How Code Works on uSEQ

uSEQ uses a streamlined version of the classic LISP programming language called ModuLISP, that's designed specifically for music. Don't worry if you've never coded before - no programming experience required to make beats!

Some key things to know:
- Code is written inside parentheses: `(+ 1 2 3)`.
- The first word inside the parentheses (`+`) is usually the 'verb' (aka 'function'), i.e. what you want to do.
- The other items (`1 2 3`) are the parameters, i.e. _how_ you want to do it or what you want to do it _on/with_.
- To run a line of code, place your cursor anywhere inside the parentheses and press **Ctrl+Enter**. You will see a little flash that signals the exact bit of code that was executed; if it's grey, that means that the module isn't connected yet.
- To schedule code to run at the start of the next bar, use **Alt+Enter** instead

## Your First Sounds

### Making a Square Wave

Let's start with something simple - a flashing LED and a square wave output:

```lisp
(d1 (sqr bar))
```

Put your cursor inside the parentheses and hit **Ctrl+Enter**. You should see the blue LED next to output d1 start flashing once per bar. If you patch d1 into a trigger input on another module (like an envelope generator), you'll have a steady pulse going.

What's happening here? You're telling output `d1` to output a square wave (`sqr`) that cycles at the rate of `bar` (which is a built-in timing reference).

### Creating Rhythms

Want to make a more interesting rhythm? Try this:

```lisp
(d3 (seq [1 0 0 1 1 0 1 0] bar))
```

This creates a rhythmic pattern on output d3. The `seq` function takes a list of values (`[1 0 0 1 1 0 1 0]`) and cycles through them at the rate of `bar`. Each `1` sends out a trigger, and each `0` stays silent.

Try changing the pattern by editing the numbers in the list. For example:

```lisp
(d3 (seq [1 1 0 0 1 0 1 1] bar))
```

Want your rhythm to play faster? Use the `fast` function:

```lisp
(d3 (seq [1 0 0 1 1 0 1 0] (fast 2 bar)))
```

This plays the rhythm twice as fast. Try different numbers instead of `2` to change the speed.

### Adding Modulation

Now let's add some continuous voltage modulation on output a1:

```lisp
(a1 (interp '(1 0.5 0 0.6 1) bar))
```

This creates a voltage that moves through the list of values over the course of one bar. The values range from -5V (0) to +5V (1), so this creates a varying voltage that could control an oscillator's pitch, a filter cutoff, or anything else that takes CV.

Try connecting a1 to your oscillator's pitch input and hear how it creates a simple melody!



## What is uSEQ?

uSEQ is a eurorack module that brings livecoding into your modular system. It's an extremely flexible voltage generator and processor with a LISP-based coding engine called ModuLisp. The module features:

- 2 CV inputs with attenuverters
- 2 pulse inputs
- 3 CV outputs (a1, a2, a3)
- 3 pulse outputs (d1, d2, d3)
- A momentary switch and three-way toggle switch
- A powerful, time-aware functional language environment

The uSEQ firmware consists of three core components:
1. An expression for each output that's repeatedly evaluated
2. An interpreter/VM for evaluating those expressions
3. An update loop that reads hardware inputs, evaluates output expressions, and updates hardware outputs

## Core ModuLisp Concepts

The ModuLisp language is designed around a few key principles:

1. **Meta-temporality** - time is a first-class concept in the language
2. **Functional programming** - expressions return values without side effects
3. **Predictable signals** - behavior can be analyzed and understood in advance

The key to understanding ModuLisp is that everything revolves around the variable `t`, which represents the current time in seconds. All timing functions are derived from this fundamental value.

### Working with Time

Time-bending functions form the core of ModuLisp's power:

```lisp
;; Examples of time manipulation
(def my-signal (sin (* 2 Math/PI t)))            ; A sine wave at 1Hz

;; Time-shifting with offset (delay/advance by 0.5 seconds)
(a1 (+ my-signal (offset 0.5 my-signal)))        ; Echo effect

;; Speed up or slow down time
(a2 (fast 2 my-signal))                          ; Twice as fast
(a3 (slow 2 my-signal))                          ; Half speed
```

### Creating Expressions for Outputs

Each output needs an expression that will be evaluated repeatedly during the update loop:

```lisp
;; Set up expressions for different outputs
(a1 (scale (sin (fast 4 bar)) 0 1 -3 3))         ; Modulation voltage
(d1 (> (sin (* 4 bar)) 0.2))                     ; Rhythmic trigger
(a2 (interp (seq [0 0.3 0.7 1] bar) (saw bar)))  ; Stepped voltage
```

</div>

<div id="shared-content">

## Working with the Editor

### Saving and Loading Code

Your code is automatically saved in your browser's local storage, but you can also save it to your computer:

- Click the "Save" button to download your code as a file
- Click "Load" to open a previously saved file

### Keyboard Shortcuts

Press **Alt+H** to see all available keyboard shortcuts. Some useful ones:

- **Ctrl+Enter**: Run the current expression immediately
- **Alt+Enter**: Run the current expression at the start of the next bar
- **Ctrl+S**: Save your code

### Structural Editing

The editor uses something called "structural editing" which helps you write valid code by handling brackets automatically. It might feel a bit strange at first, but it prevents a lot of errors!

Some useful structural editing commands:
- **Alt+Right/Left**: Move code in and out of brackets ("slurp" and "barf")
- **Alt+S**: Splice - remove surrounding brackets while keeping content
- **Alt+Up/Down**: Move up or down through code structure

If you ever get confused with brackets, you can always select and delete text normally.

## Common Functions

Here are some functions you'll use a lot:

- `sqr` - Square wave (values alternate between 0 and 1)
- `sin` - Sine wave (smooth oscillation between 0 and 1)
- `tri` - Triangle wave (ramps up, then down between 0 and 1)
- `saw` - Sawtooth wave (ramps up then resets between 0 and 1)
- `seq` - Create rhythmic sequences from lists of values
- `interp` - Smoothly interpolate between a list of values
- `fast` - Speed up a timing function
- `slow` - Slow down a timing function
- `scale` - Scale a value to a different range
- `offset` - Shift a signal forward or backward in time

## Tips and Tricks

- You can run multiple lines of code to control different outputs at the same time
- Use the `bar` variable to keep everything in sync
- Try `rnd` for random values (example: `(a2 (rnd))`)
- Combine functions: `(a1 (scale (sin (fast 4 bar)) 0 1 -3 3))`
- Use the momentary button with `(btn)` in your code

## Troubleshooting

If you're having trouble:

- If the connection fails, try refreshing the page
- On Linux/Unix systems, you might need to adjust permissions (see: https://support.arduino.cc/hc/en-us/articles/360016495679-Fix-port-access-on-Linux)
- If code isn't working as expected, check your brackets - they must be balanced
- Join our Discord for help: https://discord.gg/TQMNfp6GJ9

## Going Further

Once you're comfortable with the basics, you can:

- Create complex multi-track sequences by running multiple lines of code
- Process incoming CV using the `cv1` and `cv2` variables
- Create conditional logic with `if` statements
- Define your own functions for reuse
- Check out the full API documentation to see all available functions

</div>

<div id="advanced-content-continued" style="display: none;">

## Advanced Concepts

### Understanding Time in ModuLisp

At the core of uSEQ's timing model is the variable `t`. It represents the flow of time in seconds since the module was turned on (or since the last time reset). This variable is automatically updated at the beginning of each tick using the microcontroller's hardware clock. 

From `t`, other built-in variables like `beat` and `bar` are derived. These provide convenient reference points for musical timing:

```lisp
;; t represents absolute time in seconds
;; beat is derived from t based on the current BPM
;; bar is derived from beat (usually 4 beats = 1 bar)

(def bar-num (floor (/ t barDur)))  ; Count how many bars have elapsed
```

### Temporal Control Functions

ModuLisp provides powerful functions for manipulating time:

#### eval-at-time

This function evaluates an expression as if time were at a specific point:

```lisp
(eval-at-time 999 (+ 1 2))       ; => 3
(eval-at-time 999 t)             ; => 999
(eval-at-time 999 (+ t 1))       ; => 1000
```

#### offset, fast, and slow

These functions are relative to the context in which they're evaluated:

```lisp
(eval-at-time 5 (fast 2 (+ t 1)))          ; => 11
(eval-at-time 5 (fast 2 (fast 2 (+ t 1)))) ; => 21
(eval-at-time 5 (offset 1 (offset 1 t)))   ; => 7
```

### Creating Predictable Randomness

ModuLisp uses indexed randomness for creating sequences that are random-seeming but predictable and repeatable:

```lisp
;; A helper signal that tracks bar count
(def bar-num (floor (/ t barDur)))

;; Create a "random" chord progression that changes each bar
(def chord (from-list ["Am", "Cm", "E"] (ind-rand 0 bar-num)))
```

The `ind-rand` function takes a seed and an index, returning a consistent "random" number for the same combination:

```lisp
(ind-rand 1234      5)      ; => 0.2435
(ind-rand 1234.0001 5)      ; => 0.8924
(ind-rand 1234      5.0001) ; => 0.3259
```

This approach enables:
- Predictable but seemingly random sequences
- The ability to change the seed to get completely different patterns
- The possibility to visualize future events before they happen

### The ModuLisp Architecture

ModuLisp currently runs on a tree-walking interpreter but is planned to migrate to a bytecode VM with JIT compilation for better performance. The purely-functional approach enables advanced optimizations that wouldn't be possible with a more imperative approach.

Benefits of this architecture:
- Better performance through optimization
- Code analysis for visualizing future states
- Composability of signals and timing functions

</div>

