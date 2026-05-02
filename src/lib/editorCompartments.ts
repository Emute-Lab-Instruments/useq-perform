import { Compartment, Extension } from '@codemirror/state';

// Create compartments for theme and font size
export const themeCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();

export const stateExtensions: Extension[] = [];
