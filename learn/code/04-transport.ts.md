# 逐行详解 ④：`transport/transport.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/transport.ts](../../extensions/openclaw-plugin/src/transport/transport.ts)
>
> 推荐阅读顺序第 4 个文件。它定义了**整个传输层的"统一接口" `RosTransport`**——这是全项目最重要的一个接口之一。它依旧是纯类型声明（没有实现），但它是所有传输模式（rosbridge / local / webrtc）都必须遵守的"契约"。

---

## 先理解这个文件的地位

回忆第③篇讲的：传输层有三种底层实现方式，但上层工具希望"用一样的方式操作"。

这个文件就是定义那个"一样的方式"——它写出一份接口 `RosTransport`，规定"任何一个传输实现，都必须提供这些方法（连接、发布、订阅、调用服务……）"。

打个比方：

- `RosTransport` 是**插座标准**（规定插孔形状、电压）。
- rosbridge、local、webrtc 三种实现是**三种不同的发电方式**（火电、水电、太阳能）。
- 上层工具是**电器**。

只要三种发电方式都按同一个插座标准供电，电器插上去就能用，根本不关心电是怎么发的。这就是"接口/抽象"最核心的价值：**让使用者和实现者解耦**。

---

## 第 1-15 行：导入一堆类型

```typescript
import type {
  ConnectionStatus,
  ConnectionHandler,
  Subscription,
  PublishOptions,
  SubscribeOptions,
  ServiceCallOptions,
  ServiceCallResult,
  ActionGoalOptions,
  ActionResult,
  TopicInfo,
  ServiceInfo,
  ActionInfo,
  MessageHandler,
} from "./types.js";
```

- `import type { ... } from "./types.js"` —— 从同目录的 `types.js` 导入一批**类型**（`import type` 表示只拿类型，回忆第①篇）。
- 花括号里换行列出了 13 个名字——全是上一篇 `types.ts` 里定义的那些类型。这里把它们都拿过来，因为下面定义接口时要用到。
- **语法小课堂：为什么是 `"./types.js"` 而不是 `"./types.ts"`？**
  - `./` 表示"当前目录"（`../` 表示"上一级目录"）。所以 `./types` 指"本文件旁边那个 types 文件"。
  - 后缀写 `.js` 而不是 `.ts`，看起来很反直觉（我们明明导入的是 `.ts` 文件）。这是现代 ESM（ES 模块）标准 + 本项目 `NodeNext` 模块解析的规矩：**导入路径要写最终运行时的扩展名 `.js`**，即便源文件是 `.ts`。TS 编译时会自动对应过去。你现在只要记住"本项目内部导入一律写 `.js` 后缀"即可，照抄不会错。

---

## 第 17-23 行：接口的文档注释

```typescript
/**
 * Unified transport interface for ROS2 communication.
 *
 * All deployment modes (local DDS, rosbridge WebSocket, WebRTC data channel)
 * implement this interface so that plugin tools work identically regardless
 * of the underlying transport.
 */
```

翻译：
> ROS2 通信的统一传输接口。所有部署模式（本地 DDS、rosbridge WebSocket、WebRTC 数据通道）都实现这个接口，这样插件工具无论底层用哪种传输，操作方式都完全一致。

这正是上面"插座标准"那个比方的官方表述。

---

## 第 24 行：接口声明开始

```typescript
export interface RosTransport {
```

- 导出一个接口 `RosTransport`。从这里到第 70 行的 `}` 之间，列出所有"任何传输实现都必须提供的方法"。
- 接口里只写**方法的签名**（名字、参数、返回类型），不写方法体——因为这是"要求"，不是"实现"。具体怎么连、怎么发，是各个实现文件的事。

下面按功能分组逐方法看。每个方法前面都有一行 `/** ... */` 注释说明它干嘛。

---

## 第 25-37 行：连接生命周期（4 个方法）

```typescript
  // --- Connection lifecycle ---

  /** Establish the transport connection. */
  connect(): Promise<void>;
```

- `connect(): Promise<void>;` —— 「建立传输连接」。
  - 无参数。
  - 返回 `Promise<void>`：这是个**异步**操作（连接需要时间），将来完成、但不返回具体值。
  - 回忆第①篇：`Promise<T>` 是"将来才有的结果"，`void` 是"没有结果"，合起来就是"将来会做完，但不给你东西"。

```typescript
  /** Gracefully close the transport connection. */
  disconnect(): Promise<void>;
```

- `disconnect(): Promise<void>;` —— 「优雅地关闭连接」。同样异步、无返回值。"优雅地（gracefully）"意味着会做好清理（通知服务端、释放资源），而不是粗暴切断。

```typescript
  /** Get current connection status. */
  getStatus(): ConnectionStatus;
```

- `getStatus(): ConnectionStatus;` —— 「获取当前连接状态」。
  - 注意返回类型是 `ConnectionStatus`（上一篇那个三选一），**不是 `Promise`**——因为查询当前状态是**瞬间**就能拿到的，不需要等待，所以是同步方法。
  - **对比体会**：`connect()` 要等所以返回 `Promise`；`getStatus()` 立刻有答案所以直接返回值。是否包 `Promise`，取决于"这事要不要等"。

```typescript
  /** Register a connection status change handler. Returns a cleanup function. */
  onConnection(handler: ConnectionHandler): () => void;
```

- `onConnection(handler: ConnectionHandler): () => void;` —— 「注册一个连接状态变化的处理器。返回一个清理函数」。逐部分看：
  - 参数 `handler: ConnectionHandler` —— 接收一个回调（上一篇定义的 `ConnectionHandler`，即 `(status) => void`）。意思是"你给我一个函数，状态一变我就调用它"。
  - 返回类型 `() => void` —— **重点**：返回的是**一个函数**！
    - `() => void` 是函数类型：无参数、无返回值的函数。
    - 注释说这是"cleanup function（清理函数）"。意思是：你登记了一个监听器，`onConnection` 给你回一个"取消登记"的小函数。将来你不想再听了，调用这个返回的函数就能注销。
  - **语法小课堂：函数可以"返回另一个函数"。** 在 JS/TS 里函数是"一等公民"——可以当参数传、可以当返回值返回、可以存进变量。这里 `onConnection` 接收一个函数（`handler`）又返回一个函数（清理器），是非常典型的用法。和上一篇 `Subscription.unsubscribe()` 是同一个思路（给你一个"取消"的手段），只不过这里用"返回一个函数"实现，那里用"返回一个带方法的对象"实现。

---

## 第 39-45 行：话题（2 个方法）

```typescript
  // --- Topics ---

  /** Publish a message to a ROS2 topic. */
  publish(options: PublishOptions): void;
```

- `publish(options: PublishOptions): void;` —— 「向 ROS2 话题发布一条消息」。
  - 参数 `options: PublishOptions` —— 一个发布选项对象（上一篇定义的，含 `topic`/`type`/`msg`）。
  - 返回 `void`，而且**不是 `Promise`**！这很关键：发布是"**发完即忘（fire-and-forget）**"——把消息扔出去就完事，不等待机器人确认。ROS2 话题本来就是这种"广播"语义，没有回执。所以它既不异步也无返回。

```typescript
  /** Subscribe to a ROS2 topic. Returns a Subscription handle. */
  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription;
```

- `subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription;` —— 「订阅一个话题，返回一个订阅句柄」。
  - 两个参数：
    1. `options: SubscribeOptions` —— 订阅选项（话题名、可选的类型/节流等）。
    2. `handler: MessageHandler` —— 消息回调（上一篇定义的 `(msg) => void`）。每来一条消息就调用它。
  - 返回 `Subscription` —— 那个"订阅凭证"句柄（上一篇定义），拿着它可以 `unsubscribe()` 退订。
  - 同样**不是 `Promise`**：订阅这个动作是即时建立的，之后消息靠回调陆续送来，不需要"等一个结果"。

---

## 第 47-50 行：服务（1 个方法）

```typescript
  // --- Services ---

  /** Call a ROS2 service and return the result. */
  callService(options: ServiceCallOptions): Promise<ServiceCallResult>;
```

- `callService(options: ServiceCallOptions): Promise<ServiceCallResult>;` —— 「调用一个 ROS2 服务并返回结果」。
  - 参数 `options: ServiceCallOptions` —— 服务调用选项（服务名、类型、参数）。
  - 返回 `Promise<ServiceCallResult>` —— **这次是 `Promise` 了**！因为服务是"请求-响应"：发出请求后要**等**对方答复，所以异步；将来兑现时给你一个 `ServiceCallResult`（含 `result` 成功与否、`values` 返回数据）。
  - **再次对比**：`publish` 不等（`void`），`callService` 要等（`Promise<结果>`）。是不是 `Promise`，永远取决于"需不需要等一个回应"。

---

## 第 52-58 行：动作（2 个方法）

```typescript
  // --- Actions ---

  /** Send a goal to a ROS2 action server. */
  sendActionGoal(options: ActionGoalOptions): Promise<ActionResult>;
```

- `sendActionGoal(options: ActionGoalOptions): Promise<ActionResult>;` —— 「向动作服务器发送一个目标」。
  - 参数 `options: ActionGoalOptions` —— 动作目标选项（动作名、类型、参数，以及可选的进度回调 `onFeedback`）。
  - 返回 `Promise<ActionResult>` —— 异步，等动作**完全做完**后兑现，给你最终结果 `ActionResult`。
  - （动作可能耗时几十秒到几分钟，所以这个 `Promise` 可能要等很久。中途的进度则通过 `onFeedback` 回调实时给你，不走这个返回值。）

```typescript
  /** Cancel an in-progress action goal. */
  cancelActionGoal(action: string): Promise<void>;
```

- `cancelActionGoal(action: string): Promise<void>;` —— 「取消一个进行中的动作目标」。
  - 参数 `action: string` —— 要取消哪个动作（用动作名指定）。注意这里参数直接是个字符串，不是选项对象——因为只需要一个信息，没必要包装。
  - 返回 `Promise<void>` —— 异步（取消请求要发给服务端并等其受理），做完不返回具体值。

---

## 第 60-69 行：自省（3 个方法）

```typescript
  // --- Introspection ---

  /** List all available ROS2 topics. */
  listTopics(): Promise<TopicInfo[]>;
```

- `listTopics(): Promise<TopicInfo[]>;` —— 「列出所有可用话题」。
  - 无参数。
  - 返回 `Promise<TopicInfo[]>` —— 异步（要向机器人查询），兑现时给一个 `TopicInfo` **数组**（注意 `[]`），即一串"话题名+类型"。

```typescript
  /** List all available ROS2 services. */
  listServices(): Promise<ServiceInfo[]>;

  /** List all available ROS2 action servers. */
  listActions(): Promise<ActionInfo[]>;
}
```

- `listServices(): Promise<ServiceInfo[]>;` —— 列出所有服务，返回 `ServiceInfo` 数组。
- `listActions(): Promise<ActionInfo[]>;` —— 列出所有动作，返回 `ActionInfo` 数组。
- 最后的 `}` 关闭 `interface RosTransport` 的花括号，接口定义完毕。

这三个方法就是第⑫篇"机器人上下文注入"会用到的——会话开始时并行调用它们，把机器人能力查出来喂给 AI。

---

## 一张表看懂所有方法（以及"要不要等"的规律）

| 方法 | 参数 | 返回 | 要等吗？ |
|---|---|---|---|
| `connect()` | 无 | `Promise<void>` | 要等（连接耗时） |
| `disconnect()` | 无 | `Promise<void>` | 要等 |
| `getStatus()` | 无 | `ConnectionStatus` | **不等**（瞬间查询） |
| `onConnection(handler)` | 回调 | `() => void`（清理函数） | **不等**（登记动作） |
| `publish(options)` | 选项 | `void` | **不等**（发完即忘） |
| `subscribe(options, handler)` | 选项+回调 | `Subscription`（句柄） | **不等**（建立订阅） |
| `callService(options)` | 选项 | `Promise<ServiceCallResult>` | 要等（请求-响应） |
| `sendActionGoal(options)` | 选项 | `Promise<ActionResult>` | 要等（长任务） |
| `cancelActionGoal(action)` | 字符串 | `Promise<void>` | 要等 |
| `listTopics/Services/Actions()` | 无 | `Promise<...[]>` | 要等（远程查询） |

**规律总结**：凡是"需要等机器人/服务端回应"的，返回 `Promise`；凡是"本地瞬间完成或发完不管"的，直接返回值。读接口时养成习惯——看到 `Promise` 就知道"这步要 `await` 等待"，看到直接返回就知道"这步立刻有结果"。

---

## 整章回顾

- `RosTransport` 是**全项目传输层的统一契约**。它用纯接口规定了 13 个方法，覆盖：连接生命周期、话题、服务、动作、自省五大块。
- 它的价值是**解耦**：上层工具只认这个接口，底层换成 rosbridge / local / webrtc 任何一种都行，工具代码一行不用改。
- 后面你会看到：
  - `rosbridge/adapter.ts` 写 `class RosbridgeTransport implements RosTransport`（用 `implements` 声明"我实现了这份契约"）。
  - `local/transport.ts`、`webrtc/transport.ts` 同样 `implements RosTransport`。
  - 三者方法签名必须和这里完全对得上，否则 TS 报错——这就是接口"强制约束实现"的作用。

**语法点回顾清单**（本章新增/巩固）：
- 内部导入路径写 `.js` 后缀（即便源文件是 `.ts`）、`./` 当前目录、`../` 上级目录
- 接口里只写方法签名、不写方法体
- "返回一个函数"：`(): () => void`（函数是一等公民，可当返回值）
- 同步 vs 异步的判断：看返回值是不是 `Promise`，本质看"要不要等回应"
- 用注释（`/** */`）给每个方法写一句说明的习惯

下一份：[`transport/rosbridge/types.ts` 逐行详解 →](05-rosbridge-types.ts.md)（开始进入唯一完整实现的 rosbridge，先看它的协议消息格式）
