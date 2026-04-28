import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  FluentProvider,
  webLightTheme,
} from '@fluentui/react-components';
import App from './App';
import './styles/global.css';

/* Office.js initializes the host. We render once Office is ready so
   Word.run is callable from the start. */
Office.onReady(() => {
  const container = document.getElementById('root');
  if (!container) return;
  const root = createRoot(container);
  root.render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>,
  );
});
