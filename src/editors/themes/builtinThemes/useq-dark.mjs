import { tags as t } from '@lezer/highlight';
import { createTheme } from '../createTheme.mjs';

export const useqDark = {
  name: 'uSEQ Dark',
  variant: 'dark',
  settings: {
    background: '#0C1710',
    foreground: '#00FF41',
    caret: '#00FF41',
    selection: '#00FF4133',
    gutterBackground: '#0C1710',
    gutterForeground: '#00FF4180',
    lineHighlight: '#00FF411A',
  },
  styles: [
    { 
      tag: t.comment,
      color: '#267F45',
    },
    {
      tag: [t.string, t.special(t.brace), t.regexp],
      color: '#00FF85',
    },
    {
      tag: [
        t.className,
        t.definition(t.propertyName),
        t.function(t.variableName),
        t.function(t.definition(t.variableName)),
        t.definition(t.typeName),
      ],
      color: '#39FF14',
    },
    {
      tag: [t.number, t.bool, t.null],
      color: '#04D939',
    },
    {
      tag: [t.keyword, t.operator],
      color: '#00FF41',
    },
    {
      tag: [t.definitionKeyword, t.modifier],
      color: '#50C878',
    },
    {
      tag: [t.variableName, t.self],
      color: '#98FF98',
    },
    {
      tag: [t.angleBracket, t.tagName, t.typeName, t.propertyName],
      color: '#32CD32',
    },
    {
      tag: t.derefOperator,
      color: '#90EE90',
    },
    {
      tag: t.attributeName,
      color: '#98FB98',
    },
  ],
};