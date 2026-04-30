import { useState, useCallback } from 'react'
import { useToast } from './useToast'

export function useApi(apiFunction) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const { toast } = useToast()

  const execute = useCallback(async (...args) => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFunction(...args)
      setData(result)
      return result
    } catch (err) {
      const message = err.message || 'An error occurred'
      setError(message)
      toast.error(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [apiFunction, toast])

  return { execute, loading, error, data, setData }
}
