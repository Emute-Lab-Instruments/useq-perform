import {tags as t} from '@lezer/highlight';
import {createTheme} from '../createTheme.mjs';

// Author: TextMate
export const espresso = {
	name: 'Espresso',
	variant: 'light',
	settings: {
		background: '#FFFFFF',
		foreground: '#000000',
		caret: '#000000',
		selection: '#80C7FF',
		gutterBackground: '#FFFFFF',
		gutterForeground: '#00000070',
		lineHighlight: '#C1E2F8',
		accentColor: '#2F6F9F',
	},
	styles: [
		{
			tag: t.comment,
			color: '#AAAAAA',
		},
		{
			tag: [t.keyword, t.operator, t.typeName, t.tagName, t.propertyName],
			color: '#2F6F9F',
			fontWeight: 'bold',
		},
		{
			tag: [t.attributeName, t.definition(t.propertyName)],
			color: '#4F9FD0',
		},
		{
			tag: [t.className, t.string, t.special(t.brace)],
			color: '#CF4F5F',
		},
		{
			tag: t.number,
			color: '#CF4F5F',
			fontWeight: 'bold',
		},
		{
			tag: t.variableName,
			fontWeight: 'bold',
		},
	],
};
