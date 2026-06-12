# 逐行详解 ⑦：`transport/rosbridge/topics.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/topics.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/topics.ts)
>
> 推荐阅读顺序第 7 个文件。上一篇 `client.ts`（最难那篇）已经把"底层管子"——连接、收发、配对——全造好了。从这篇开始，我们看的是**架在 `client` 之上的三个小帮手**：话题、服务、动作。它们都很轻松，因为脏活累活 `client` 全干完了，它们只是"组装一条消息，丢给 `client.send`"。

---

## 先理解这个文件的定位

回忆第④篇那个比方：`client` 是"插座背后的电路"。而这篇 `topics.ts` 提供两个**包装类**：

- `TopicPublisher`（发布器）——专门负责"往某个话题发消息"。
- `TopicSubscriber`（订阅器）——专门负责"订阅某个话题、收消息、退订"。

它们都很薄：自己不连接、不解析，只是把"发布""订阅""退订"这几个动作，翻译成 `client` 认识的那种 `{ op: "..." }` 消息。可以理解为"专用遥控器"——一个只管发布、一个只管订阅。

---

## 第 1-2 行：导入

```typescript
import type { RosbridgeClient } from "./client.js";
import type { MessageHandler } from "./types.js";
```

- `import type { RosbridgeClient } from "./client.js"` —— 从上一篇的 `client.ts` 拿来 `RosbridgeClient` **类型**。注意是 `import type`（回忆第①篇：只借类型当"标注"用，不参与运行）。我们要把 `client` 实例存起来，所以需要它的类型。
- `import type { MessageHandler }` —— 从 `types.js` 拿来"消息处理器"回调类型（第⑤篇讲过：`(msg) => void`）。订阅时要用它给参数做标注。

---

## 第 4-12 行：发布器 `TopicPublisher` 的骨架

```typescript
/**
 * Helper for publishing messages to a ROS2 topic.
 */
export class TopicPublisher {
  constructor(
    private client: RosbridgeClient,
    private topic: string,
    private type: string,
  ) {}
```

- `export class TopicPublisher` —— 定义并导出一个**类**（回忆第⑥篇：`class` 是"模具"，用 `new` 造出实例）。
- `constructor(...)` —— 构造函数，造实例时跑一次。

**语法小课堂：构造函数参数里直接写 `private`，是 TS 的"参数属性"简写。**
看这三个参数前面都带了 `private`：

```typescript
constructor(
  private client: RosbridgeClient,
  private topic: string,
  private type: string,
) {}
```

在普通 JS 里，要把构造参数存成实例字段，得手写一遍：

```typescript
constructor(client, topic, type) {
  this.client = client;   // 手动搬运
  this.topic = topic;
  this.type = type;
}
```

而 TS 允许你**在参数前加 `private`（或 `public`/`readonly`）**，它就自动帮你做上面那三行"搬运"——自动声明同名字段并赋值。所以这里虽然构造函数体是空的 `{}`，但 `this.client`、`this.topic`、`this.type` 已经被悄悄建好了。这是 TS 里极常见的省字偷懒写法，第⑥篇的 `client.ts` 里其实也用过，这里专门点明。

- 三个参数含义：
  - `client` —— 底层那个 rosbridge 客户端（真正发消息的人）。
  - `topic` —— 这个发布器固定服务于哪个话题。
  - `type` —— 该话题的消息类型。
- **设计意图**：一个 `TopicPublisher` 实例 = "绑定了某话题+某类型的专用发布器"。建好之后，每次发消息只需给消息体，话题和类型它自己记着。

---

## 第 14-22 行：`publish` 方法

```typescript
  /** Publish a message to the topic. */
  publish(msg: Record<string, unknown>): void {
    this.client.send({
      op: "publish",
      topic: this.topic,
      type: this.type,
      msg,
    });
  }
}
```

- `publish(msg: Record<string, unknown>): void` —— 方法：接收一个消息体 `msg`（任意结构的对象），返回 `void`（发完即忘，不等回执——回忆第④篇"要不要等"那条规律，发布是不等的）。
- 方法体只有一句 `this.client.send({...})`：把一个 `publish` 消息交给底层客户端发出去。
- 这个对象就是第⑤篇讲的 `PublishMessage` 格式：
  - `op: "publish"` —— 固定的操作标签。
  - `topic: this.topic` —— 用实例里记着的话题。
  - `type: this.type` —— 用实例里记着的类型。
  - `msg,` —— **对象简写**（回忆第⑥篇）：`msg,` 等价于 `msg: msg`，即"键名叫 `msg`，值就是参数 `msg`"。
- `}` 关闭类。

到此发布器讲完——它就是把"发布"这件事固定成一句 `client.send`，没有任何复杂逻辑。

---

## 第 25-35 行：订阅器 `TopicSubscriber` 的骨架

```typescript
/**
 * Helper for subscribing to messages from a ROS2 topic.
 */
export class TopicSubscriber {
  private unsubscribeFromClient: (() => void) | null = null;

  constructor(
    private client: RosbridgeClient,
    private topic: string,
    private type?: string,
  ) {}
```

- 又一个类，负责订阅。构造参数和发布器几乎一样，只是 `type?` 这次是**可选**的（订阅时类型常可省，回忆第③篇 `SubscribeOptions`）。
- 多了一个字段，值得细看：

```typescript
private unsubscribeFromClient: (() => void) | null = null;
```

**逐部分拆解这一行（信息量很大）：**

- `private` —— 私有字段，只在类内部用。
- `unsubscribeFromClient` —— 字段名，含义是"从 client 那里退订用的那个函数"。
- `: (() => void) | null` —— 它的**类型**，是个联合类型（回忆第①篇 `|`）：要么是"一个无参无返回的函数 `() => void`"，要么是 `null`（空）。
  - 为什么要能是 `null`？因为**还没订阅时，根本没有"退订函数"可存**，先用 `null` 占位。订阅之后才把真正的退订函数放进来。
  - **语法小课堂：`(() => void) | null` 里外面那层括号是干嘛的？** 是为了**消除歧义**。如果写成 `() => void | null`，TS 会理解成"一个返回 `void | null` 的函数"（括号管到了返回值上）。加一层括号 `(() => void)`，明确表示"这是个函数类型"，再 `| null` 表示"这个函数 **或者** null"。括号在这里决定了 `|` 到底作用在谁身上。
- `= null` —— **字段初始值**。一开始就是 `null`（未订阅）。

> 这个"先放 null、之后填真东西、用完再设回 null"的模式，是管理"可有可无的资源"的经典手法。它和第⑥篇 `client.ts` 里 `reconnectTimer` 那种"定时器句柄存起来以便取消"是一个套路。

---

## 第 37-46 行：`subscribe` 方法

```typescript
  /** Subscribe to the topic and receive messages via the handler. */
  subscribe(handler: MessageHandler): void {
    this.unsubscribeFromClient = this.client.onMessage(this.topic, handler);
    this.client.send({
      op: "subscribe",
      id: this.client.nextId("subscribe"),
      topic: this.topic,
      type: this.type,
    });
  }
```

- `subscribe(handler: MessageHandler): void` —— 接收一个"消息处理器"回调，返回 `void`。意思是"你给我一个函数，以后每来一条消息我就调用它"。

方法体两步，顺序很重要：

**第一步——先在本地登记好"消息来了交给谁"：**
```typescript
this.unsubscribeFromClient = this.client.onMessage(this.topic, handler);
```
- 调用 `client.onMessage(话题, 回调)`：告诉底层客户端"以后这个话题的消息，都转交给 `handler`"。
- `onMessage` 会**返回一个退订函数**（回忆第④篇"返回一个函数"的设计），我们把它存进刚才那个字段 `this.unsubscribeFromClient`。于是字段从 `null` 变成了真正的退订函数——以后退订时就靠它。

**第二步——再向服务端发出"我要订阅"的请求：**
```typescript
this.client.send({
  op: "subscribe",
  id: this.client.nextId("subscribe"),
  topic: this.topic,
  type: this.type,
});
```
- 这是第⑤篇的 `SubscribeMessage` 格式。
- `id: this.client.nextId("subscribe")` —— 调用客户端的 `nextId` 生成一个唯一编号（第⑥篇讲过，`nextId` 用一个自增计数器产出像 `"subscribe_1"` 这样的串）。
- `topic`/`type` 用实例里存的。

> **为什么先登记本地回调、再发订阅请求？** 因为消息随时可能回来。如果先发请求、还没登记回调，万一服务端"秒回"第一条消息，就没人接住、丢了。先把"接球手"站好，再喊"开始发球"，才不会漏。这种"先备好接收方，再触发"的顺序在异步编程里是通用安全准则。

---

## 第 48-59 行：`unsubscribe` 方法

```typescript
  /** Unsubscribe from the topic. */
  unsubscribe(): void {
    if (this.unsubscribeFromClient) {
      this.unsubscribeFromClient();
      this.unsubscribeFromClient = null;
    }
    this.client.send({
      op: "unsubscribe",
      id: this.client.nextId("unsubscribe"),
      topic: this.topic,
    });
  }
}
```

退订也是两步，和订阅正好对称：

**第一步——清掉本地登记：**
```typescript
if (this.unsubscribeFromClient) {
  this.unsubscribeFromClient();
  this.unsubscribeFromClient = null;
}
```
- `if (this.unsubscribeFromClient)` —— 先判断字段里**确实存了一个退订函数**（不是 `null`）才进去。
  - **语法小课堂：把一个"可能是 null 的值"直接放进 `if`，叫"真值判断（truthy check）"。** JS 里 `null`、`undefined`、`0`、`""`、`false` 都算"假值（falsy）"，其余都算"真值（truthy）"。所以 `if (this.unsubscribeFromClient)` 的含义是"如果它不是 null（确实存了个函数）"。这是判空的常用简写，等价于 `if (this.unsubscribeFromClient !== null)`。
- `this.unsubscribeFromClient();` —— 调用那个退订函数，把第一步登记的本地回调撤掉（注意末尾的 `()` 表示"调用它"）。
- `this.unsubscribeFromClient = null;` —— 调用完把字段设回 `null`，表示"已经退订、没有可退的了"。这样即使有人手滑再调一次 `unsubscribe`，`if` 也不会重复执行。

**第二步——通知服务端"我不订了"：**
```typescript
this.client.send({
  op: "unsubscribe",
  id: this.client.nextId("unsubscribe"),
  topic: this.topic,
});
```
- 第⑤篇的 `UnsubscribeMessage` 格式，极简：操作标签 + 一个 id + 话题名。
- `}` 关闭类。

> **本地撤回调 + 远程发退订，两件事都要做。** 只撤本地不通知服务端，服务端会继续往这条连接推消息（浪费带宽）；只通知服务端不撤本地，万一还有残留消息进来，旧回调可能被误触发。两步都做才干净。

---

## 整章回顾

这篇是上一篇"硬核 `client.ts`"之后的第一口轻松气。两个类的本质都一样：

> **把"发布/订阅/退订"这种动作，固定成一两句 `client.send({ op: ... })`，并管好与之配套的本地回调登记。**

| 类 | 职责 | 关键动作 |
|---|---|---|
| `TopicPublisher` | 发布 | 一句 `send({op:"publish",...})`，发完即忘 |
| `TopicSubscriber` | 订阅/退订 | 订阅＝先 `onMessage` 登记回调、再 `send` 订阅请求；退订＝先撤回调、再 `send` 退订请求 |

记住两条贯穿全篇的"顺序准则"：
1. **订阅**：先备好接收方（`onMessage`），再喊开始（`send subscribe`）。
2. **退订**：先撤本地（调用并清空退订函数），再通知远端（`send unsubscribe`）。

**语法点回顾清单**（本章新增）：
- 构造函数参数前写 `private`/`public`：**参数属性**简写（自动声明并赋值字段）
- 对象简写补充：`{ msg }` 即 `{ msg: msg }`（第⑥篇见过，这里再巩固）
- `(() => void) | null`：可空的函数类型字段，外层括号用来消歧义
- "先放 null、用时填、用完设回 null"管理可选资源的模式
- 真值判断 `if (someValue)`：非空/非假即进入（判空简写）

下一份：[`transport/rosbridge/services.ts` 逐行详解 →](08-rosbridge-services.ts.md)（用一个函数完整演示"请求-等待响应"的 Promise 配对）
