/** Stop waiting on cancellation, while still observing late promise failures. */
export function awaitWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled.', 'AbortError'))
      return
    }
    const onAbort = () => reject(new DOMException('Cancelled.', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return operation()
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
