import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App.tsx';
import { ErrorBoundary } from '@/components/ErrorBoundary.tsx';
import '@/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <ErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </ErrorBoundary>,
);
