import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { EmbedApp } from './embed/embed-app';
import './styles.css';

const isEmbed = window.location.pathname.startsWith('/embed') && !window.location.pathname.startsWith('/embed/docs');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isEmbed ? <EmbedApp /> : <App />}
  </React.StrictMode>,
);
