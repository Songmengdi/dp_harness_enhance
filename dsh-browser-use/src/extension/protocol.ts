import type { BrowserCommand, BrowserCommandResult } from '../protocol.js'

export type ExtensionClientMessage =
  | { type: 'hello'; name?: string }
  | { type: 'response'; id: number; result: BrowserCommandResult }
  | { type: 'event'; event: Record<string, unknown> }

export type ExtensionHostMessage =
  | { type: 'command'; id: number; command: BrowserCommand }
