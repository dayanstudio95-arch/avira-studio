import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import AppErrorBoundary from '@/components/system/AppErrorBoundary'
import { installStaleBundleReload } from '@/lib/staleBundle'
import '@/index.css'

// UX-02: after a deploy, reload once instead of showing a white screen.
installStaleBundleReload()

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
)
