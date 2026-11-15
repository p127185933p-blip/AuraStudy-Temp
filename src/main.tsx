import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from '@/app';
import { initializeTheme } from '@/shared/utils';
import App from './App.tsx';
import './index.css';

initializeTheme();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(<App />);
