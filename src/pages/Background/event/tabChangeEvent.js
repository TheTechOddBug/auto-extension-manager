chrome.tabs.onUpdated.addListener(onTabUpdated)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onCreated.addListener(onTabCreated)
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged)
chrome.windows.onRemoved.addListener(onWindowRemoved)

let _currentTabUpdatedCallback
let _tabClosedCallback
let _windowClosedCallback

let _lastTabInfo
let _lastFocusedWindowId
let _hasPendingTabChange = false

function onTabActivated(_activeInfo) {
  checkCurrentTab()
}

function onTabUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.url) {
    return
  }

  if (
    _lastFocusedWindowId === tab.windowId &&
    _lastTabInfo?.id === tabId &&
    _lastTabInfo.windowId === tab.windowId
  ) {
    updateCurrentTab(tab)
  } else if (_currentTabUpdatedCallback && tab.active) {
    // A tab can be active in an unfocused window. Query only in this edge case
    // so a window focus change cannot make a background tab the current tab.
    checkCurrentTab(true)
  } else {
    notifyTabChange()
  }
}

function onTabRemoved(tabId, removeInfo) {
  if (_lastTabInfo?.id !== tabId) {
    _tabClosedCallback?.(tabId, removeInfo)
  }
}

function onTabCreated(tab) {
  // Active tabs are covered by onActivated/onUpdated. Background tabs with no
  // initial URL are covered when onUpdated later exposes changeInfo.url.
  if (tab.active || !tab.url) {
    return
  }
  notifyTabChange()
}

function onWindowRemoved(windowId) {
  _windowClosedCallback?.(windowId)
}

function onWindowFocusChanged(windowId) {
  _lastFocusedWindowId = windowId === chrome.windows.WINDOW_ID_NONE ? undefined : windowId
  if (_lastFocusedWindowId !== undefined) {
    checkCurrentTab()
  }
}

function checkCurrentTab(forceNotify = false) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs.length < 1) {
      return
    }
    const tab = tabs[0]
    _lastFocusedWindowId = tab.windowId
    if (!updateCurrentTab(tab) && forceNotify) {
      notifyTabChange()
    }
  })
}

function updateCurrentTab(tab) {
  const tabInfo = toTabInfo(tab)
  if (_lastTabInfo && isSameTabInfo(_lastTabInfo, tabInfo)) {
    return false
  }
  _lastTabInfo = tabInfo
  notifyTabChange(tabInfo)
  return true
}

function notifyTabChange(tabInfo) {
  if (!_currentTabUpdatedCallback) {
    _hasPendingTabChange = true
    return
  }
  _currentTabUpdatedCallback(tabInfo)
}

function toTabInfo(tab) {
  return {
    url: tab.url,
    title: tab.title,
    windowId: tab.windowId,
    id: tab.id
  }
}

function isSameTabInfo(one, other) {
  return one.windowId === other.windowId && one.id === other.id && one.url === other.url
}

export function onTabUrlChange(callback, currentTab) {
  _currentTabUpdatedCallback = callback
  if (currentTab && !_lastTabInfo) {
    _lastTabInfo = toTabInfo(currentTab)
  }
  if (currentTab && _lastFocusedWindowId === undefined) {
    _lastFocusedWindowId = currentTab.windowId
  }
  if (_hasPendingTabChange) {
    _hasPendingTabChange = false
    _currentTabUpdatedCallback()
  }
  return _lastTabInfo
}

export function onTabClosed(callback) {
  _tabClosedCallback = callback
}

export function onWindowClosed(callback) {
  _windowClosedCallback = callback
}
