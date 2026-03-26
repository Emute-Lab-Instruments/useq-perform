import { defineScenario } from '../../framework/scenario';

export default defineScenario({
  category: 'Examples',
  name: 'Hello World',
  type: 'canary',
  sourceFiles: [],
  description: 'A minimal example scenario to verify the framework works.',
  component: {
    component: () => {
      const el = document.createElement('div');
      el.textContent = 'Hello from Inspector!';
      el.style.padding = '2rem';
      el.style.fontSize = '1.5rem';
      return el;
    },
  },
});
