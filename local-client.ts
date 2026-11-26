/** CLI access to the local module's HTTP contract. */
import type { BoardsClient } from 'boardlab'
import type { Scan } from './local/shared.ts'

export function localClient(client: BoardsClient) {
  return {
    scan: (input: { slots?: number[], boards?: string[], confirmed: boolean }) => client.call<Scan>('POST', '/api/scan', input),
    scanStatus: (id: string) => client.call<Scan>('GET', `/api/scan?id=${encodeURIComponent(id)}`),
    cancelScan: (id: string) => client.call<{ ok: true }>('POST', '/api/scan/cancel', { id }),
  }
}
