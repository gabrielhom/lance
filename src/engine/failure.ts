import type { EngineFailureReason } from '../domain/types'

export class EngineFailure extends Error {
  readonly reason: EngineFailureReason
  constructor(reason: EngineFailureReason) {
    super(describe(reason))
    this.name = 'EngineFailure'
    this.reason = reason
  }
}

function describe(r: EngineFailureReason): string {
  switch (r.kind) {
    case 'unavailable':
      return `engine unavailable: ${r.why}`
    case 'mismatch':
      return `engine mismatch: expected ${r.expected}, got ${r.got}`
    case 'crashed':
      return `engine crashed: ${r.detail}`
    case 'protocol':
      return `engine protocol error: ${r.detail}`
    case 'timeout':
      return `engine timed out during ${r.during}`
  }
}

export function abortError(): DOMException {
  return new DOMException('The evaluation was aborted.', 'AbortError')
}
