import { describe, expect, it } from 'vitest'
import { fetchFailureText } from './labels'

describe('fetchFailureText', () => {
  it('keeps the raw English detail out of the body text', () => {
    const net = fetchFailureText({ kind: 'network', detail: 'Failed to fetch' }, 'erik')
    expect(net).toEqual({
      title: 'Sem conexão com o site',
      text: 'Não deu para falar com o site. Confira sua conexão com a internet e tente de novo.',
      technical: 'Failed to fetch',
    })
    const bad = fetchFailureText({ kind: 'bad-response', detail: 'HTTP 503 from https://lichess.org/x' }, 'erik')
    expect(bad.text).toBe('O site respondeu de um jeito que o app não entende. Tente de novo em instantes.')
    expect(bad.technical).toBe('HTTP 503 from https://lichess.org/x')
  })

  it('words rate limiting with and without a wait time, and a missing user', () => {
    expect(fetchFailureText({ kind: 'rate-limited', retryAfterS: 60 }, 'erik').text).toBe('O site pediu para esperar 60 s antes de tentar de novo.')
    expect(fetchFailureText({ kind: 'rate-limited', retryAfterS: null }, 'erik').text).toBe('O site pediu para esperar um pouco antes de tentar de novo.')
    expect(fetchFailureText({ kind: 'not-found' }, 'erik')).toEqual({
      title: 'Usuário "erik" não encontrado',
      text: 'Confira a grafia do nome de usuário e o site escolhido.',
      technical: null,
    })
  })
})
