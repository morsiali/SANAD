import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LangProvider } from './lib/lang';
import { applyDocument } from './lib/i18n';
import { applyDisplay } from './lib/display';
import { installErrorReporting } from './lib/errors';
import './styles.css';

applyDocument();
applyDisplay();
installErrorReporting();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
);
