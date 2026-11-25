'use strict';

function createQuitCoordinator({ pendingWindows, requestWindowClose, needsFlush, flush, quit, onError, onReady }) {
  let flushed = false;
  let inFlight;
  return event => {
    const windows = pendingWindows();
    if (windows.length) {
      event.preventDefault();
      requestWindowClose(windows);
      return;
    }
    if (!flushed && needsFlush()) {
      event.preventDefault();
      if (!inFlight) {
        inFlight = Promise.resolve().then(flush).then(() => {
          flushed = true;
          quit();
        }).catch(onError).finally(() => { inFlight = null; });
      }
      return;
    }
    onReady();
  };
}

module.exports = { createQuitCoordinator };
