import '@fontsource-variable/inter'
// Стили React Flow идут до токенов: дальше мы переопределяем его переменные --xy-*
// своими, и наш каскад должен быть последним.
import '@xyflow/react/dist/style.css'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/global.css'
import './styles/react-flow.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'

const container = document.getElementById('root')
if (!container) throw new Error('Не найден корневой элемент #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
