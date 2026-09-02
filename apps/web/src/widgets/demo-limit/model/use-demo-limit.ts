import type { DemoQuotaStatus } from '@workflow/contracts'
import { useQuery } from '@tanstack/react-query'
import { fetchHealth, healthQueryKey } from '../api/health-api'

/**
 * Раз в минуту: квота тратится генерациями, а не временем, и мгновенная точность
 * здесь никому не нужна. Опрос чаще стоил бы запроса на каждую секунду показа
 * редактора ради строчки, которая девять раз из десяти не меняется.
 */
const POLL_INTERVAL_MS = 60_000

/**
 * Остаток дневной квоты демо-стенда. `null` — предохранитель выключен
 * (обычный запуск) или состояние стенда ещё не получено.
 */
export const useDemoLimit = (): DemoQuotaStatus | null => {
  const query = useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: POLL_INTERVAL_MS,
  })

  return query.data?.demo ?? null
}
