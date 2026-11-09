import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TrackingApp from './TrackingApp'
import './tracking.css'

createRoot(document.getElementById('root')!).render(<StrictMode><TrackingApp /></StrictMode>)
