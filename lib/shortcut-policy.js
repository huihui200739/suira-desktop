'use strict';
const { validateAccelerator, findReserved, normalizeAccelerator } = require('./shortcuts');

// This adapter retains editable bindings without claiming OS hotkeys until consent.
function shortcutAdapter(system, enabled) {
  const local = new Set();
  return {
    register(key, handler) { if (enabled) return system.register(key, handler); local.add(key); return true; },
    unregister(key) { if (enabled) system.unregister(key); else local.delete(key); },
    isRegistered(key) { return enabled ? system.isRegistered(key) : local.has(key); }
  };
}
function shortcutReport(system, bindings) {
  const seen = new Map();
  return Object.entries(bindings).filter(([, key]) => key).map(([name, accelerator]) => {
    const normalized = normalizeAccelerator(accelerator), validation = validateAccelerator(accelerator);
    let state, reason = '';
    if (!validation.ok || findReserved(accelerator)) {
      state = 'protected'; reason = validation.error || findReserved(accelerator).reason;
    } else if (seen.has(normalized)) {
      state = 'duplicate'; reason = `与 ${seen.get(normalized)} 重复`;
    } else if (system.isRegistered(accelerator)) state = 'registered';
    else {
      let acquired = false;
      try { acquired = Boolean(system.register(accelerator, () => {})); state = acquired ? 'available' : 'conflict'; }
      catch { state = 'conflict'; }
      finally { if (acquired) system.unregister(accelerator); }
      if (state === 'conflict') reason = '被其他程序或系统占用；请更换组合键';
    }
    seen.set(normalized, name);
    return { name, accelerator, state, reason };
  });
}
module.exports = { shortcutAdapter, shortcutReport };
