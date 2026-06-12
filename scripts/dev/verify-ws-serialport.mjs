import { WebSocketServer } from "ws";
import { WebSocketSerialPort, USEQ_VIRTUAL_USB_VENDOR_ID, USEQ_VIRTUAL_USB_PRODUCT_ID }
  from "../../src/transport/webSocketSerialPort.ts";

const enc = new TextEncoder(), dec = new TextDecoder();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise(r => server.on("listening", r));
const url = `ws://127.0.0.1:${server.address().port}`;

const frame = new Uint8Array(11);
frame[0]=0x1f; frame[1]=0x00; frame[2]=0x01;
new DataView(frame.buffer).setFloat64(3, 0.5, true);

server.on("connection", ws => {
  ws.send(JSON.stringify({type:"ready",version:"1.2.0"})+"\n");
  ws.on("message", raw => {
    const msg = JSON.parse(raw.toString("utf8").trim());
    if (msg.type === "hello")
      ws.send(JSON.stringify({type:"response",success:true,mode:"json",fw:"1.2.0",config:{inputs:[],outputs:[]},requestId:msg.requestId})+"\n");
    else if (msg.type === "stream") ws.send(frame);
  });
});

console.log("Test 1: getInfo synthetic ids");
const p0 = new WebSocketSerialPort({ url });
ok(p0.getInfo().usbVendorId === USEQ_VIRTUAL_USB_VENDOR_ID && p0.getInfo().usbProductId === USEQ_VIRTUAL_USB_PRODUCT_ID, "getInfo returns synthetic VID/PID");

console.log("Test 2: hello/response handshake round-trip + ready frame");
const port = new WebSocketSerialPort({ url });
await port.open({ baudRate: 115200 });
const reader = port.readable.getReader();
const w = port.writable.getWriter();
await w.write(enc.encode('{"type":"hello","requestId":"req-1"}\n'));
w.releaseLock();
let acc = new Uint8Array(0);
const cat = (a,b)=>{const o=new Uint8Array(a.length+b.length);o.set(a);o.set(b,a.length);return o;};
const deadline = Date.now()+3000;
while (Date.now()<deadline && !dec.decode(acc).includes('"type":"response"')) {
  const {value,done}=await reader.read(); if(done)break; if(value)acc=cat(acc,value);
}
const text = dec.decode(acc);
ok(text.includes('"type":"ready"'), "unsolicited ready frame received");
const line = text.split("\n").find(l=>l.includes('"type":"response"'));
const resp = line && JSON.parse(line);
ok(resp && resp.mode==="json" && resp.success===true && resp.requestId==="req-1" && resp.fw==="1.2.0", "hello response: mode=json, success, requestId echoed");
reader.releaseLock();

console.log("Test 3: binary STREAM frame delivered verbatim (exact 11 bytes, 0x1F)");
const r2 = port.readable.getReader();
const w2 = port.writable.getWriter();
await w2.write(enc.encode('{"type":"stream"}\n')); w2.releaseLock();
let b = new Uint8Array(0); const d2=Date.now()+3000;
while (Date.now()<d2 && b.length<11) { const {value,done}=await r2.read(); if(done)break; if(value)b=cat(b,value); }
ok(b.length===11, `exact frame length (got ${b.length})`);
ok(b[0]===0x1f, "first byte 0x1F preserved");
ok(b[2]===0x01, "channel byte preserved");
ok(new DataView(b.buffer,b.byteOffset).getFloat64(3,true)===0.5, "f64 value preserved");
r2.releaseLock();

console.log("Test 4: onClose fires on socket close");
let closed=false;
const p2 = new WebSocketSerialPort({ url, onClose: ()=>{closed=true;} });
await p2.open({ baudRate: 115200 });
await p2.close();
await new Promise(r=>setTimeout(r,150));
ok(closed, "onClose invoked after close()");

await port.close();
await new Promise(r=>server.close(r));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
