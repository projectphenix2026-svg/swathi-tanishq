import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import { LangProvider } from './lib/i18n.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LangProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </LangProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
