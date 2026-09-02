import { QueryClient } from '@tanstack/react-query'

/**
 * Настройки под приложение, где источник свежести — поток событий, а не опрос.
 * Поэтому: без перезапроса по фокусу окна и с одной повторной попыткой — сетевой
 * сбой бывает разовым, а зацикливаться на упавшем API смысла нет.
 */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  })

export const queryClient = createQueryClient()
