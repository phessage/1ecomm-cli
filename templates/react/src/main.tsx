import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initDtBehaviors } from '@1ecomm/dt-ui-core';
import App from './App';
import './index.css';

// dt-ui's interactive components (menus, dialogs, disclosures) are wired once at
// bootstrap. It is idempotent, safe after a route change, and backed by a
// MutationObserver, which is what lets one implementation serve every framework.
initDtBehaviors();

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
