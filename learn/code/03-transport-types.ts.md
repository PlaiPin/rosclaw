# 逐行详解 ③：`transport/types.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/types.ts](../../extensions/openclaw-plugin/src/transport/types.ts)
>
> 推荐阅读顺序第 3 个文件。它是**传输层的"数据字典"**——把"发布一条消息要带哪些信息""调用服务的结果长什么样""三种连接模式各自的配置"全部用类型定义好。和第①篇 `plugin-api.ts` 一样，这里**全是类型声明，没有一行干活的逻辑**。

---

## 先搞清楚"传输层"是干什么的

回忆一下整个项目的链路：

```
用户 → OpenClaw → RosClaw 插件 → (某种连接方式) → ROS2 机器人
```

那个"某种连接方式"就是**传输层**。它可能是 WebSocket（rosbridge）、可能是本机直连（DDS）、可能是 WebRTC。不管底层用哪种，上层的工具代码都希望"用一样的方式去发布消息、调用服务"。

要做到"用一样的方式"，就得先约定好**统一的数据格式**——发布消息时该提供什么、得到的结果长什么样。这个文件就是定义这些数据格式的。它本身不连接任何东西，只是"词汇表"。

> 第 1-3 行的 JSDoc 注释：「RosClaw 传输抽象层的共享类型」。"共享（shared）"是关键词——这些类型会被传输层的很多文件 `import` 复用。

---

## 第 7 行：连接状态 `ConnectionStatus`

```typescript
export type ConnectionStatus = "disconnected" | "connecting" | "connected";
```

- 用 `type` 定义一个类型 `ConnectionStatus`。
- 右边是三个**字面量类型**用 `|`（或）连起来——回忆第①篇：把具体的字符串当类型用，表示"值只能恰好是这几个词之一"。
- 含义：连接状态**只能是**这三种之一：
  - `"disconnected"` —— 已断开
  - `"connecting"` —— 连接中
  - `"connected"` —— 已连上
- 为什么不直接用 `string`？因为如果用 `string`，谁都能填 `"abc"` 这种乱七八糟的状态。限定成这三个，写错了 TS 立刻报错。这是字面量联合类型最常见的用途：**当"有限的几个选项"用**（相当于一个轻量级枚举）。

---

## 第 9 行：消息处理器 `MessageHandler`

```typescript
export type MessageHandler = (msg: Record<string, unknown>) => void;
```

- 这是一个**函数类型**（回忆第①篇：`(参数) => 返回类型` 的写法描述"一个函数长什么样"）。
- 拆解：
  - 参数 `msg: Record<string, unknown>` —— 收到的消息，是个"键是文字、值未知"的对象（因为 ROS2 消息可以是任意结构）。
  - 返回 `void` —— 处理完不返回任何值。
- 含义：**"消息处理器"是一种函数，它接收一条消息、处理它、不返回东西。** 后面订阅话题时，我们会写一个这样的函数交给传输层："每来一条消息，就用我这个函数处理"。这种"事后被调用的函数"通俗叫**回调函数（callback）**。

> **什么是回调？** 你把一个函数"交出去"，不是自己马上调用它，而是让别人"将来在合适的时机替你调用"。就像你留个电话号码给餐厅："菜好了打这个号码"——电话号码就是回调，餐厅将来会"回拨"。

---

## 第 11 行：连接状态处理器 `ConnectionHandler`

```typescript
export type ConnectionHandler = (status: ConnectionStatus) => void;
```

- 同样是函数类型（回调）。
- 参数 `status: ConnectionStatus` —— 接收一个连接状态（就是上面那三选一）。
- 返回 `void`。
- 含义：**一种"连接状态变化时被调用"的回调函数。** 连接从"连接中"变成"已连上"时，传输层会调用我们登记的这种函数，并把新状态传进来。我们就能据此打日志、刷新界面等。

---

## 第 13-16 行：订阅句柄 `Subscription`

```typescript
/** Returned by subscribe(); call unsubscribe() to stop receiving messages. */
export interface Subscription {
  unsubscribe(): void;
}
```

- 先看注释：「由 subscribe() 返回；调用 unsubscribe() 来停止接收消息」。
- `interface Subscription` —— 定义一个对象形状。
- 里面只有一个方法 `unsubscribe(): void;` —— "取消订阅"，无参数、无返回。
- 含义：当你订阅一个话题，传输层会给你一个 `Subscription` 对象（就像给你一张"订阅凭证"）。等你不想再收消息了，就调用这张凭证上的 `unsubscribe()` 来退订。
- **设计要点**：为什么要返回一个"句柄对象"，而不是用话题名字来退订？因为同一个话题**可能被订阅好几次**。如果用话题名退订，会分不清要退哪一个。而每次订阅返回一个独立的 `Subscription`，就能**精确退订其中某一个**，互不影响。（文档第 372-377 行也强调了这点。）

> **"句柄（handle）"是什么？** 一个代表"某个资源/操作"的小对象，你拿着它就能对那个资源做操作。这里 `Subscription` 就是"这次订阅"的句柄，拿着它能取消这次订阅。

---

## 第 20-24 行：发布选项 `PublishOptions`

```typescript
export interface PublishOptions {
  topic: string;
  type: string;
  msg: Record<string, unknown>;
}
```

发布一条消息到话题时要提供的信息：

- `topic: string;` —— 话题名（比如 `"/cmd_vel"`），必填。
- `type: string;` —— 消息类型（比如 `"geometry_msgs/msg/Twist"`），必填。ROS2 里每个话题都有固定的消息类型。
- `msg: Record<string, unknown>;` —— 消息体本身，是个任意结构的对象（因为不同类型的消息字段完全不同）。

> **为什么把参数打包成一个"选项对象"，而不是写成三个独立参数？**
> 对比两种写法：
> - `publish(topic, type, msg)` —— 调用时得记住顺序，容易传错。
> - `publish({ topic, type, msg })` —— 调用时每个值都有名字，一目了然，且以后加新选项不影响老代码。
> 本项目统一用"选项对象"风格，所以才有这么多 `XxxOptions` 接口。

---

## 第 28-33 行：订阅选项 `SubscribeOptions`

```typescript
export interface SubscribeOptions {
  topic: string;
  type?: string;
  throttleRate?: number;
  queueLength?: number;
}
```

订阅话题时的选项：

- `topic: string;` —— 话题名，必填。
- `type?: string;` —— 消息类型，**可选**（注意 `?`）。为什么可选？因为 rosbridge 通常能自己推断出话题类型，不一定要我们指定。
- `throttleRate?: number;` —— **节流速率**，可选，单位毫秒。意思是"两条消息之间至少间隔这么久"。用于高频话题（如里程计 `/odom` 每秒几十条），限制频率避免被淹没。
- `queueLength?: number;` —— 队列长度，可选。rosbridge 服务端为这个订阅缓存多少条消息。

---

## 第 37-46 行：服务调用的选项和结果

ROS2 的"服务（service）"是**请求-响应**模式：你发一个请求，它给你一个回应（类似打电话问一件事、对方答复）。

```typescript
export interface ServiceCallOptions {
  service: string;
  type?: string;
  args?: Record<string, unknown>;
}
```

调用服务的选项：

- `service: string;` —— 服务名，必填。
- `type?: string;` —— 服务类型，可选。
- `args?: Record<string, unknown>;` —— 请求参数，可选的任意对象（有的服务不需要参数）。

```typescript
export interface ServiceCallResult {
  result: boolean;
  values?: Record<string, unknown>;
}
```

服务返回的结果：

- `result: boolean;` —— 是否成功（`true`/`false`），必有。
- `values?: Record<string, unknown>;` —— 服务返回的实际数据，可选（有的服务只表示成功失败，没有数据要返回）。

---

## 第 50-60 行：动作的选项和结果

ROS2 的"动作（action）"用于**耗时较长、还能反馈进度、可中途取消**的任务（比如"导航到某点"，可能要走几十秒，途中不断报告进度）。

```typescript
export interface ActionGoalOptions {
  action: string;
  actionType: string;
  args?: Record<string, unknown>;
  onFeedback?: (feedback: Record<string, unknown>) => void;
}
```

发送动作目标的选项：

- `action: string;` —— 动作名，必填。
- `actionType: string;` —— 动作类型，**必填**（注意这里没有 `?`，和服务不同——动作类型不能省略）。
- `args?: Record<string, unknown>;` —— 目标参数，可选（比如目标坐标）。
- `onFeedback?: (feedback: Record<string, unknown>) => void;` —— **可选的进度回调**。
  - 它的类型是一个函数（回调）：接收一个 `feedback` 对象、返回 `void`。
  - 如果你提供了这个回调，那么动作服务器每推送一次进度，传输层就会调用你这个函数把进度交给你。
  - 如果不提供（可选），就单纯等动作做完、不接收中途进度。

```typescript
export interface ActionResult {
  result: boolean;
  values?: Record<string, unknown>;
}
```

动作完成后的结果——结构和 `ServiceCallResult` 一模一样：`result`（成功与否）+ 可选的 `values`（结果数据）。

---

## 第 64-77 行：三种"自省"信息

"自省（introspection）"指**让机器人告诉我们它有哪些能力**——有哪些话题、服务、动作可用。这三个接口形状完全相同，都是"名字 + 类型"：

```typescript
export interface TopicInfo {
  name: string;
  type: string;
}

export interface ServiceInfo {
  name: string;
  type: string;
}

export interface ActionInfo {
  name: string;
  type: string;
}
```

- `TopicInfo` —— 一个话题的信息：`name`（如 `"/cmd_vel"`）+ `type`（如 `"geometry_msgs/msg/Twist"`）。
- `ServiceInfo` —— 一个服务的信息，同样是名字 + 类型。
- `ActionInfo` —— 一个动作的信息，同样是名字 + 类型。

> **为什么三个长得一样还要分别定义？** 虽然现在形状相同，但它们**含义不同**（一个是话题、一个是服务、一个是动作）。分开定义，代码读起来语义更清楚，而且将来某一个要加字段时不会牵连另外两个。

---

## 第 81-113 行：三种传输模式各自的配置

接下来定义三种连接模式各自需要的配置。**注意每个里面都有一个 `mode` 字段，且值是一个固定的字符串**——这是后面要讲的"判别联合"的关键。

### 第 81-89 行：rosbridge 模式配置

```typescript
export interface RosbridgeTransportConfig {
  mode: "rosbridge";
  rosbridge: {
    url: string;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
  };
}
```

- `mode: "rosbridge";` —— **判别字段**。它的类型是字面量 `"rosbridge"`，意思是"这个对象的 `mode` 必须恰好是 `"rosbridge"`"。这个字段就像贴在盒子上的标签。
- `rosbridge: { ... };` —— 一个**内联的嵌套对象类型**（回忆第①篇：简单对象类型可以直接就地写在花括号里，不必单独 `interface`）。里面：
  - `url: string;` —— 连接地址，必填。
  - `reconnect?: boolean;` —— 是否重连，可选。
  - `reconnectInterval?: number;` —— 重连间隔，可选。
  - `maxReconnectAttempts?: number;` —— 最多重连几次，可选。

### 第 91-96 行：local 模式配置

```typescript
export interface LocalTransportConfig {
  mode: "local";
  local?: {
    domainId?: number;
  };
}
```

- `mode: "local";` —— 标签固定为 `"local"`。
- `local?: { domainId?: number };` —— 可选的本地配置，里面 `domainId` 也可选。注意整个 `local` 字段都带 `?`——因为本地模式可以完全用默认值，啥也不配。

### 第 98-107 行：webrtc 模式配置

```typescript
export interface WebRTCTransportConfig {
  mode: "webrtc";
  webrtc: {
    signalingUrl: string;
    apiUrl: string;
    robotId: string;
    robotKey: string;
    iceServers?: RTCIceServerConfig[];
  };
}
```

- `mode: "webrtc";` —— 标签固定为 `"webrtc"`。
- `webrtc: { ... };` —— WebRTC 的配置，前四个字段都是必填字符串（信令地址、API 地址、机器人 ID、密钥），最后：
  - `iceServers?: RTCIceServerConfig[];` —— 可选的 ICE 服务器**数组**（注意 `[]`），数组元素的类型是下面紧接着定义的 `RTCIceServerConfig`。

### 第 109-113 行：ICE 服务器配置 `RTCIceServerConfig`

```typescript
export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}
```

- `urls: string | string[];` —— 地址，类型是 `string | string[]`，即"一个字符串 **或** 一个字符串数组"（对应第②篇 Zod 里那个 `z.union`）。
- `username?` / `credential?` —— 可选的用户名和凭据。

> 你会发现这个接口和第②篇 `config.ts` 里的 `IceServerSchema` 描述的是同一种东西——一个是 Zod 运行时校验版，一个是 TS 类型版。

---

## 第 115-119 行：把三者合成"判别联合" `TransportConfig`（本章重点）

```typescript
/** Discriminated union of all transport configurations. */
export type TransportConfig =
  | RosbridgeTransportConfig
  | LocalTransportConfig
  | WebRTCTransportConfig;
```

- 注释：「所有传输配置的判别联合」。
- 用 `type` 定义 `TransportConfig`，它是上面三个配置接口用 `|`（或）连起来——意思是"一份传输配置，是这三种之一"。

**重点理解"判别联合（discriminated union）"——为什么它这么好用？**

注意三个接口的共同点：它们都有一个 `mode` 字段，且值各不相同（`"rosbridge"` / `"local"` / `"webrtc"`）。这个充当"标签"的字段叫**判别字段（discriminant）**。

它带来的好处是：**TypeScript 能根据 `mode` 的值，自动推断出当前到底是哪一种配置**。看个例子（这正是后面 `factory.ts` 和 `service.ts` 会写的代码）：

```typescript
function 处理(config: TransportConfig) {
  if (config.mode === "rosbridge") {
    // 在这个 if 内部，TS 100% 确定 config 是 RosbridgeTransportConfig
    // 所以你能安全访问 config.rosbridge.url，TS 不会报错
    console.log(config.rosbridge.url);
  } else if (config.mode === "webrtc") {
    // 这里 TS 又确定 config 是 WebRTCTransportConfig
    console.log(config.webrtc.robotId);
  }
}
```

这种"根据一个标签字段，自动缩小到具体类型"的能力叫**类型收窄（narrowing）**。它让我们写多模式处理代码时又安全又省心——不会出现"在 rosbridge 分支里手滑访问了 webrtc 才有的字段"这种错误，TS 会当场拦下。

---

## 整章回顾

这个文件是传输层的"数据字典"，把所有跨模式共享的数据结构定义清楚，分几类：

| 类别 | 类型 | 作用 |
|---|---|---|
| 连接 | `ConnectionStatus` / `MessageHandler` / `ConnectionHandler` / `Subscription` | 连接状态、两种回调函数、订阅句柄 |
| 发布 | `PublishOptions` | 发布消息要带的信息 |
| 订阅 | `SubscribeOptions` | 订阅话题的选项（含节流/队列） |
| 服务 | `ServiceCallOptions` / `ServiceCallResult` | 请求-响应式调用 |
| 动作 | `ActionGoalOptions` / `ActionResult` | 长任务，含进度回调 `onFeedback` |
| 自省 | `TopicInfo` / `ServiceInfo` / `ActionInfo` | 机器人能力发现 |
| 配置 | `RosbridgeTransportConfig` / `LocalTransportConfig` / `WebRTCTransportConfig` / `RTCIceServerConfig` / `TransportConfig` | 三种模式配置 + 判别联合 |

这些类型本身不"做"任何事，但它们是下一篇 `transport.ts`（统一接口）和整个传输层所有文件的"共同语言"。读懂它们，后面的代码才有意义。

**语法点回顾清单**（本章新增/巩固）：
- 字面量联合当"轻量枚举"用：`"a" | "b" | "c"`
- 回调函数 / 函数类型：`(参数) => void`
- "句柄对象"的设计思路（返回一个能操作资源的小对象）
- "选项对象"参数风格（`XxxOptions`）vs 散参数
- 内联嵌套对象类型 `字段: { 子字段: 类型 }`
- `string | string[]`：单个值或数组
- **判别联合**：用共同的标签字段（如 `mode`）区分多种形状
- **类型收窄**：`if (x.mode === "...")` 后 TS 自动确定具体类型

下一份：[`transport/transport.ts` 逐行详解 →](04-transport.ts.md)（传输层的统一接口契约）
