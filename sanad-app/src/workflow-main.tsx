// Standalone build of the workflow map (npm run build:workflow → dist-workflow/workflow.html).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { LangProvider } from './lib/lang';
import { applyDocument } from './lib/i18n';
import { PublicWorkflow } from './pages/Workflow';
import './styles.css';

applyDocument();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <HashRouter>
        <PublicWorkflow standalone />
      </HashRouter>
    </LangProvider>
  </StrictMode>,
);
