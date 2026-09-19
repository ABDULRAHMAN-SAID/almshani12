import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { colors } from '@manassah/tokens';
import App from './App';
import { ToastProvider, ConfirmProvider, RootErrorBoundary } from './ui';
import './styles.css';

/** ألوان اللوحة تُشتق من رموز المنصّة نفسها (@manassah/tokens) لا لوحة منفصلة — نفس الهوية في التطبيق ولوحة الإدارة */
const root = document.documentElement.style;
root.setProperty('--bg', colors.bg.base); root.setProperty('--bg-2', colors.bg.subtle); root.setProperty('--card', colors.bg.card);
root.setProperty('--primary', colors.brand.primary); root.setProperty('--primary-dark', colors.brand.primaryDark); root.setProperty('--primary-soft', colors.brand.primarySoft);
root.setProperty('--gold', colors.brand.gold); root.setProperty('--gold-soft', colors.brand.goldSoft);
root.setProperty('--text', colors.text.primary); root.setProperty('--text-2', colors.text.secondary); root.setProperty('--text-3', colors.text.tertiary); root.setProperty('--link', colors.text.link);
root.setProperty('--success', colors.state.success); root.setProperty('--success-soft', colors.state.successSoft);
root.setProperty('--info', colors.state.info); root.setProperty('--info-soft', colors.state.infoSoft);
root.setProperty('--warning', colors.state.warningText); root.setProperty('--warning-soft', colors.state.warningSoft);
root.setProperty('--danger', colors.state.danger); root.setProperty('--danger-soft', colors.state.dangerSoft);
root.setProperty('--border', colors.border.default); root.setProperty('--border-2', colors.border.strong);
root.setProperty('--chart-1', colors.brand.primary); root.setProperty('--chart-2', colors.state.info);

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RootErrorBoundary><QueryClientProvider client={qc}><BrowserRouter basename="/admin"><ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider></BrowserRouter></QueryClientProvider></RootErrorBoundary></React.StrictMode>,
);
