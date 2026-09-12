import { createApp } from 'vue';
import { initDtBehaviors } from '@1ecomm/dt-ui-core';
import App from './App.vue';
import { router } from './router';
import './index.css';

// dt-ui's interactive components are wired once at bootstrap. Idempotent, safe
// after a route change, and backed by a MutationObserver — which is what lets
// one implementation serve every framework.
initDtBehaviors();

import { start } from './store';

const app = createApp(App).use(router);
app.mount('#app');

// Bootstrap AFTER mount so the loading state is what the shopper sees first,
// rather than a blank page while the platform is asked who this store is.
void start();
