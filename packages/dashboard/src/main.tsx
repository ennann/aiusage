import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { EmbedApp } from './embed/embed-app';
import { Layout } from './components/layout';
import { PricingPage } from './pages/pricing-page';
import { EmbedDocsPage } from './pages/embed-docs-page';
import './styles.css';

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

const path = window.location.pathname;
const isEmbed = path.startsWith('/embed') && !path.startsWith('/embed/docs');

function Page() {
  if (isEmbed) return <EmbedApp />;
  if (path === '/pricing') return <Layout><PricingPage /></Layout>;
  if (path === '/embed/docs') return <Layout><EmbedDocsPage /></Layout>;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
