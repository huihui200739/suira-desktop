'use strict';
// 只连接本机测试实例；调用方负责关闭连接和收起测试窗口。
async function connect(port, select = () => true) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(select);
  if (!target) throw new Error(`找不到 ${port} 对应窗口`);
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
  ws.onmessage = event => {
    const message=JSON.parse(event.data), request=pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const send = (method,params={}) => new Promise((resolve,reject) => {
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('运行实例未响应'));},20000);
    pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
  });
  const evaluate = expression => send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).then(result=>{
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result?.value;
  });
  return {ws,send,evaluate};
}
module.exports={connect};
