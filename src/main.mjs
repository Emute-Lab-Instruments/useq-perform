import { createAppUI } from './ui/ui.mjs';
import { examineEnvironment } from './app/environment.mjs';
import { createApp } from './app/application.mjs';

// Main entry point
$(document).ready(async () => {
  let environmentState = examineEnvironment();
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState);
  await app.start();
});
