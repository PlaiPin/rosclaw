# 逐行详解 ㉚：`transport/webrtc/transport.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/webrtc/transport.ts](../../extensions/openclaw-plugin/src/transport/webrtc/transport.ts)
>
> 推荐阅读顺序第 30 个文件，**全项目最长的源文件（516 行）**。它是**模式 C** 的传输主体：通过 WebRTC 数据通道把 ROS2 消息传给远程机器人。
>
> **先澄清一件事**：本系列总览（README）和 CLAUDE.md 早先把模式 C 标为"存根（stub）"，但**真读这份代码会发现它其实是相当完整的实现**——它真的用了 `node-datachannel`、`ws` 这些库，有完整的"REST 请求 → 信令握手 → SDP/ICE 交换 → 数据通道开通 → 收发消息"流程。**这是一个文档与代码不一致的地方**，本篇按"它是完整实现"来讲，并在结尾说明这个出入。（注意到这种"文档说存根、代码却完整"的对照，正是我们一路在练的读码眼光。）
>
> 好消息：尽管最长，但它**实现的还是第④篇那个 `RosTransport` 接口**，而且**数据通道上跑的正是第⑤篇那套 rosbridge JSON 协议**——所以接口方法你已在第⑩篇见过、协议你已在第⑤⑥篇见过。真正新的只有"WebRTC 连接怎么建"那一段。我们抓这条主干，熟悉的部分快速带过。

---

## 先把整体流程记在心里

这个类扮演"应答方（answering peer）"，连接分几步（类注释也列了）：

```
1. REST: POST /connect → 拿到 session_id、room_id
2. 开信令 WebSocket → 加入房间 (join_room)
3. 等机器人发来 SDP offer（提议）
4. 建 PeerConnection、设置远端描述、生成 answer（应答）
5. 交换 ICE candidate（候选网络路径）
6. 数据通道打开 → 之后就在上面跑 rosbridge JSON
```

**关键洞察**：第 6 步之后，这个类就和第⑩篇 `RosbridgeTransport` 几乎一样了——都是"组一条 rosbridge JSON、发出去、按 id 接响应"。区别只在"消息走 WebRTC 数据通道"而非"走 WebSocket"。所以**前 5 步（建连接）是新内容，第 6 步之后（收发消息）全是旧知识**。

---

## 第 1-25 行：导入

```typescript
import { PeerConnection, DescriptionType, type DataChannel, type RtcConfig } from "node-datachannel";
import type { RosTransport } from "../transport.js";
import type { /* 一大批接口类型 */ } from "../types.js";
import { SignalingClient } from "./signaling-client.js";
import type { SignalingMessage, OfferMessage, IceCandidateMessage, PeerJoinedMessage } from "./signaling-types.js";
```

- `import { PeerConnection, DescriptionType, type DataChannel, type RtcConfig } from "node-datachannel";`
  - **`node-datachannel`** 是个真实的 WebRTC 库（提供 `PeerConnection` 等）。**这是"完整实现"的铁证**——存根不会真导入一个 WebRTC 库。
  - **语法小课堂：一条 import 里混用值导入和 `type` 导入。** `PeerConnection`、`DescriptionType` 是**值**（要 `new`/使用），`type DataChannel`、`type RtcConfig` 前面加了 `type` 表示**只当类型**。可以在同一对花括号里混写——`import { 值, type 类型 } from ...`。比分两行写紧凑。
- `SignalingClient`（值）—— 第31篇那个信令客户端，本类用它做 REST + WebSocket。
- 一批信令消息类型（第29篇）。

---

## 第 27-45 行：选项类型 + 待处理请求类型

```typescript
export interface WebRTCTransportOptions {
  signalingUrl: string;
  apiUrl: string;
  robotId: string;
  robotKey: string;
  iceServers?: RTCIceServerConfig[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
```

- `WebRTCTransportOptions` —— 连接所需：信令 WebSocket 地址、REST API 地址、目标机器人 id、机器人密钥、可选的 ICE 服务器（STUN/TURN，帮助穿透网络）。
- `PendingRequest` —— **一个"待兑现请求"的形状**：存 `resolve`、`reject`（Promise 的两个开关，第⑧篇）和 `timer`（超时定时器句柄）。
  - **语法小课堂：`ReturnType<typeof setTimeout>`。** 回忆第⑥篇 `ReturnType<typeof f>`（取函数返回值的类型）+ `typeof 值`。`setTimeout` 的返回值是个定时器句柄，类型在不同环境（浏览器/Node）下不同，与其写死，不如用 `ReturnType<typeof setTimeout>` **让 TS 自己推**——"无论它返回啥类型，我这字段就是那个类型"。是处理"跨环境类型"的稳妥写法。
  - 这个 `PendingRequest` 就是第⑥篇 `client.ts` 里 `registerPending` 存的东西，本类自己实现了一份等价物。

---

## 第 58-76 行：类 + 一堆状态字段 + 构造

```typescript
export class WebRTCTransport implements RosTransport {
  private options: WebRTCTransportOptions;
  private signaling: SignalingClient;
  private pc: PeerConnection | null = null;
  private dataChannel: DataChannel | null = null;
  private status: ConnectionStatus = "disconnected";
  private connectionHandlers = new Set<ConnectionHandler>();
  private topicHandlers = new Map<string, Set<MessageHandler>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private idCounter = 0;
  private sessionId: string | null = null;
  private roomId: string | null = null;
  private peerId: string | null = null;
  private robotPeerId: string | null = null;

  constructor(options: WebRTCTransportOptions) {
    this.options = options;
    this.signaling = new SignalingClient(options.apiUrl, options.signalingUrl);
  }
```

- `implements RosTransport` —— 老规矩，实现那 13 个方法（第④/⑩篇）。
- 字段分几类，对照第⑥篇 client + 第26篇 local 就眼熟：
  - `pc`（PeerConnection）、`dataChannel` —— WebRTC 的连接和数据通道，连上才有，先 null。
  - `status` / `connectionHandlers` —— 状态 + 连接回调集合（和第26篇 local 一样自己管理）。
  - `topicHandlers = Map<string, Set<MessageHandler>>` —— **话题 → 一组回调**。和第28篇 entities 的订阅设计同理：一个话题可能多个订阅者，用 `Set` 装回调。
  - `pendingRequests = Map<string, PendingRequest>` —— **id → 待处理请求**。这就是第⑥篇 `registerPending` 那套"按 id 配对响应"的本类版。
  - `idCounter` —— 自增计数器，生成唯一 id（第⑥篇 `nextId` 同款）。
  - `sessionId`/`roomId`/`peerId`/`robotPeerId` —— 信令握手过程中拿到的各种 id。
- 构造函数：存选项、建一个 `SignalingClient`（第31篇）。

---

## 第 78-119 行：`connect`——六步建连接（本篇新内容的核心）

```typescript
  async connect(): Promise<void> {
    if (this.status === "connected") return;
    this.setStatus("connecting");

    try {
      // Step 1: Request connection via REST API
      const userId = `frontend_${Date.now()}`;
      const connectRes = await this.signaling.requestConnection(this.options.robotId, {
        user_id: userId,
        robot_id: this.options.robotId,
        robot_key: this.options.robotKey,
      });
      this.sessionId = connectRes.session.session_id;
      this.roomId = connectRes.room_id;
      this.peerId = userId;

      // Step 2: Connect signaling WebSocket
      await this.signaling.connectWs();

      // Step 3: Set up message handler before joining room
      const connected = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("WebRTC connection timed out (30s)"));
        }, 30_000);

        this.signaling.onMessage((msg: SignalingMessage) => {
          this.handleSignalingMessage(msg, resolve, reject, timeout);
        });
      });

      // Step 4: Join room
      this.signaling.joinRoom(this.roomId, userId, "frontend", this.sessionId);

      // Step 5: Wait for data channel to be established
      await connected;
      this.setStatus("connected");
    } catch (err) {
      this.setStatus("disconnected");
      this.cleanup();
      throw err;
    }
  }
```

注释清楚标了步骤，逐步看：

- **Step 1（REST 请求连接）**：
  - `const userId = \`frontend_${Date.now()}\`;` —— 用时间戳拼一个唯一用户 id（`Date.now()`，第23篇）。
  - `await this.signaling.requestConnection(...)` —— 调信令客户端的 REST 接口（第31篇），传机器人 id、密钥。拿回 `session_id`、`room_id`，存进字段。
- **Step 2（开信令 WebSocket）**：`await this.signaling.connectWs();`（第31篇）。
- **Step 3（建一个"连接成功"的 Promise + 装消息处理器）**——**这段最巧妙**：
  - `const connected = new Promise<void>((resolve, reject) => {...})` —— 建一个 Promise 代表"整个 WebRTC 连接是否建成"。
  - 里面设 30 秒超时（超时 reject）。
  - `this.signaling.onMessage((msg) => this.handleSignalingMessage(msg, resolve, reject, timeout));` —— **登记信令消息处理器，并把 `resolve`/`reject`/`timeout` 一路传进去**。
    - 为什么传进去？因为"连接成功"这个事件，要等到后面收到 offer、建好数据通道、通道 `onOpen` 触发时才算数（在 `handleOffer` 里）。届时调 `resolve` 让这个 Promise 兑现。**这是把"分散在多个回调里才完成的事"汇聚成一个 Promise 的手法**（第⑧篇思想的进阶版：resolve 被传到很深的回调里才调用）。
- **Step 4（加入房间）**：`this.signaling.joinRoom(...)` 发 join_room 消息（第29、31篇）。这会触发服务器和机器人那边的后续动作（机器人发来 offer）。
- **Step 5（等数据通道建好）**：`await connected;` —— **卡在这里等那个 Promise**。直到数据通道 `onOpen`（在后面回调链里）调了 `resolve`，才往下 `setStatus("connected")`。
- `catch` —— 任何一步失败：退回断开、`cleanup()` 清理、抛错。

> **这段的精髓**：`connect` 启动握手、然后 `await` 一个 Promise；而让这个 Promise 兑现的 `resolve`，被深埋在"信令消息处理 → 处理 offer → 数据通道 onOpen"这条回调链的末端。**一条 await 等着一串异步回调最终汇合。**

---

## 第 121-147 行：`disconnect` / `getStatus` / `onConnection`

```typescript
  async disconnect(): Promise<void> {
    this.cleanup();
    if (this.sessionId) {
      try {
        await this.signaling.requestDisconnect(this.options.robotId);
      } catch {
        // Best-effort disconnect notification
      }
      this.sessionId = null;
    }
    this.signaling.close();
    this.setStatus("disconnected");
  }
```

- `disconnect` —— `cleanup()`（关数据通道和 pc，见下）→ 尽力通知服务器断开（REST，失败无所谓，空 catch）→ 关信令 WebSocket → 标记断开。
- `getStatus` / `onConnection` —— 和第26篇 local **完全一样**（返回状态字段 / 登记回调返回退订函数）。跳过。

---

## 第 149-189 行：`publish` / `subscribe`（开始变回熟悉的 rosbridge 味道）

```typescript
  publish(options: PublishOptions): void {
    this.sendOverDataChannel({
      op: "publish",
      topic: options.topic,
      type: options.type,
      msg: options.msg,
    });
  }
```

- **`publish`**：注意它组的是 `{ op: "publish", topic, type, msg }`——**这就是第⑤篇的 rosbridge `PublishMessage` 格式！** 只是不再用 `client.send`（WebSocket），而是 `sendOverDataChannel`（WebRTC 数据通道，见下面私有助手）。
- **`subscribe`**（第158行）：
  - 先把回调存进 `topicHandlers`（话题→回调集合，和第28篇 entities 一样的"一对多"管理）。
  - `this.sendOverDataChannel({ op: "subscribe", id: this.nextId("sub"), topic, type, throttle_rate, queue_length });` —— 发 rosbridge 的 `subscribe` 命令（第⑤篇格式）。
  - 返回 `Subscription` 句柄，`unsubscribe` 里：从集合移除本回调，**若集合空了**才真正发 `unsubscribe` 命令并从 Map 删除（**引用计数式退订，和第28篇一模一样的逻辑**）。
- **看出来了吗**：从这里开始，本类就是"**第⑩篇适配器的逻辑 + 第28篇的订阅管理**"——组 rosbridge JSON、管多订阅者。WebRTC 只是换了条"管子"。

---

## 第 191-257 行：`callService` / `sendActionGoal` / `cancelActionGoal`

```typescript
  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    const id = this.nextId("service");
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.registerPending(id, (v) => resolve(v as Record<string, unknown>), reject, 30_000);
      this.sendOverDataChannel({
        op: "call_service",
        id,
        service: options.service,
        args: options.args,
        type: options.type,
      });
    });
    return {
      result: response.result as boolean,
      values: response.values as Record<string, unknown> | undefined,
    };
  }
```

- **`callService`**：这和第⑧篇 `services.ts` 的 `callService` **几乎逐行对应**！
  - `nextId` 拿号 → `new Promise` + `registerPending`（先张接球网）→ `sendOverDataChannel` 发请求 → 返回承诺。
  - **完全是第⑧篇那套"拿号→登记回调→发请求→按 id 兑现"五步骨架**，只是发送通道是数据通道、`registerPending` 是本类自己实现的版本。第⑧篇吃透了这里秒懂。
- **`sendActionGoal`**（第212行）：和第⑨篇 `actions.ts` 对应——`registerPending` 等最终结果（120 秒超时）、若有 `onFeedback` 就挂一个 `__action_feedback__<id>` 频道接进度、用 `try/finally` 清理进度频道。**第⑨篇的翻版**。
- **`cancelActionGoal`**（第251行）：发个 `cancel_action_goal` 消息，最简单（第⑨篇同款）。

> 三个方法全是第⑧⑨篇知识的"换管子"重演。**这就是"实现同一接口、复用同一协议"的回报：核心逻辑你早就会了。**

---

## 第 259-299 行：三个自省方法

- `listTopics` / `listServices` —— 调 `callService("/rosapi/topics"...)`，再用 `.map` 把并列数组缝成信息数组。**和第⑩篇适配器的 `listTopics` 一字不差**（连 `result.values?.["topics"] as string[] ?? []` 都一样）。
- `listActions` —— 还是那个"找 `/_action/feedback` 后缀话题反推"的启发式（第⑩、26篇见过两遍了）。注释也说 `Same heuristic as RosbridgeTransport`。
- 完全复用，跳过。

---

## 第 301-341 行：基础私有助手

```typescript
  private nextId(prefix = "rosclaw"): string {
    return `${prefix}_${++this.idCounter}`;
  }

  private sendOverDataChannel(msg: Record<string, unknown>): void {
    if (!this.dataChannel) {
      throw new Error("Data channel is not open");
    }
    this.dataChannel.sendMessage(JSON.stringify(msg));
  }

  private registerPending(id, resolve, reject, timeoutMs): void {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    this.pendingRequests.set(id, { resolve, reject, timer });
  }

  private resolvePending(id: string, result: unknown): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.resolve(result);
    }
  }
```

- `nextId` —— `++this.idCounter` 前置自增（第⑥篇）拼唯一 id。第⑥篇 client 同款。
- `sendOverDataChannel` —— **本类发消息的唯一出口**：没数据通道就抛错，否则 `JSON.stringify` 后用 `dataChannel.sendMessage` 发出去。**这就是替代了第⑥篇 `client.send` 的那根"管子"**——其余代码都通过它发，所以前面 publish/callService 等才能那么像 rosbridge。
- `registerPending` / `resolvePending` —— **本类自己实现的第⑥篇那套"按 id 配对"**：登记时设超时 + 存进 `pendingRequests`；响应到了 `resolvePending` 清超时、移除、调 resolve。逻辑和第⑥篇 client 一致。

---

## 第 343-393 行：`handleDataChannelMessage`——收到数据通道消息的路由

```typescript
  private handleDataChannelMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const op = msg.op as string | undefined;
    if (!op) return;

    switch (op) {
      case "publish": { /* 找 topicHandlers，分发给所有回调 */ }
      case "service_response": { /* 按 id resolvePending */ }
      case "action_result": { /* 按 id resolvePending */ }
      case "action_feedback": { /* 找 __action_feedback__<id> 频道分发 */ }
    }
  }
```

- 这是数据通道收到消息时的**总路由**，**和第⑥篇 `client.ts` 的 `handleMessage` 是同一个角色、同一套 `switch(op)` 逻辑**：
  - `JSON.parse` 解析（解析失败就忽略，空 catch）。
  - 取 `op` 判别消息种类。
  - `publish` → 找话题的回调集合，挨个分发（订阅消息到了）。
  - `service_response` / `action_result` → 按 `id` 调 `resolvePending`（兑现等待的请求）。
  - `action_feedback` → 找 `__action_feedback__<id>` 频道分发进度。
- **第⑥篇那个"最难"的 `handleMessage` 你吃透了，这里就是它的 WebRTC 版**——结构完全平行。

---

## 第 395-493 行：信令与 WebRTC 握手（真正的新内容）

这两个方法是本篇唯一"前面没见过"的部分——WebRTC 怎么建连接。**它细节多、涉及 WebRTC 专业概念，对初学者只需把握"在干什么"，不必逐字抠 API。** 抓大意：

### `handleSignalingMessage`（第396行）——处理握手期的信令

```typescript
switch (msg.type) {
  case "peer_joined": { /* 记下机器人的 peer_id */ }
  case "offer": { /* 机器人发来 SDP 提议 → 调 handleOffer */ }
  case "ice_candidate": { /* 对方的网络候选 → pc.addRemoteCandidate */ }
  case "error": { /* 出错 → reject */ }
}
```
- 按信令消息的 `type`（第29篇那些类型）分别处理：对方加入、收到 offer（转给 `handleOffer`）、收到 ICE 候选（喂给 pc）、出错。
- `msg as OfferMessage` 等——把基底 `SignalingMessage` 断言成具体子类型再用其字段（判别后收窄的手动版）。

### `handleOffer`（第434行）——收到提议、建连接、回应答

这是 WebRTC 握手的核心一步，逐段大意：
- **准备 ICE 服务器**：`this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }]` —— 没配就用 Google 的公共 STUN 服务器兜底（`??`）。`.map` 把配置转成库要的字符串格式。
- `this.pc = new PeerConnection("rosclaw-frontend", rtcConfig);` —— **建 WebRTC 连接对象**。
- 然后挂几个回调（这是 WebRTC 编程的典型形态——事件驱动）：
  - `pc.onLocalCandidate(...)` —— 我方产生网络候选时，通过信令发给机器人（`sendIceCandidate`，第31篇）。
  - `pc.onStateChange(...)` —— 连接状态变化；失败/关闭就标记断开、拒绝所有待处理请求。
  - `pc.onDataChannel((dc) => {...})` —— **机器人开数据通道时触发**，这是关键：
    - 存下 `dataChannel = dc`。
    - `dc.onOpen(() => { clearTimeout(timeout); onConnected(); })` —— **通道开通！清超时、调 `onConnected`（就是 connect 里那个 resolve）**——至此 `connect` 的 `await connected` 才放行。**这就是前面说的"resolve 深埋在回调链末端"的落点。**
    - `dc.onMessage(...)` —— 收到消息 → 转字符串 → `handleDataChannelMessage`（上面那个路由）。
    - `dc.onClosed(...)` —— 通道关闭 → 清理、拒绝待处理请求。
- **设远端描述 + 生成应答**：`pc.setRemoteDescription(offer.data.sdp, ...)` 设入机器人的 offer，`pc.localDescription()` 拿到我方 answer，`sendAnswer(...)`（第31篇）发回去。
- **大意小结**：收到机器人的"提议"→ 建连接对象、挂好各种事件回调 → 把提议设进去、生成"应答"发回 → 之后双方交换 ICE 候选、直到数据通道 `onOpen`，连接告成。**WebRTC 就是这样一套"事件回调驱动的握手"，细节交给库，我们只需理解流程。**

---

## 第 495-515 行：清理助手

```typescript
  private cleanup(): void {
    this.rejectAllPending(new Error("Transport disconnected"));
    if (this.dataChannel) { this.dataChannel.close(); this.dataChannel = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
```

- `cleanup` —— 拒绝所有还在等的请求、关数据通道、关 pc。和第26篇 local 的对称清理一个精神。
- `rejectAllPending` —— **断开时把所有"还在等响应"的请求统统 reject**，免得它们永远悬着（调用方的 await 会收到错误而非永久卡住）。
  - `for (const [, pending] of this.pendingRequests)` —— **语法小课堂：解构里跳过某项 `[, pending]`。** Map 遍历每项是 `[键, 值]`，这里**第一个位置空着**（逗号前什么都不写）表示"键我不要"，只取值 `pending`。（对照第26篇 `for (const [action] of ...)` 只取键，这里相反，只取值。）
  - 挨个清超时 + reject，最后清空 Map。
- 这是"连接断了，别让等待者吊死"的负责任收尾。

---

## 整章回顾

- `WebRTCTransport`（模式 C）实现第④篇 `RosTransport` 接口，**在 WebRTC 数据通道上跑第⑤篇的 rosbridge JSON 协议**。
- **它的代码可清晰分成两半**：
  - **新内容（前 5 步建连接）**：REST 请求 → 信令 WebSocket → 收 offer → 建 PeerConnection、回 answer → 交换 ICE → 数据通道开通。这是 WebRTC 特有的"事件回调驱动握手"，抓流程即可。
  - **旧知识（连上之后收发）**：`publish`/`subscribe`/`callService`/`sendActionGoal`、`registerPending`/`resolvePending`、`handleDataChannelMessage` 的 `switch(op)`——**全是第⑤⑥⑧⑨⑩篇的翻版**，只把"WebSocket 这根管子"换成"数据通道这根管子"（`sendOverDataChannel`）。
- **关于"存根"**：README/CLAUDE.md 标它为存根，但代码是完整实现（真用 `node-datachannel`/`ws`、握手逻辑齐全）。**这是文档滞后于代码的一处不一致**——读码时以代码为准。

**语法点回顾清单**（本章新增/巩固）：
- 一条 import 混用值与 `type`：`import { 值, type 类型 } from ...`
- `ReturnType<typeof setTimeout>`：让 TS 推断"定时器句柄"的跨环境类型（巩固第⑥篇）
- 把 `resolve`/`reject` 深传进多层回调，让一个 `await` 等一串异步回调汇合（进阶第⑧篇）
- 解构跳过某项 `for (const [, pending] of map)`（只取值，对照第26篇只取键）
- 断开时 `rejectAllPending`：把所有悬而未决的请求 reject，避免调用方吊死
- 复用：rosbridge JSON 协议（第⑤篇）、按 id 配对（第⑥篇）、请求-响应/动作骨架（第⑧⑨篇）、订阅一对多（第28篇）——全部重演
- 读码核对文档：发现"标称存根、实为完整实现"的不一致

下一份：[`transport/webrtc/signaling-client.ts` 逐行详解 →](31-webrtc-signaling-client.ts.md)（信令客户端：封装 REST 调用 + 信令 WebSocket 生命周期 + 心跳——本篇大量用到的 `this.signaling.xxx` 在那里实现）
