import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
