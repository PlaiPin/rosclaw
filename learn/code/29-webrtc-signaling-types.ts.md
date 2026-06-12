# 逐行详解 ㉙：`transport/webrtc/signaling-types.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/webrtc/signaling-types.ts](../../extensions/openclaw-plugin/src/transport/webrtc/signaling-types.ts)
>
> 推荐阅读顺序第 29 个文件，**第七部分模式 C（WebRTC）的开篇**。它和第③⑤篇一样，是一个**纯类型文件**——只定义"信令服务器协议"的各种消息形状，没有任何执行逻辑。所谓"信令（signaling）"，是 WebRTC 建立连接前、两端通过一台中间服务器**交换"如何直连"的信息**的过程。本篇把这些消息的类型一一列出。由于全是熟悉的 `interface`/`extends`，读起来很轻松，正好作为模式 C 的热身。

---

## 先理解 WebRTC 和"信令"

- **WebRTC** 是浏览器/设备之间**点对点（peer-to-peer）直连**传输音视频和数据的技术。模式 C 用它的"数据通道（data channel）"来传 ROS2 消息——适合"OpenClaw 在云端、机器人在远处"的部署。
- 但两端要直连，得先**互相知道对方的网络地址、加密参数**等。这个"交换连接信息"的过程叫**信令**，需要一台双方都能访问的**信令服务器**居中转达。
- 信令交换的内容主要是：
  - **SDP**（会话描述）：描述"我支持什么编解码、我的媒体参数"等，分 **offer（提议）** 和 **answer（应答）** 两种。
  - **ICE candidate（候选地址）**：双方可能的网络路径，互相试探哪条能通。
- 一旦信令完成、直连建好，之后的数据就**不再经过信令服务器**，而是点对点直传。
- **本篇就是给这些信令消息定义类型**。你不需要精通 WebRTC，只要知道"这些消息是连接握手时交换的"即可。

---

## 第 1-6 行：模块注释

```typescript
/**
 * Type definitions for the WebRTC signaling server protocol.
 *
 * These match the message format used by the webrtc-py signaling server
 * (see mock_client.py and mock_robot.py for reference implementations).
 */
```

- 说明：这些类型**对齐一个 Python 写的信令服务器（webrtc-py）的消息格式**。
- **这点很重要**：这些 `interface` 不是凭空设计的，而是**照着一个已存在的服务器协议"描摹"出来的**——所以字段名都是 Python 风格的下划线（`user_id`、`robot_id`），而非 TS 习惯的驼峰。**当 TS 代码要和外部系统（这里是 Python 服务器）通信时，类型就得照对方的格式来**（回忆第⑤篇 rosbridge 协议也是下划线，同理）。

---

## 第 8-31 行：REST API 的请求/响应类型

```typescript
// --- REST API ---

export interface ConnectRequest {
  user_id: string;
  robot_id: string;
  robot_key: string;
}

export interface ConnectResponse {
  session: { session_id: string };
  room_id: string;
}

export interface DisconnectResponse {
  status: string;
}

export interface RobotInfo {
  robot_id: string;
  status: string;
  capabilities?: string[];
}

export type DiscoverResponse = RobotInfo[];
```

- 连接 WebRTC 前，先通过普通 **REST API**（HTTP 请求）做几件事：发现机器人、请求连接、断开。这几个类型就是那些请求/响应的形状。
- `ConnectRequest` —— 请求连接时要发的：用户 id、机器人 id、机器人密钥（`robot_key`，身份凭证）。
- `ConnectResponse` —— 服务器的回复：
  - `session: { session_id: string }` —— **内联的嵌套对象类型**（回忆第①篇：字段的类型可以直接写成 `{ ... }`）。表示 `session` 字段是个含 `session_id` 的对象。
  - `room_id` —— 分配的"房间" id（双方在同一房间里交换信令）。
- `DisconnectResponse` —— 断开的回复，就一个状态字符串。
- `RobotInfo` —— 一个机器人的信息：id、状态、可选的能力列表（`capabilities?: string[]`，第①篇可选 + 数组）。
- `export type DiscoverResponse = RobotInfo[];` —— **用 `type` 给"机器人信息数组"起个别名**（回忆第①篇 `type`）。"发现机器人"接口返回的就是一串 `RobotInfo`。

---

## 第 33-39 行：所有信令消息的"基底"形状

```typescript
// --- WebSocket signaling messages ---

/** Base shape for all signaling messages. */
export interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}
```

- 接下来是走 **WebSocket** 的信令消息（连接握手期间双向交换）。
- `SignalingMessage` 是所有信令消息的**共同基底**：
  - `type: string` —— 每条消息都有个 `type` 字段标明它是什么（和第⑤篇 rosbridge 的 `op` 同理——判别字段）。
  - `[key: string]: unknown;` —— **语法小课堂：索引签名（index signature）。**
    - `[key: string]: unknown` 读作"**除了上面明确写的字段，还允许任意多个字符串键、值为 unknown 的字段**"。
    - 为什么要它？因为不同信令消息字段各不相同，这个基底类型只能确定"一定有 `type`"，其余字段开放。具体子类型（下面）再补上各自的字段。
    - 这是"我知道有 `type`，其余字段先放开"的写法。

---

## 第 41-92 行：客户端→服务器 的消息（`extends` + 字面量收窄）

挑几个代表讲，其余同理：

```typescript
// Client → Server

export interface JoinRoomMessage extends SignalingMessage {
  type: "join_room";
  room_id: string;
  peer_id: string;
  peer_type: "frontend" | "robot";
  session_id: string;
}
```

- `interface JoinRoomMessage extends SignalingMessage` —— **继承基底**（回忆第⑤篇 `interface extends`）：在"有 `type` + 任意字段"的基础上，补上这条消息特有的字段。
- `type: "join_room";` —— **关键：把 `type` 从基底的 `string` 收窄成字面量 `"join_room"`**（回忆第⑤篇子接口收紧字段）。这样 TS 一看到 `type === "join_room"` 就知道这条消息是 `JoinRoomMessage`，能安全访问它的 `room_id` 等字段（判别联合的威力，第③篇）。
- `peer_type: "frontend" | "robot"` —— 字面量联合：对等端只能是"前端"或"机器人"二选一。
- 其余字段是这条消息要带的数据。

后面一连串都是同款套路（`extends SignalingMessage` + `type` 收窄成各自字面量），按用途列举：

- `RobotConnectMessage`（`"robot_connect"`）—— 机器人上线。
- `SessionAcceptedMessage`（`"session_accepted"`）—— 会话被接受。
- `OfferMessage`（`"offer"`）—— **SDP 提议**，`data: { type: string; sdp: string }`（嵌套对象装 SDP 内容）。
- `AnswerMessage`（`"answer"`）—— **SDP 应答**，结构类似 offer。
- `IceCandidateMessage`（`"ice_candidate"`）—— **ICE 候选地址**：
  ```typescript
  data: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
  };
  ```
  - 注意这里字段是**驼峰**（`sdpMid`、`sdpMLineIndex`）——因为这部分对齐的是 WebRTC 标准（标准本身用驼峰），而非那个 Python 服务器的下划线习惯。**混用说明"字段名永远跟着它对接的那个协议走"**，不强求统一。
  - `string | null` / `number | null` —— 这些字段**可能是值、也可能明确为 null**（WebRTC 标准里它们可空）。注意是 `| null`（明确的空）而非 `?`（可省略），细微区别：`?` 是"可以没有这个键"，`| null` 是"键在、但值是 null"。
- `HeartbeatMessage`（`"heartbeat"`）—— 心跳，带 `timestamp: number`（保活用，第31篇会看到怎么定时发）。

---

## 第 94-130 行：服务器→客户端 的消息

```typescript
// Server → Client

export interface PeerJoinedMessage extends SignalingMessage {
  type: "peer_joined";
  peer_id: string;
  peer_type: "frontend" | "robot";
}
// ...
```

- 同样是 `extends SignalingMessage` + `type` 收窄的一组，方向相反（服务器发给客户端）：
  - `PeerJoinedMessage`（`"peer_joined"`）/ `PeerLeftMessage`（`"peer_left"`）—— 有对等端加入/离开房间。
  - `SessionInvitationMessage`（`"session_invitation"`）—— 会话邀请。
  - `SessionEndedMessage`（`"session_ended"`）—— 会话结束，`reason?: string`（可选原因）。
  - `HeartbeatRequestMessage`（`"heartbeat_request"`）—— 服务器要求客户端回个心跳。
  - `ErrorMessage`（`"error"`）—— 错误消息，带 `message` + 可选 `code`。
- 这些都是声明式的类型，无逻辑，按需查阅即可。

---

## 整章回顾

- `signaling-types.ts` 是模式 C 的"协议字典"：定义 WebRTC 信令服务器收发的所有消息形状，照着一个 Python 服务器（webrtc-py）的格式描摹。
- 结构上分两类：**REST API**（连接前的 HTTP 请求/响应）和 **WebSocket 信令消息**（握手期间双向交换，含 SDP offer/answer、ICE candidate、心跳等）。
- 所有信令消息都 `extends SignalingMessage`（基底有 `type` + 索引签名），各自把 `type` 收窄成字面量——又是第③⑤篇"判别联合"那套，换了个场景。
- 字段命名**跟着对接的协议走**：对 Python 服务器用下划线、对 WebRTC 标准用驼峰，不强求统一。

**语法点回顾清单**（本章新增/巩固）：
- 索引签名 `[key: string]: unknown`（"除已知字段外，允许任意字符串键"）
- `interface X extends 基底` + 把 `type` 从 `string` 收窄成字面量（判别消息身份）（巩固第⑤篇）
- 内联嵌套对象类型 `session: { session_id: string }`（巩固第①篇）
- `type 别名 = T[]`（给数组类型起名，如 `DiscoverResponse`）
- `string | null`（值可为 null）vs `?`（键可省略）的区别
- 字段命名跟随对接协议（下划线 vs 驼峰混用）（巩固第⑤篇协议命名）

下一份：[`transport/webrtc/transport.ts` 逐行详解 →](30-webrtc-transport.ts.md)（模式 C 的传输主体——全项目最长的文件，但**它其实是完整实现、不是存根**，我们会澄清这点并抓主干讲）
