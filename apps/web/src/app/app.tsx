import { QueryClientProvider } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { DesignSystemPage } from '@/pages/design-system'
import { EditorPage } from '@/pages/editor'
import { queryClient } from './query-client'

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * Роутера пока нет и он не нужен: страниц две, и вторая — витрина оснований
 * интерфейса, которую держим под рукой для сверки. Полноценный роутинг придёт
 * вместе со страницей `runs`, форму этого файла он не изменит.
 */
export const App = () => {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )

  return (
    <QueryClientProvider client={queryClient}>
      {hash === '#/design-system' ? <DesignSystemPage /> : <EditorPage />}
    </QueryClientProvider>
  )
}
