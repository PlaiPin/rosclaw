# 逐行详解 ⑤：`transport/rosbridge/types.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/types.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/types.ts)
>
> 推荐阅读顺序第 5 个文件。它把 **rosbridge 协议**里"在 WebSocket 上来回传的每一种消息长什么样"用类型定义出来。理解它，你才能看懂下一篇 `client.ts` 里收发的那些 `{ op: "..." }` 对象。

---

## 先理解 rosbridge 协议是什么

我们的插件和机器人之间隔着一个叫 **rosbridge_server** 的中间件，它把 ROS2 的世界"翻译"成 WebSocket 上的 **JSON 消息**。双方约定：每条消息都是一个 JSON 对象，且都有一个 `op` 字段（operation，操作类型），用 `op` 来表示"这条消息要干什么"。

比如：

```json
{ "op": "publish", "topic": "/cmd_vel", "msg": { ... } }   // 我要发布
{ "op": "subscribe", "topic": "/odom" }                     // 我要订阅
{ "op": "call_service", "id": "x_1", "service": "/reset" }  // 我要调用服务
```

这个文件就是把这些消息格式逐一写成 TS 接口。

> 第 1-4 行注释，连同 `@see` 给了官方协议文档链接。`@see` 是 JSDoc 标记，意思是"参见此处"。

---

## 第 8-15 行：客户端选项 & 连接状态

```typescript
export interface RosbridgeClientOptions {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
```

- `RosbridgeClientOptions` —— 创建 WebSocket 客户端时的配置：`url`（必填，连接地址）+ 三个可选项（是否重连、重连间隔、最多重连几次）。下一篇 `client.ts` 的构造函数就吃这个。
- `ConnectionStatus` —— 和第③篇那个一模一样的三选一状态。（这里又定义了一遍，是因为 rosbridge 模块想"自给自足"，不强依赖上层类型。）

---

## 第 19-22 行：所有消息的"基类" `RosbridgeMessage`

```typescript
export interface RosbridgeMessage {
  op: string;
  id?: string;
}
```

- `op: string;` —— 每条 rosbridge 消息**都有**的操作类型字段。
- `id?: string;` —— 可选的消息 ID（用于把"请求"和"响应"配对，后面服务/动作会用到）。

这个接口是后面所有具体消息的"共同底座"。下面马上用到一个新语法把它"继承"过去。

---

## 第 26-31 行：发布消息 `PublishMessage`（第一次见 `extends`）

```typescript
export interface PublishMessage extends RosbridgeMessage {
  op: "publish";
  topic: string;
  msg: Record<string, unknown>;
  type?: string;
}
```

**语法小课堂：`interface A extends B` 是"接口继承"。**
`extends` 意思是"扩展/继承"。`PublishMessage extends RosbridgeMessage` 表示："`PublishMessage` 拥有 `RosbridgeMessage` 的所有字段（`op`、`id?`），并在此基础上**再加/收紧**一些字段。" 这样就不用把 `op`、`id` 在每个消息里重写一遍——继承自基座即可。

逐字段看：

- `op: "publish";` —— **覆盖收紧**。基座里 `op` 是宽泛的 `string`，这里把它收紧成字面量 `"publish"`，意思是"这种消息的 `op` 必须恰好是 `publish`"。这又是判别字段（回忆第③篇判别联合）。
  - **语法小课堂：子接口可以"收紧"父接口的字段。** `"publish"` 是 `string` 的一个具体子集，所以这种收紧是合法的——把"任意文字"缩小为"只能是 publish 这个文字"。
- `topic: string;` —— 发布到哪个话题。
- `msg: Record<string, unknown>;` —— 消息体（任意结构）。
- `type?: string;` —— 可选的消息类型。

合起来，`PublishMessage` 实际拥有的字段是：`op`（="publish")、`id?`（继承来的）、`topic`、`msg`、`type?`。

---

## 第 33-46 行：订阅 / 取消订阅

```typescript
export interface SubscribeMessage extends RosbridgeMessage {
  op: "subscribe";
  topic: string;
  type?: string;
  throttle_rate?: number;
  queue_length?: number;
  fragment_size?: number;
  compression?: string;
}
```

- `op: "subscribe";` —— 标签固定为 `"subscribe"`。
- `topic` 必填，其余全可选。
- **注意字段名的风格**：`throttle_rate`、`queue_length`、`fragment_size` 用了**下划线命名（snake_case）**，而不是项目里常见的**驼峰命名（camelCase，如 `throttleRate`）**。
  - **语法小课堂：命名风格。** `camelCase`（小驼峰，单词间用大写字母分隔，如 `throttleRate`）是 JS/TS 的习惯；`snake_case`（蛇形，单词间用下划线，如 `throttle_rate`）是很多其它语言/协议的习惯。
  - **为什么这里用下划线？** 因为这些字段**必须严格匹配 rosbridge 协议规定的名字**——协议用的就是 `throttle_rate`。我们的内部类型（第③篇 `SubscribeOptions`）用 `throttleRate`（驼峰），到了这一层贴着协议就得改成 `throttle_rate`。这个"驼峰 ↔ 下划线"的转换，下一批的 `topics.ts` 会做。

```typescript
export interface UnsubscribeMessage extends RosbridgeMessage {
  op: "unsubscribe";
  topic: string;
}
```

- 取消订阅：标签 `"unsubscribe"` + 一个 `topic`。极简。

```typescript
export interface TopicMessage extends RosbridgeMessage {
  op: "publish";
  topic: string;
  msg: Record<string, unknown>;
}
```

- `TopicMessage` —— **服务端推给我们的话题消息**。它的 `op` 也是 `"publish"`（rosbridge 协议里，服务端把订阅到的消息也用 `publish` 操作推回来）。结构和 `PublishMessage` 几乎一样，只是少了 `type`。语义上它代表"收到的消息"而非"我要发的消息"。

---

## 第 56-68 行：服务调用 / 响应

```typescript
export interface ServiceCallMessage extends RosbridgeMessage {
  op: "call_service";
  service: string;
  args?: Record<string, unknown>;
  type?: string;
}
```

- 调用服务的请求：标签 `"call_service"`，带服务名、可选参数、可选类型。它会继承 `id?`——而且服务调用**强烈依赖** `id`，因为要靠它把响应配对回来。

```typescript
export interface ServiceResponseMessage extends RosbridgeMessage {
  op: "service_response";
  service: string;
  values?: Record<string, unknown>;
  result: boolean;
}
```

- 服务的响应：标签 `"service_response"`，带服务名、可选的返回数据 `values`、以及 `result`（成功与否）。服务端回这条时会带上和请求相同的 `id`，我们据此知道"这是哪个请求的回复"。

---

## 第 72-95 行：动作的四种消息

动作（长任务）有四种消息：发目标、收进度、收结果、取消。

```typescript
export interface ActionGoalMessage extends RosbridgeMessage {
  op: "send_action_goal";
  action: string;
  action_type: string;
  args?: Record<string, unknown>;
}
```

- 发送动作目标：标签 `"send_action_goal"`，带动作名、动作类型（`action_type`，又是下划线命名贴协议）、可选参数。

```typescript
export interface ActionFeedbackMessage extends RosbridgeMessage {
  op: "action_feedback";
  action: string;
  values: Record<string, unknown>;
}
```

- 进度反馈（服务端推来）：标签 `"action_feedback"`，带动作名和 `values`（这里 `values` **没有** `?`，是必有的——既然推了反馈，就一定带内容）。

```typescript
export interface ActionResultMessage extends RosbridgeMessage {
  op: "action_result";
  action: string;
  values?: Record<string, unknown>;
  result: boolean;
}
```

- 最终结果：标签 `"action_result"`，结构和服务响应类似（可选 `values` + `result`）。同样靠 `id` 配对。

```typescript
export interface ActionCancelMessage extends RosbridgeMessage {
  op: "cancel_action_goal";
  action: string;
}
```

- 取消动作：标签 `"cancel_action_goal"` + 动作名。

---

## 第 99-112 行：自省信息（又是三个一样的）

```typescript
export interface TopicInfo { name: string; type: string; }
export interface ServiceInfo { name: string; type: string; }
export interface ActionInfo { name: string; type: string; }
```

和第③篇 `transport/types.ts` 里那三个同名接口结构相同（名字 + 类型）。rosbridge 模块自己再定义一份，保持模块独立。

---

## 第 116-118 行：两个回调类型

```typescript
export type MessageHandler = (msg: Record<string, unknown>) => void;
export type ConnectionHandler = (status: ConnectionStatus) => void;
```

和第③篇那两个回调类型一模一样：消息处理器、连接状态处理器。下一篇 `client.ts` 会大量用到。

---

## 整章回顾

这个文件是 rosbridge 协议的"TypeScript 镜像"。核心规律只有一条：

> **每种消息都继承自 `RosbridgeMessage`（拿到 `op`、`id?`），再用字面量把 `op` 收紧成自己专属的操作名，并加上该消息特有的字段。**

| 我们 → 服务端（请求） | 服务端 → 我们（响应/推送） |
|---|---|
| `PublishMessage` (op=publish) | `TopicMessage` (op=publish，收到的话题消息) |
| `SubscribeMessage` (op=subscribe) | `ServiceResponseMessage` (op=service_response) |
| `UnsubscribeMessage` (op=unsubscribe) | `ActionFeedbackMessage` (op=action_feedback) |
| `ServiceCallMessage` (op=call_service) | `ActionResultMessage` (op=action_result) |
| `ActionGoalMessage` (op=send_action_goal) | |
| `ActionCancelMessage` (op=cancel_action_goal) | |

记住这张"消息对照表"，下一篇 `client.ts` 里 `switch (msg.op)` 处理各种 `case` 时你就一眼能对上号。

**语法点回顾清单**（本章新增）：
- `interface A extends B`：接口继承（拿到 B 的所有字段再扩展）
- 子接口"收紧"父字段：把 `op: string` 收紧为 `op: "publish"`
- 命名风格：`camelCase`（驼峰，JS 习惯）vs `snake_case`（下划线，贴协议）
- `@see` JSDoc 标记

下一份：[`transport/rosbridge/client.ts` 逐行详解 →](06-rosbridge-client.ts.md)（全项目最复杂的文件，第一次大量出现真正的执行逻辑）
