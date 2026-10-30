import { setTimeout as sleep } from 'node:timers/promises'

/** Only retry transient Gotenberg server failures, and always issue a fresh request. */
export async function retryTransientConversion(
  convert: () => Promise<Response>,
  {
    attempts = 3,
    pause = (attempt: number) => sleep(attempt * 1_500),
    onRetry,
  }: {
    attempts?: number
    pause?: (attempt: number) => Promise<void>
    onRetry?: (failure: {
      attempt: number
      status: number
      body: string
      trace: string | null
    }) => void
  } = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await convert()
    if (response.ok || ![500, 502, 503, 504].includes(response.status) || attempt >= attempts) {
      return response
    }
    onRetry?.({
      attempt,
      status: response.status,
      body: (await response.text()).slice(0, 1_000),
      trace: response.headers.get('gotenberg-trace'),
    })
    await pause(attempt)
  }
}
