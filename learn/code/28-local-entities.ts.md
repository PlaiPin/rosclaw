# 逐行详解 ㉘：`transport/local/entities.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/local/entities.ts](../../extensions/openclaw-plugin/src/transport/local/entities.ts)
>
> 推荐阅读顺序第 28 个文件，**本地模式三大件的最后一块**（前两块是第26篇传输主体、第27篇消息转换）。它叫 `EntityCache`（实体缓存）：把 rclnodejs 的**发布器（publisher）、订阅器（subscription）、服务客户端（service client）** 缓存起来复用——同一个话题反复发布时，共用一个发布器，而不是每次新建。本篇没有全新语法，是前面学过的 **Map 缓存 + Set 多订阅者 + 退订清理**的综合应用，读起来会很顺。

---

## 先理解为什么要"缓存实体"

- 在 rclnodejs 里，"发布器""订阅器""服务客户端"都是**有成本的 DDS 实体**——创建它们要占资源、要在 DDS 网络上注册。
- 如果每次 `publish` 都新建一个发布器，发 100 次就建 100 个，浪费且容易出问题。
- **正确做法**：同一个 `(话题, 类型)` 只建一个发布器，缓存起来，之后复用。订阅器、服务客户端同理。
- 注释说这"和参考实现里的 `_pubs`/`_subs`/`_srv_clients` 映射是同一套路"——**用 Map 做"键→实体"的缓存**，是各 ROS2 客户端的通用模式。

---

## 第 1-13 行：模块注释 + 导入 + 两个类型别名

```typescript
import type { Subscription } from "../types.js";
import { loadMessageClass, fromRosMessage } from "./conversion.js";

type Node = any;
type MessageHandler = (msg: Record<string, unknown>) => void;
```

- 导入：`Subscription` 句柄类型（第③篇）、以及第27篇的 `loadMessageClass`（加载消息类）和 `fromRosMessage`（实例转普通对象）。
- `type Node = any;` —— **语法小课堂：`type X = any` 给 `any` 起个别名。**
  - rclnodejs 的节点对象没类型，本该到处写 `any`。这里起个别名 `Node`，**让代码读起来有意义**（看到 `node: Node` 比 `node: any` 更能表达"这是个 ROS2 节点"），虽然实际还是 `any`。这是"给无类型的东西起个有意义的名字"的小技巧——**自我文档化**。
- `type MessageHandler = (msg: Record<string, unknown>) => void;` —— 消息回调的函数类型（收一个普通对象、返回 void）。和第③篇接口里的同名类型一致，这里本地模块自己定义一份。

---

## 第 15-19 行：类 + 三个缓存 Map

```typescript
export class EntityCache {
  private publishers = new Map<string, any>();
  private subscriptions = new Map<string, { handle: any; handlers: Set<MessageHandler> }>();
  private serviceClients = new Map<string, any>();
```

- 三个私有 Map，对应三类实体：
  - `publishers` —— 键是字符串、值是发布器（`any`）。
  - `serviceClients` —— 键是字符串、值是服务客户端。
  - `subscriptions` —— **值的结构更复杂**：`{ handle: any; handlers: Set<MessageHandler> }`。
    - `handle` —— 那个 rclnodejs 订阅器实体。
    - `handlers` —— 一个 **`Set`**（第⑥篇）装多个回调。
    - **为什么订阅要存一组 handlers？** 因为可能有**多处都想订同一个话题**。我们只建**一个** rclnodejs 订阅器（省资源），但把它收到的消息**分发给所有登记的回调**。所以一个订阅实体配一个回调集合。下面 `addSubscription` 会看到这个设计的妙处。

---

## 第 20-32 行：`getPublisher`——取或建发布器（缓存套路）

```typescript
  getPublisher(node: Node, topic: string, typeStr: string): any {
    const key = `${topic}::${typeStr}`;
    const cached = this.publishers.get(key);
    if (cached) return cached;

    const MessageClass = loadMessageClass(typeStr);
    const publisher = node.createPublisher(MessageClass, topic);
    this.publishers.set(key, publisher);
    return publisher;
  }
```

- `const key = \`${topic}::${typeStr}\`;` —— **用"话题::类型"拼一个缓存键**。
  - 为什么把两者拼起来当键？因为唯一标识一个发布器需要话题 + 类型两者。用 `::` 连接（一个不会出现在话题名里的分隔符），拼成单个字符串当 Map 的键。这是"多字段组合键"的常见做法。
- 接下来是**标准缓存套路**（第27篇 `loadMessageClass`、第23篇能力缓存同款）：
  - `const cached = this.publishers.get(key); if (cached) return cached;` —— 查缓存，有就返回。
  - 没有：`loadMessageClass(typeStr)` 加载消息类 → `node.createPublisher(...)` 真正建发布器 → `this.publishers.set(key, publisher)` 存进缓存 → 返回。
- 第26篇 `publish` 里 `this.entityCache!.getPublisher(...)` 调的就是它。

---

## 第 34-82 行：`addSubscription`——多订阅者共享一个订阅器（本篇精华）

```typescript
  addSubscription(node: Node, topic: string, typeStr: string, handler: MessageHandler): Subscription {
    const key = `${topic}::${typeStr}`;
    let entry = this.subscriptions.get(key);

    if (!entry) {
      const MessageClass = loadMessageClass(typeStr);
      const handlers = new Set<MessageHandler>();

      const handle = node.createSubscription(
        MessageClass,
        topic,
        (msg: any) => {
          const plain = fromRosMessage(msg);
          for (const h of handlers) {
            h(plain);
          }
        },
      );

      entry = { handle, handlers };
      this.subscriptions.set(key, entry);
    }

    entry.handlers.add(handler);

    return {
      unsubscribe: () => {
        entry!.handlers.delete(handler);
        if (entry!.handlers.size === 0) {
          try {
            node.destroySubscription(entry!.handle);
          } catch {
            // Already destroyed
          }
          this.subscriptions.delete(key);
        }
      },
    };
  }
```

这是本篇最精巧的方法。它实现"**多个回调共享一个底层订阅器**"。逐段：

### 第一步：没有就建一个订阅器（含分发逻辑）

- `let entry = this.subscriptions.get(key);` —— 查这个话题有没有已建的订阅条目。用 `let` 因为可能要赋新值。
- `if (!entry) { ... }` —— **第一次订这个话题**，才建底层订阅器：
  - `const handlers = new Set<MessageHandler>();` —— 建一个空回调集合。
  - `node.createSubscription(类, 话题, 收到消息的回调)` —— 建**唯一**的 rclnodejs 订阅器。它的回调是关键：
    ```typescript
    (msg: any) => {
      const plain = fromRosMessage(msg);   // 类型化消息转普通对象（第27篇）
      for (const h of handlers) {          // 遍历所有登记的回调
        h(plain);                          // 挨个分发
      }
    }
    ```
    - **每来一条消息，转成普通对象后，分发给 `handlers` 里的每一个回调**。这就是"一个订阅器，多个订阅者"的实现核心——底层只收一份，上层每个订阅者都收到。
  - `entry = { handle, handlers };` —— 把订阅器实体和回调集合打包成条目，存进 Map。

### 第二步：把本次的回调加入集合

- `entry.handlers.add(handler);` —— 不管是新建的还是已有的条目，**都把这次的 `handler` 加进回调集合**。
  - 于是：第一次订阅 → 建订阅器 + 加回调；第二次订同话题 → 复用订阅器，只加回调。**省了重复建订阅器。**

### 第三步：返回带"智能退订"的句柄

- 返回一个 `Subscription`（第③篇：带 `unsubscribe` 的对象，回忆第⑩篇也现造过这种小对象）：
  ```typescript
  unsubscribe: () => {
    entry!.handlers.delete(handler);          // 先把自己这个回调移除
    if (entry!.handlers.size === 0) {         // 如果没有回调了
      try { node.destroySubscription(entry!.handle); } catch { }  // 才真正销毁订阅器
      this.subscriptions.delete(key);          // 并从缓存移除
    }
  }
  ```
  - **退订逻辑很讲究**：调用者退订时，**只移除它自己那个回调**（`handlers.delete(handler)`）。
  - `if (entry!.handlers.size === 0)` —— **只有当最后一个回调也退订了**（集合空了，`.size` 是 Set 元素个数），才真正销毁底层订阅器、从缓存删掉。
  - **为什么这样？** 因为订阅器是共享的——只要还有别的订阅者在用，就不能销毁。**等所有人都退订了，才拆掉**。这叫"引用计数"式的清理：共享资源用的人都走光了才释放。
  - `entry!` 的 `!` 非空断言（第⑨篇）：闭包里 `entry` 此时必然有值。
  - 销毁包 `try { } catch {}`（空 catch，第23篇）：可能已被销毁，无所谓。

> **这个方法把"缓存复用"做到了订阅这种"一对多"场景**：底层一个订阅器、上层多个回调，建时复用、退时引用计数清理。比发布器（一对一）精巧不少，值得细品。

---

## 第 84-96 行：`getServiceClient`——取或建服务客户端

```typescript
  getServiceClient(node: Node, service: string, typeStr: string): any {
    const key = `${service}::${typeStr}`;
    const cached = this.serviceClients.get(key);
    if (cached) return cached;

    const ServiceClass = loadMessageClass(typeStr);
    const client = node.createClient(ServiceClass, service);
    this.serviceClients.set(key, client);
    return client;
  }
```

- 和 `getPublisher` **一模一样的缓存套路**，只是换成服务客户端（`node.createClient`）。理解了 `getPublisher` 这个直接跳过。
- 第26篇 `callService` 里调的就是它。

---

## 第 98-128 行：`destroyAll`——断开时销毁所有实体

```typescript
  destroyAll(node: Node): void {
    for (const pub of this.publishers.values()) {
      try {
        node.destroyPublisher(pub);
      } catch {
        // Best-effort cleanup
      }
    }
    this.publishers.clear();

    for (const { handle } of this.subscriptions.values()) {
      try {
        node.destroySubscription(handle);
      } catch {
        // Best-effort cleanup
      }
    }
    this.subscriptions.clear();

    for (const client of this.serviceClients.values()) {
      try {
        node.destroyClient(client);
      } catch {
        // Best-effort cleanup
      }
    }
    this.serviceClients.clear();
  }
```

- 第26篇 `disconnect` 调它，**一次性销毁所有缓存的实体**。三段结构相同：
  - **语法小课堂：`Map.values()` 遍历 Map 的所有值。** （对照第26篇 `for (const [key] of map)` 遍历键值对、这里 `for (const x of map.values())` 只遍历值。）
  - 遍历每个实体，调对应的销毁方法（`destroyPublisher`/`destroySubscription`/`destroyClient`），各包 `try { } catch {}`（**尽力而为**，第26篇同款——销毁失败不影响销毁其他的）。
  - 销毁完 `.clear()` 清空 Map。
- 订阅那段用了解构：`for (const { handle } of this.subscriptions.values())` —— **对象解构 `{ handle }`**（第⑪篇）：每个值是 `{ handle, handlers }`，这里只取出 `handle`（要销毁的是订阅器实体，回调集合不用管）。
- **整段是"批量清理"的范例**：遍历每类实体逐个销毁、各自容错、最后清空。和第26篇 `disconnect` 的对称清理精神一致。

---

## 整章回顾

`EntityCache` 用三个 Map 缓存 rclnodejs 的三类实体，避免重复创建：

| 实体 | 方法 | 特点 |
|---|---|---|
| 发布器 | `getPublisher` | 一对一缓存（标准"查→建→存"套路） |
| 服务客户端 | `getServiceClient` | 同上 |
| 订阅器 | `addSubscription` | **一对多**：一个底层订阅器 + 一组回调，分发给所有人；引用计数式退订 |
| 全部 | `destroyAll` | 断开时批量销毁、尽力而为 |

最值得记住的是 `addSubscription` 的"**多订阅者共享一个订阅器 + 引用计数清理**"——只在第一个订阅者来时建实体、最后一个走时拆实体，中间复用。

**语法点回顾清单**（本章新增/巩固）：
- `type X = any` 给 any 起有意义的别名（自我文档化）
- 组合键 `` `${a}::${b}` ``：多字段拼成单个 Map 键
- 缓存套路"查→命中即返→未命中则建+存"（巩固第23、27篇）
- 一对多分发：`Set<回调>` + 收到消息 `for...of` 挨个调用
- 引用计数式退订：`handlers.delete(自己)` → `if (size===0)` 才销毁底层实体
- `Map.values()` 遍历值、`for (const { handle } of ...)` 遍历 + 对象解构
- 批量清理：逐个 `try{销毁}catch{}` 尽力而为 + `.clear()`（巩固第26篇对称清理）

---

## 🎉 第七部分之模式 A（本地 DDS）讲完！

本地模式三大件齐活：

> **传输主体 `LocalTransport`（26）** + **消息转换 `conversion`（27）** + **实体缓存 `entities`（28）**。

它们合起来，让 OpenClaw 直接跑在机器人上、经 rclnodejs 用本地 DDS 通信——和 rosbridge 模式实现同一个 `RosTransport` 接口，但底层完全不同。你现在已经看过**两种**传输实现了，对"同一接口、不同实现"有了切身体会。

下一批进入**模式 C（WebRTC）**——它目前是**存根（stub）**（回忆 CLAUDE.md：未实现、带 `// TODO` 和正确类型签名）。所以那几篇会侧重"**接口/信令协议怎么定义、存根怎么写**"，而非真实逻辑。先从信令协议的类型定义（第29篇）开始。

下一份：[`transport/webrtc/signaling-types.ts` 逐行详解 →](29-webrtc-signaling-types.ts.md)（WebRTC 信令消息的类型定义——回到第③⑤篇那种"纯类型契约"的味道）
