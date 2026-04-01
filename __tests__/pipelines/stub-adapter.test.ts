import { describe, it, expect } from 'vitest'
import { createStubAdapter, NotImplementedError } from '@/lib/pipelines/stub-adapter'

describe('createStubAdapter', () => {
  const adapter = createStubAdapter('testbook')

  it('sets the correct slug', () => {
    expect(adapter.slug).toBe('testbook')
  })

  describe('fetchEvents', () => {
    it('throws NotImplementedError', async () => {
      await expect(adapter.fetchEvents()).rejects.toThrow(NotImplementedError)
    })

    it('error message includes slug and method name', async () => {
      await expect(adapter.fetchEvents()).rejects.toThrow('testbook')
      await expect(adapter.fetchEvents()).rejects.toThrow('fetchEvents')
    })

    it('thrown error has correct name', async () => {
      try {
        await adapter.fetchEvents()
      } catch (e) {
        expect(e instanceof NotImplementedError).toBe(true)
        expect((e as NotImplementedError).name).toBe('NotImplementedError')
      }
    })

    it('thrown error carries slug and method properties', async () => {
      try {
        await adapter.fetchEvents()
      } catch (e) {
        const err = e as NotImplementedError
        expect(err.slug).toBe('testbook')
        expect(err.method).toBe('fetchEvents')
      }
    })
  })

  describe('fetchMarkets', () => {
    it('throws NotImplementedError for any eventId', async () => {
      await expect(adapter.fetchMarkets('event-123')).rejects.toThrow(NotImplementedError)
    })

    it('error message includes fetchMarkets', async () => {
      await expect(adapter.fetchMarkets('e')).rejects.toThrow('fetchMarkets')
    })
  })

  describe('healthCheck', () => {
    it('resolves (never throws)', async () => {
      await expect(adapter.healthCheck()).resolves.toBeDefined()
    })

    it('returns healthy: false', async () => {
      const result = await adapter.healthCheck()
      expect(result.healthy).toBe(false)
    })

    it('returns a message mentioning the slug', async () => {
      const result = await adapter.healthCheck()
      expect(result.message).toContain('testbook')
    })

    it('message indicates not-yet-implemented state', async () => {
      const result = await adapter.healthCheck()
      expect(result.message?.toLowerCase()).toContain('not yet implemented')
    })
  })
})

describe('NotImplementedError', () => {
  it('is an instance of Error', () => {
    const err = new NotImplementedError('fanduel', 'fetchEvents')
    expect(err instanceof Error).toBe(true)
  })

  it('has name NotImplementedError', () => {
    const err = new NotImplementedError('fanduel', 'fetchEvents')
    expect(err.name).toBe('NotImplementedError')
  })

  it('message includes slug and method', () => {
    const err = new NotImplementedError('draftkings', 'fetchMarkets')
    expect(err.message).toContain('draftkings')
    expect(err.message).toContain('fetchMarkets')
  })
})
