export function createLatestTaskRunner(task: () => Promise<void>) {
  let pending = false
  let running = false
  let scheduled = false

  const drain = async () => {
    scheduled = false
    if (running) return

    running = true
    try {
      while (pending) {
        pending = false
        await task()
      }
    } finally {
      running = false
    }
  }

  return () => {
    pending = true
    if (running || scheduled) return

    scheduled = true
    queueMicrotask(() => void drain())
  }
}
