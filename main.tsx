import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { RouterProvider } from './lib/router';
import './index.css';

const PUBLISHABLE_KEY =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY) ||
  'pk_test_sample_clerk_publishable_key';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <LanguageProvider>
        <RouterProvider>
          <App />
        </RouterProvider>
      </LanguageProvider>
    </ClerkProvider>
  </StrictMode>,
);
