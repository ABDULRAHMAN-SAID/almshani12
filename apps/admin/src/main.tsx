import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider, ConfirmProvider } from './ui';
import './styles.css';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={qc}><BrowserRouter basename="/admin"><ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
