import './vertex-ai-proxy-interceptor.js';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

// Guard against Vite HMR calling createRoot twice
if (!(rootElement as any).__reactRoot) {
    const root = ReactDOM.createRoot(rootElement);
    (rootElement as any).__reactRoot = root;
}

(rootElement as any).__reactRoot.render(<App />);
