const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Minimal Riot API client with client-side rate limiting.
 *
 * Development keys allow 20 requests/1s and 100 requests/2min. We throttle
 * slightly under both windows so a full sync never trips the server limit,
 * and still honor Retry-After if a 429 slips through (e.g. shared limits).
 */
export class RiotClient {
  private readonly windows = [
    { limit: 18, ms: 1_000 },
    { limit: 95, ms: 120_000 },
  ]
  private sent: number[] = []

  constructor(private readonly apiKey: string) {}

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.sent = this.sent.filter(t => now - t < 120_000)
      let wait = 0
      for (const w of this.windows) {
        const inWindow = this.sent.filter(t => now - t < w.ms)
        if (inWindow.length >= w.limit) {
          // sent is chronological, so the oldest request in the window
          // determines when a slot frees up.
          wait = Math.max(wait, inWindow[0]! + w.ms - now)
        }
      }
      if (wait <= 0) break
      await sleep(wait + 25)
    }
    this.sent.push(Date.now())
  }

  async get<T>(host: string, path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot()
      const res = await fetch(`https://${host}${path}`, {
        headers: { 'X-Riot-Token': this.apiKey },
      })
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 10)
        await sleep(retryAfter * 1000)
        continue
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      if (!res.ok) {
        throw new Error(`Riot API ${res.status} on ${path}: ${await res.text()}`)
      }
      return res.json() as Promise<T>
    }
  }
}
