import assert from "node:assert/strict"
import test from "node:test"

import { createLatestTaskRunner } from "../src/pages/Background/rule/latestTaskRunner.ts"

let importId = 0

function createChromeMock() {
  const createEvent = () => {
    let listener
    return {
      addListener(callback) {
        listener = callback
      },
      fire(...args) {
        listener(...args)
      }
    }
  }

  const events = {
    updated: createEvent(),
    activated: createEvent(),
    removed: createEvent(),
    created: createEvent(),
    windowFocused: createEvent(),
    windowRemoved: createEvent()
  }
  let queryCount = 0
  let getCount = 0
  let queryTabs = []

  globalThis.chrome = {
    tabs: {
      onUpdated: events.updated,
      onActivated: events.activated,
      onRemoved: events.removed,
      onCreated: events.created,
      query(_query, callback) {
        queryCount += 1
        callback(queryTabs)
      },
      async get() {
        getCount += 1
      }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocused,
      onRemoved: events.windowRemoved
    }
  }

  return {
    events,
    setQueryTabs(tabs) {
      queryTabs = tabs
    },
    get queryCount() {
      return queryCount
    },
    get getCount() {
      return getCount
    }
  }
}

async function loadTabChangeEvent() {
  importId += 1
  return import(`../src/pages/Background/event/tabChangeEvent.js?test=${importId}`)
}

test("a URL update received before initialization is replayed after subscription", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  const calls = []

  chromeMock.events.updated.fire(
    1,
    { url: "https://gemini.google.com/" },
    { id: 1, windowId: 1, url: "https://gemini.google.com/", active: true }
  )
  eventModule.onTabUrlChange((tab) => calls.push(tab))

  assert.deepEqual(calls, [undefined])
  assert.equal(chromeMock.queryCount, 0)
})

test("only URL updates trigger rule evaluation", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  let callCount = 0
  eventModule.onTabUrlChange(() => {
    callCount += 1
  })

  const tab = { id: 1, windowId: 1, url: "https://example.com/", active: true }
  chromeMock.events.updated.fire(1, { status: "loading" }, tab)
  chromeMock.events.updated.fire(1, { title: "Example" }, tab)
  chromeMock.events.updated.fire(1, { favIconUrl: "favicon.ico" }, tab)

  assert.equal(callCount, 0)
  assert.equal(chromeMock.queryCount, 0)
})

test("current and background URL changes have distinct callback payloads", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  const calls = []
  eventModule.onTabUrlChange((tab) => calls.push(tab), {
    id: 1,
    windowId: 1,
    url: "https://before.example/"
  })

  chromeMock.events.updated.fire(
    1,
    { url: "https://after.example/" },
    { id: 1, windowId: 1, url: "https://after.example/", title: "After", active: true }
  )
  chromeMock.events.updated.fire(
    2,
    { url: "https://background.example/" },
    { id: 2, windowId: 1, url: "https://background.example/", active: false }
  )

  assert.deepEqual(calls, [
    {
      id: 1,
      windowId: 1,
      url: "https://after.example/",
      title: "After"
    },
    undefined
  ])
  assert.equal(chromeMock.queryCount, 0)
})

test("an active tab in a previously focused window never replaces the current tab", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  const calls = []
  const currentInA = {
    id: 1,
    windowId: 1,
    url: "https://window-a.example/",
    active: true
  }
  const currentInB = {
    id: 2,
    windowId: 2,
    url: "https://window-b.example/",
    active: true
  }
  eventModule.onTabUrlChange((tab) => calls.push(tab), currentInA)

  chromeMock.setQueryTabs([currentInB])
  chromeMock.events.windowFocused.fire(2)
  chromeMock.events.updated.fire(
    1,
    { url: "https://window-a.example/updated" },
    { ...currentInA, url: "https://window-a.example/updated" }
  )

  assert.equal(calls[0].id, currentInB.id)
  assert.equal(calls[1], undefined)
  assert.equal(
    calls.some((tab) => tab?.url?.endsWith("/updated")),
    false
  )
  assert.equal(chromeMock.queryCount, 2)
})

test("new tabs never poll while waiting for a URL or title", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  let callCount = 0
  eventModule.onTabUrlChange(() => {
    callCount += 1
  })

  chromeMock.events.created.fire({ id: 2, windowId: 1, active: false })
  chromeMock.events.created.fire({
    id: 3,
    windowId: 1,
    active: false,
    url: "https://background.example/"
  })

  assert.equal(callCount, 1)
  assert.equal(chromeMock.getCount, 0)
})

test("a newer navigation wins over an earlier initialization snapshot", async () => {
  const chromeMock = createChromeMock()
  const eventModule = await loadTabChangeEvent()
  const callback = () => {}
  eventModule.onTabUrlChange(callback, {
    id: 1,
    windowId: 1,
    url: "https://before.example/"
  })
  chromeMock.events.updated.fire(
    1,
    { url: "https://after.example/" },
    { id: 1, windowId: 1, url: "https://after.example/", title: "After", active: true }
  )

  const currentTab = eventModule.onTabUrlChange(callback, {
    id: 1,
    windowId: 1,
    url: "https://before.example/"
  })

  assert.equal(currentTab.url, "https://after.example/")
})

test("latest task runner coalesces calls and never overlaps executions", async () => {
  let callCount = 0
  let activeCount = 0
  let maxActiveCount = 0
  let releaseFirst
  const firstRun = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const runLatest = createLatestTaskRunner(async () => {
    callCount += 1
    activeCount += 1
    maxActiveCount = Math.max(maxActiveCount, activeCount)
    if (callCount === 1) {
      await firstRun
    }
    activeCount -= 1
  })

  runLatest()
  runLatest()
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.equal(callCount, 1)

  runLatest()
  runLatest()
  releaseFirst()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(callCount, 2)
  assert.equal(maxActiveCount, 1)
})
