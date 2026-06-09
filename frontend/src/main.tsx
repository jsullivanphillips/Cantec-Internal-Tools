import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import 'bootstrap/dist/css/bootstrap.min.css'
import './styles/bootstrap-icons-overrides.css'
import './index.css'
import './styles/base.css'
import './styles/legacy-global.css'
import './styles/run-details-prepare.css'
import './styles/run-details-history.css'
import { router } from './router'
import { registerCharts } from './lib/chartRegister'
import { registerPortalServiceWorkerIfNeeded } from './lib/registerPortalServiceWorker'

registerCharts()
registerPortalServiceWorkerIfNeeded()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
