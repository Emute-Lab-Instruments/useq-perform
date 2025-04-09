import { tags as t } from '@lezer/highlight';
import { createTheme } from '../createTheme.mjs';

export const uSEQ1337 = {
  name: 'uSEQ 1337',
  variant: 'dark',
  settings: {
    background: '#0C1710',
    foreground: '#00FF41',
    caret: '#00FF41',
    selection: '#00FF4133',
    gutterBackground: '#0C1710',
    gutterForeground: '#00FF4180',
    lineHighlight: '#00FF411A',
    accentColor: '#00FF41',
  },
  styles: [
    { 
      tag: t.comment,
      color: '#267F45', // Dark green for comments
    },
    {
      tag: [t.string, t.special(t.brace), t.regexp],
      color: '#00FF85', // Bright green for strings and regex
    },
    {
      tag: [
        t.className,
        t.definition(t.propertyName),
        t.function(t.variableName),
        t.function(t.definition(t.variableName)),
        t.definition(t.typeName),
      ],
      color: '#39FF14', // Neon green for class names and definitions
    },
    {
      tag: [t.number, t.bool, t.null],
      color: '#04D939', // Medium green for numbers and booleans
    },
    {
      tag: [t.keyword, t.operator],
      color: '#00FF41', // Bright green for keywords and operators
    },
    {
      tag: [t.definitionKeyword, t.modifier],
      color: '#50C878', // Emerald green for definition keywords
    },
    {
      tag: [t.variableName, t.self],
      color: '#98FF98', // Pale green for variables
    },
    {
      tag: [t.angleBracket, t.tagName, t.typeName, t.propertyName],
      color: '#32CD32', // Lime green for tags and type names
    },
    {
      tag: t.derefOperator,
      color: '#90EE90', // Light green for dereference operators
    },
    {
      tag: t.attributeName,
      color: '#98FB98', // Mint green for attribute names
    },
    {
      tag: t.controlKeyword,
      color: '#00FF7F', // Spring green for control keywords
    },
    {
      tag: t.labelName,
      color: '#7FFF00', // Chartreuse for labels
    },
    {
      tag: t.punctuation,
      color: '#66FF66', // Soft green for punctuation
    },
  ],
};