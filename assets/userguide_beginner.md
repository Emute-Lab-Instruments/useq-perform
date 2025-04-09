# uSEQ Beginner User's Guide

Welcome to the world of livecoding in your modular system! This guide will help you get started with uSEQ and walk you through some cool signals with just a few lines of code.

## Table of Contents

- [uSEQ Beginner User's Guide](#useq-beginner-users-guide)
  - [Table of Contents](#table-of-contents)
  - [What is uSEQ?](#what-is-useq)
  - [Getting Connected](#getting-connected)
  - [The Basics](#the-basics)
    - [Understanding the Interface](#understanding-the-interface)
    - [How Code Works on uSEQ](#how-code-works-on-useq)
  - [Your First Signals](#your-first-signals)
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
- Code is organised inside parentheses: `(+ 1 2 3)`.
- The first word inside the parentheses (`+`) is usually the 'verb' (aka 'function'), i.e. the operation that you want the code to perform.
- The other items (`1 2 3`) are the parameters, i.e. _how_ you want to do it or what you want to do it _on/with_.
- To run a chunk of code, place your cursor anywhere inside of it and press **Ctrl+Enter**. You will see a little flash that signals the exact bit of code that was executed; if it's grey, that means that the module isn't connected yet, and if it's yellow it means that the code was successfully sent to the module.
- To schedule code to run at the start of the next bar, use **Alt+Enter** instead - this can be useful for quantizing code changes so that they happen at a specific moment in time.

## Your First Signals

### Making a Square Wave

Let's start with something simple: a flashing LED and a square wave output.

<div class="codeblock">
(d1 (sqr bar))
</div>

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
(def my-signal (sin (* 2 PI t)))            ; A sine wave at 1Hz

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

- If the connection fails, try refreshing the page.
- On Linux/Unix systems, you might need to adjust permissions (see: https://support.arduino.cc/hc/en-us/articles/360016495679-Fix-port-access-on-Linux).
- If code isn't working as expected, check your brackets - they must be balanced! The editor tries its best to help you keep them balanced at all times, but sometimes things can go wrong. Use the matching brackets highlighting to help you understand what's going on.
- Join our Discord for help: https://discord.gg/TQMNfp6GJ9.

## Going Further

Once you're comfortable with the basics, you can:

- Create complex multi-track sequences by running multiple lines of code.
- Process incoming CV using the `cv1` and `cv2` variables.
- Create conditional logic with `if` statements.
- Start building your arsenal of little functions that you can reuse and build upon.
- Check out the full API documentation to see all available functions.
  