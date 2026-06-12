# 逐行详解 ㉛：`transport/webrtc/signaling-client.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/webrtc/signaling-client.ts](../../extensions/openclaw-plugin/src/transport/webrtc/signaling-client.ts)
>
> 推荐阅读顺序第 31 个文件，**模式 C 的最后一块、也是整个传输层的收尾**。它是 `SignalingClient`——上一篇 `WebRTCTransport` 反复调用的 `this.signaling.xxx` 都在这里实现。职责很清晰：**封装和信令服务器打交道的两件事——REST API 调用（发现/连接/断开）和信令 WebSocket 的生命周期（连接、收发、心跳）。** 新东西有两个：浏览器/Node 通用的 **`fetch`（发 HTTP 请求）** 和 **`satisfies` 运算符**。同样，这也是真实实现（用了 `ws` 库），不是存根。

---

## 先理解它和 transport 的分工

- `WebRTCTransport`（第30篇）管"WebRTC 连接本身"（PeerConnection、数据通道、SDP/ICE）。
- `SignalingClient`（本篇）管"**和信令服务器通信**"——即握手期间，借服务器中转消息那部分：
  - **REST 部分**：连接前的 HTTP 请求（发现有哪些机器人、请求建立会话、通知断开）。
  - **WebSocket 部分**：握手期间双向交换信令消息（join_room、offer、answer、ICE、心跳）。
- 第30篇那些 `this.signaling.requestConnection(...)`、`connectWs()`、`joinRoom(...)`、`sendAnswer(...)` 的实现，全在本篇。

---

## 第 1-14 行：导入 + 回调类型别名

```typescript
import WebSocket from "ws";
import type { /* 一批信令类型 */ } from "./signaling-types.js";

export type SignalingMessageHandler = (msg: SignalingMessage) => void;
```

- `import WebSocket from "ws";` —— **默认导入** `ws` 库（Node 的 WebSocket 实现；浏览器自带 WebSocket，Node 要装这个库）。注意是默认导入（不带花括号，回忆第13篇 `export default`）。**真导入 `ws` 库 = 真实现，非存根。**
- 一批信令消息类型（第29篇）。
- `export type SignalingMessageHandler = (msg: SignalingMessage) => void;` —— 给"信令消息回调"的函数类型起个别名（收一条信令消息、返回 void）。

---

## 第 16-33 行：类 + 字段 + 构造（含 URL 规整）

```typescript
export class SignalingClient {
  private ws: WebSocket | null = null;
  private apiUrl: string;
  private signalingUrl: string;
  private messageHandler: SignalingMessageHandler | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(apiUrl: string, signalingUrl: string) {
    // Normalize: strip trailing slashes
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.signalingUrl = signalingUrl.replace(/\/+$/, "");
  }
```

- 字段：`ws`（WebSocket 实例，连上才有）、两个 URL、消息回调、心跳定时器句柄。
  - `heartbeatInterval: ReturnType<typeof setInterval> | null` —— 心跳定时器句柄类型（`ReturnType<typeof setInterval>`，和第30篇 `setTimeout` 同理；注意这里是 `setInterval` 反复触发的那种）。
- 构造函数做了件细致事——**规整 URL**：
  - `apiUrl.replace(/\/+$/, "")` —— **语法小课堂：`字符串.replace(正则, 替换串)`。** 把匹配正则的部分替换掉。
    - `/\/+$/` 是个正则：`\/` 是转义的斜杠 `/`（因为 `/` 在正则里有特殊含义，要转义），`+` 是"一个或多个"，`$` 是"字符串结尾"。合起来 `/\/+$/` = **"结尾处的一个或多个斜杠"**。
    - 替换成 `""`（空）= **去掉 URL 末尾的斜杠**。
  - 为什么？因为用户配的 URL 可能写成 `https://host/` 或 `https://host`，末尾有没有斜杠不统一。规整掉，后面拼路径（`${apiUrl}/api/...`）才不会出现 `host//api` 这种双斜杠。**这是"输入规整"的好习惯**（呼应第27篇 `normalizeType` 规整类型字符串）。

---

## 第 35-66 行：REST API 三方法（`fetch` 登场）

```typescript
  async discoverRobots(): Promise<DiscoverResponse> {
    const res = await fetch(`${this.apiUrl}/api/robots/`);
    if (!res.ok) {
      throw new Error(`Discovery failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<DiscoverResponse>;
  }
```

- **语法小课堂：`fetch(url, 选项?)` —— 发 HTTP 请求的标准函数。**
  - `fetch` 是现代 JS（浏览器和新版 Node 都内置）发网络请求的方法。`await fetch(...)` 拿到一个**响应对象 `res`**。
  - `res.ok` —— 布尔，请求是否成功（HTTP 状态码 200–299）。失败就抛错，带上 `res.status`（状态码如 404）和 `res.statusText`（状态文字）。
  - `res.json()` —— **把响应体解析成 JSON**（也是异步的，返回 Promise）。`as Promise<DiscoverResponse>` 断言成我们期望的类型（第29篇）。
- 这是最简单的一个：GET 请求"发现机器人"列表。

```typescript
  async requestConnection(robotId: string, request: ConnectRequest): Promise<ConnectResponse> {
    const res = await fetch(`${this.apiUrl}/api/robots/${robotId}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Connection request failed: ${res.status} — ${body}`);
    }
    return res.json() as Promise<ConnectResponse>;
  }
```

- `requestConnection` —— **带 body 的 POST 请求**（第30篇 connect 第 1 步调的就是它）。`fetch` 第二参数是选项对象：
  - `method: "POST"` —— 请求方法。
  - `headers: { "Content-Type": "application/json" }` —— 告诉服务器"我发的是 JSON"。
  - `body: JSON.stringify(request)` —— 请求体：把 `request` 对象转成 JSON 字符串（第⑥篇 `JSON.stringify`）。
  - 失败时 `await res.text()` 取出错误响应文本，拼进报错（比只给状态码信息更全）。
- `requestDisconnect`（第58行）—— POST 通知断开，最简单。
- **三个方法是 `fetch` 的标准用法范例**：GET、带 body 的 POST、检查 `res.ok`、`res.json()`/`res.text()` 取响应。Web 开发里天天用。

---

## 第 68-117 行：`connectWs`——连信令 WebSocket（Promise 包装事件）

```typescript
  async connectWs(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = `${this.signalingUrl}/ws`;
      const timeout = setTimeout(() => {
        reject(new Error(`Signaling WebSocket connection to ${wsUrl} timed out`));
      }, 10_000);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : event.data.toString();
        let msg: SignalingMessage;
        try {
          msg = JSON.parse(data) as SignalingMessage;
        } catch {
          return;
        }
        if (msg.type === "heartbeat_request") {
          this.send({ type: "heartbeat", timestamp: Date.now() } satisfies HeartbeatMessage);
          return;
        }
        if (this.messageHandler) {
          this.messageHandler(msg);
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Signaling WebSocket error connecting to ${wsUrl}`));
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        this.stopHeartbeat();
        this.ws = null;
      };
    });
  }
```

- **整体是"把 WebSocket 的事件回调包装成一个 Promise"**——和第⑥篇 client 的 `connect`、第⑧篇思想一脉相承：
  - `return new Promise<void>((resolve, reject) => {...})` —— 返回一个承诺，"连上了就 resolve、出错/超时就 reject"。
  - 10 秒超时（`setTimeout` → reject）。
  - `this.ws = new WebSocket(wsUrl);` —— 建 WebSocket，连 `信令URL/ws`。
- 然后挂四个事件回调（WebSocket 的标准事件）：
  - **`onopen`（连上了）**：清超时 → `startHeartbeat()` 开始心跳（见下）→ `resolve()` 兑现承诺。
  - **`onmessage`（收到消息）**：
    - `const data = typeof event.data === "string" ? event.data : event.data.toString();` —— 消息数据可能是字符串或二进制，统一转成字符串（三元 + `typeof`，第⑥篇）。
    - `JSON.parse` 解析（失败就忽略，空 catch）。
    - **自动回心跳**：`if (msg.type === "heartbeat_request")` —— 服务器要心跳，就**立刻自动回一条 heartbeat**（`this.send(...)`），然后 `return` 不再往下。这是"保活"机制的一半（另一半是下面主动定时发）。
      - **语法小课堂：`satisfies` 运算符。** `{ type: "heartbeat", timestamp: Date.now() } satisfies HeartbeatMessage` —— `satisfies` 检查"这个对象**符合** `HeartbeatMessage` 类型吗"，符合就放行、不符合编译报错。
        - **它和 `as` 的区别**：`as` 是"别管了，我说它是这类型"（断言，可能骗过 TS）；`satisfies` 是"请帮我**验证**它确实是这类型，但保留它本来的精确类型"。`satisfies` 更安全——它不放松检查，只确认你写对了。这里用它确保心跳消息字段写对（`type`/`timestamp` 齐全且类型对）。
    - 否则把消息转交给登记的 `messageHandler`（第30篇 `connect` 里登记的那个 `handleSignalingMessage`）。
  - **`onerror`（出错）**：清超时 → reject。
  - **`onclose`（关闭）**：清超时 → 停心跳 → 置 null。
- 这就是第30篇 connect 第 2 步 `await this.signaling.connectWs()` 等的东西。

---

## 第 119-179 行：消息收发 + join/answer/ice 几个发送方法

```typescript
  onMessage(handler: SignalingMessageHandler): void {
    this.messageHandler = handler;
  }

  send(message: SignalingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }
```

- `onMessage` —— 存下消息处理器（第30篇调它登记 `handleSignalingMessage`）。
- `send` —— **发送出口**：先确认 WebSocket 还开着（`this.ws.readyState !== WebSocket.OPEN` 检查连接状态），否则抛错；然后 `JSON.stringify` 后发出。所有发送都走它。

```typescript
  joinRoom(roomId, peerId, peerType, sessionId): void {
    this.send({
      type: "join_room",
      room_id: roomId,
      peer_id: peerId,
      peer_type: peerType,
      session_id: sessionId,
    } satisfies JoinRoomMessage);
  }
```

- `joinRoom` / `sendAnswer` / `sendIceCandidate` —— 三个**便捷发送方法**：各自组一条对应的信令消息（第29篇的 `JoinRoomMessage`/`AnswerMessage`/`IceCandidateMessage`），用 `satisfies` 确认格式正确，再 `send` 出去。
  - 这就是第30篇 `joinRoom(...)`、`sendAnswer(...)`、`sendIceCandidate(...)` 的实现。
  - 每个都用 `satisfies 对应类型` 把关——保证发出去的消息符合协议。**这是 `satisfies` 的典型用途：构造要发给外部的结构化消息时，让 TS 帮你核对字段。**

---

## 第 167-179 行：`close` + `isConnected`（getter）

```typescript
  close(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
```

- `close` —— 停心跳 + 关 WebSocket + 置 null。
- `get isConnected()` —— **语法小课堂：`get`（取值器 / getter）。**
  - 前面加 `get` 的方法是个"**伪装成属性的方法**"。用的时候写 `client.isConnected`（**不加括号**，像访问属性），它背后会执行这个函数返回值。
  - 这里 `isConnected` 计算"ws 存在且处于 OPEN 状态"返回布尔。调用方写 `signaling.isConnected` 就像读一个属性，但其实是实时算的。
  - 用 getter 是为了"对外看像个只读属性、内部其实有计算逻辑"。比写成 `isConnected()` 方法更自然（语义上它是个状态值，不是动作）。

---

## 第 181-196 行：心跳的开/停

```typescript
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "heartbeat", timestamp: Date.now() } satisfies HeartbeatMessage);
      }
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
```

- **语法小课堂：`setInterval(回调, 毫秒)` / `clearInterval(句柄)`。**
  - 回忆第②篇 `setTimeout`（**只触发一次**）。`setInterval` 是它的"反复版"——**每隔指定毫秒就触发一次回调，直到 `clearInterval` 停掉**。
  - 这里每 15 秒发一条心跳（`heartbeat`），告诉服务器"我还在线"。这是**主动心跳**（和上面 `onmessage` 里"被请求才回"的被动心跳互补，双保险保活）。
- `startHeartbeat` —— 先 `stopHeartbeat()`（防止重复开多个定时器）再开新的。每次触发前检查连接还开着才发。
- `stopHeartbeat` —— 有定时器就 `clearInterval` 停掉并置 null。
- **保活机制小结**：长连接容易被中间设备掐断，靠定期心跳维持。本类两路心跳——主动每 15 秒发、被收到 `heartbeat_request` 时回——确保连接不被误判为死连接。

---

## 整章回顾

- `SignalingClient` 封装了"和信令服务器通信"的全部细节，给 `WebRTCTransport` 当底层：
  - **REST**（`fetch`）：`discoverRobots`/`requestConnection`/`requestDisconnect`——连接前的 HTTP 交互。
  - **WebSocket**：`connectWs`（Promise 包装事件 + 超时）、`send`/`onMessage`、`joinRoom`/`sendAnswer`/`sendIceCandidate`（便捷发送，`satisfies` 把关）。
  - **心跳**：`setInterval` 主动发 + 收到请求被动回，双路保活。
- 它和第⑥篇 `RosbridgeClient` 角色相似（都是"管连接、收发底层消息"的客户端），只是一个走 rosbridge WebSocket、一个走信令服务器。

**语法点回顾清单**（本章新增/巩固）：
- `fetch(url, {method, headers, body})`：发 HTTP 请求；`res.ok`/`res.status`/`res.json()`/`res.text()`
- **`satisfies 类型`**：验证对象符合某类型但保留精确类型（比 `as` 安全——核对而非强断言）
- `get 属性()`：取值器（getter），用时不加括号、像读属性但实时计算
- `setInterval`/`clearInterval`：反复定时触发（vs `setTimeout` 一次）；心跳保活
- `字符串.replace(/\/+$/, "")`：正则去掉结尾斜杠（URL 规整，呼应第27篇）
- Promise 包装 WebSocket 事件（`onopen`→resolve / `onerror`→reject + 超时）（巩固第⑥⑧篇）
- `ws.readyState === WebSocket.OPEN` 判断连接是否就绪

---

## 🎉🎉 传输层全部讲完！三种模式集齐！

到这里，**第七部分（模式 A / C）讲完，整个传输层的三种实现全部读完**：

> **模式 B rosbridge（⑤–⑩）** + **模式 A 本地 DDS（26–28）** + **模式 C WebRTC（29–31）**，外加它们共同的接口（③④）和工厂（⑪）。

三种实现各走不同的"管子"（WebSocket / 本地 DDS / WebRTC 数据通道），但**都实现同一个 `RosTransport` 接口**——这就是第④篇那个"接口抽象"的全部价值：上层（工具、命令、服务）完全不用管底层用哪种，换模式只换工厂里 `new` 哪个类。你现在对"面向接口编程、多种实现可替换"有了**三个活生生的例子**支撑，这是非常扎实的收获。

**整个 `@rosclaw/openclaw-plugin` 插件——31 个源文件——已全部逐行读完！** 只剩最后一篇：第二个扩展 `openclaw-canvas`（实时仪表盘）。

下一份：[`openclaw-canvas` 逐行详解 →](32-openclaw-canvas.md)（第八部分、收官篇：另一个独立扩展，实时可视化机器人状态）
