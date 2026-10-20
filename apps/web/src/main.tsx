import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { applyTheme } from './ui/theme/tokens';
import './ui/theme/app.css';

/** Web client entry point. The OS appearance applies until the user's saved theme loads. */
applyTheme('system');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
