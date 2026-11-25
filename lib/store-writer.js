'use strict';

const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const { encryptItem, encryptText } = require('./crypto-store');

if (!isMainThread) {
  parentPort.on('message', ({ data, key: receivedKey }) => {
    const key = receivedKey && Buffer.from(receivedKey.buffer, receivedKey.byteOffset, receivedKey.byteLength);
    try {
      if (key) {
        data.items = data.items.map(item => encryptItem(key, item));
        data.notes = data.notes.map(note => encryptItem(key, note));
        data.tasks = data.tasks.map(task => ({
          ...task,
          title: task.title ? encryptText(key, task.title, `${task.id}:title`) : ''
        }));
      }
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      parentPort.postMessage({ bytes }, [bytes.buffer]);
    } catch (error) {
      parentPort.postMessage({ error: error.name });
    } finally {
      key?.fill(0);
    }
  });
} else {
  module.exports = function createStoreWriter() {
    let worker;
    let pending;
    function start() {
      const instance = new Worker(__filename);
      const fail = error => {
        if (instance !== worker) return;
        worker = null;
        const active = pending;
        pending = null;
        active?.reject(error);
      };
      instance.on('error', fail);
      instance.on('exit', code => fail(new Error(`Data writer exited (${code})`)));
      instance.on('message', ({ bytes, error }) => {
        if (instance !== worker || !pending) return;
        const active = pending;
        pending = null;
        instance.unref();
        if (error) active.reject(new Error(`Data serialization failed (${error})`));
        else active.resolve(bytes);
      });
      return instance;
    }
    return (data, key) => new Promise((resolve, reject) => {
      if (pending) { reject(new Error('Data writer is busy')); return; }
      worker ||= start();
      pending = { resolve, reject };
      worker.ref();
      try { worker.postMessage({ data, key }); }
      catch (error) { pending = null; worker.unref(); reject(error); }
    });
  };
}
