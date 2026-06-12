# 逐行详解 ㉖：`transport/local/transport.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/local/transport.ts](../../extensions/openclaw-plugin/src/transport/local/transport.ts)
>
> 推荐阅读顺序第 26 个文件，**第七部分开篇、也是目前最长的源文件（375 行）**。它是**模式 A** 的传输：当 OpenClaw **直接跑在机器人上**时，不必绕 rosbridge 网络，直接用本地 DDS 总线和 ROS2 对话。它和第⑩篇 `RosbridgeTransport` 实现的是**同一个 `RosTransport` 接口**（第④篇），所以你已经懂它"该有哪些方法"——这篇会有"换汤不换药"的熟悉感。新东西是底层换成了 Node 库 **`rclnodejs`**，由此引出本系列最后一个预告的大语法：**`createRequire`（CommonJS 互操作）**。本篇较长，我们按"接口的几大块"分段，节奏会比前面快——因为方法的"意图"你已在第④⑩篇熟知，重点只看"本地 DDS 怎么实现它"。

---

## 先理解模式 A 和 rclnodejs

- **rosbridge 模式（B）**：OpenClaw 在一台电脑、机器人在另一处，中间靠 WebSocket + rosbridge_server 转发（第⑤–⑩篇那一大套）。
- **本地模式（A）**：OpenClaw **就装在机器人身上**，和 ROS2 节点在同一台机器、同一条 DDS 总线上。这时根本不需要网络中转——直接用 ROS2 的原生通信即可。
- **`rclnodejs`** 是"ROS2 的 Node.js 客户端库"——它让 JavaScript 能直接创建 ROS2 节点、发布/订阅、调服务。模式 A 就靠它。
- **代价**：`rclnodejs` 是个**可选的、重型依赖**（需要 ROS2 环境，回忆第⑪篇工厂里那段"local 模式可能没装 rclnodejs"的错误处理）。所以本篇大量地方把它当 `any` 处理、动态加载——下面会看到。

---

## 第 1-21 行：导入 + `createRequire`（最后的大语法）

```typescript
import { createRequire } from "node:module";
import type { RosTransport } from "../transport.js";
import type {
  ConnectionStatus, ConnectionHandler, Subscription, PublishOptions,
  SubscribeOptions, ServiceCallOptions, ServiceCallResult, ActionGoalOptions,
  ActionResult, TopicInfo, ServiceInfo, ActionInfo, MessageHandler,
} from "../types.js";
import { EntityCache } from "./entities.js";
import { toRosMessage, fromRosMessage, loadMessageClass, clearTypeCache } from "./conversion.js";

const require = createRequire(import.meta.url);
```

- 第 2-17 行：导入 `RosTransport` 接口和一堆类型（和第⑩篇适配器几乎一样的清单），以及两个**同目录帮手文件**：
  - `EntityCache`（来自 `./entities.js`，第28篇讲）—— 缓存发布器/订阅器/服务客户端。
  - `toRosMessage`/`fromRosMessage`/`loadMessageClass`/`clearTypeCache`（来自 `./conversion.js`，第27篇讲）—— 在"普通 JS 对象"和"rclnodejs 类型化消息"之间转换。
  - **这两个帮手是本篇的左膀右臂**，这里先记住它们的用途，调用到时点一下，细节留给 27、28 篇。
- **第 1 行 + 第 21 行是本系列最后一个预告的大语法：**

```typescript
import { createRequire } from "node:module";
// ...
const require = createRequire(import.meta.url);
```
- **语法小课堂：`createRequire` 与 ESM / CommonJS 互操作。**
  - 回忆 CLAUDE.md：本项目是**纯 ESM**（用 `import`/`export`）。而 `rclnodejs` 是个老式的 **CommonJS（CJS）** 库——CJS 用的是另一套加载机制：`require("xxx")`（一个函数）。
  - 问题：ESM 文件里**默认没有 `require` 这个函数**（它是 CJS 的东西）。但我们偏偏要加载一个 CJS 库。
  - `createRequire(import.meta.url)` 就是 Node 提供的"桥"：它**造出一个能用的 `require` 函数**，让你在 ESM 文件里也能 `require("rclnodejs")` 加载 CJS 模块。
    - `import.meta.url` —— ESM 里表示"当前文件的地址"，`createRequire` 需要它来确定"从哪个位置去找模块"。
  - 造好后赋给 `const require = ...`，下面就能像 CJS 那样 `require("rclnodejs")` 了。
  - 一句话：**`createRequire` 是"在新式 ESM 代码里，借用旧式 CJS 的 `require` 加载机制"的官方手段。** 专门用于加载那些还没 ESM 化的老库。

> 至此，README 里"后面会补的大语法"全部讲完——`Promise.all`（第23篇）、`createRequire`（本篇）都已登场。

---

## 第 23-36 行：选项类型 + 内部过滤名单

```typescript
export interface LocalTransportOptions {
  domainId?: number;
}

/** Internal ROS2 topics/services to filter from introspection results. */
const INTERNAL_TOPIC_PREFIXES = ["/rosout", "/parameter_events", "/rosclaw/"];
const INTERNAL_SERVICE_SUFFIXES = [
  "/describe_parameters", "/get_parameter_types", "/get_parameters",
  "/list_parameters", "/set_parameters", "/set_parameters_atomically",
];
```

- `LocalTransportOptions` —— 本地传输的选项，就一个可选 `domainId`。
  - **DDS 的 domainId（域 ID）**：ROS2 用它把不同的机器人/系统隔开——同一个 domainId 的节点才能互相通信。默认 0。
- 两个常量数组：**自省时要过滤掉的"内部话题/服务"**。
  - ROS2 自己有一堆系统话题（`/rosout` 日志、`/parameter_events` 参数事件）和每个节点自带的参数服务（`/get_parameters` 等）。列话题/服务时这些是"噪音"，AI 不关心，所以建两份名单把它们滤掉。下面 `listTopics`/`listServices` 会用到。

---

## 第 44-59 行：类实现接口 + 一堆 `any` 字段 + 静态门闩

```typescript
export class LocalTransport implements RosTransport {
  private domainId: number;
  private status: ConnectionStatus = "disconnected";
  private connectionHandlers = new Set<ConnectionHandler>();
  /** rclnodejs module — loaded dynamically at runtime (optional dep, no types). */
  private rclnodejs: any = null;
  private node: any = null;
  private entityCache: EntityCache | null = null;
  private activeGoals = new Map<string, any>();

  /** Singleton guard — rclnodejs.init() must only be called once per process. */
  private static rclInitialized = false;

  constructor(options?: LocalTransportOptions) {
    this.domainId = options?.domainId ?? 0;
  }
```

- `implements RosTransport` —— 和第⑩篇一样，**承诺实现那 13 个方法**（第④/⑩篇 `implements`）。下面方法的"意图"与第⑩篇一一对应。
- 字段里多处 `any`（回忆第⑪篇 `any` 是"放弃类型检查"）：`rclnodejs`、`node`、`activeGoals` 的值都是 `any`。
  - **为什么这么多 `any`？** 注释说了：`rclnodejs` 是可选依赖、**可能没有类型定义**。没类型可标，就用 `any` 让 TS 别管。这是"和无类型的老库打交道"的现实妥协——代价是这部分失去类型保护，得自己小心。
- `private status: ConnectionStatus = "disconnected";` —— 当前连接状态，初始"断开"。
- `connectionHandlers = new Set<ConnectionHandler>();` —— 存连接状态回调的集合（`Set`，第⑥篇）。
  - **注意：和第⑩篇不同，这里自己管理回调集合**。第⑩篇是把 `onConnection` 转发给底层 client；本地模式没有那样的 client，得自己存回调、状态变了自己挨个通知（见下面 `setStatus`）。
- `entityCache: EntityCache | null` —— 那个实体缓存（第28篇），连接后才建。
- `activeGoals = new Map<string, any>()` —— 记录"正在进行的动作目标"，键是动作名、值是目标句柄（用于取消）。
- `private static rclInitialized = false;` —— **语法小课堂：`static`（静态成员）。**
  - 普通字段（如 `this.status`）是**每个实例各一份**。加 `static` 的字段是**整个类共享一份**（挂在类上，不在实例上），所有实例看到同一个。
  - 这里为什么要 static？注释：`rclnodejs.init()` **每个进程只能调一次**（它是全局初始化）。如果建了两个 `LocalTransport` 实例，不能各初始化一次。用 `static rclInitialized` 这个**类级别的门闩**，保证"全进程只初始化一次"（回忆第⑫篇并发门闩，这是它的 static 版）。
  - 访问时写 `LocalTransport.rclInitialized`（用类名，不是 `this`），下面会看到。
- 构造函数：取 `domainId`，没给就 0（`??`）。

---

## 第 63-90 行：`connect`——加载 rclnodejs、初始化、建节点

```typescript
  async connect(): Promise<void> {
    if (this.status === "connected") return;
    this.setStatus("connecting");

    try {
      this.rclnodejs = require("rclnodejs");

      if (this.domainId !== 0) {
        process.env.ROS_DOMAIN_ID = String(this.domainId);
      }

      if (!LocalTransport.rclInitialized) {
        await this.rclnodejs!.init();
        LocalTransport.rclInitialized = true;
      }

      this.node = this.rclnodejs!.createNode("rosclaw_local");
      this.rclnodejs!.spin(this.node);
      this.entityCache = new EntityCache();

      this.setStatus("connected");
    } catch (err) {
      this.setStatus("disconnected");
      throw err;
    }
  }
```

- `if (this.status === "connected") return;` —— 已连就直接返回（幂等：重复调用无害）。
- `this.setStatus("connecting");` —— 标记"连接中"（`setStatus` 见下面，会通知回调）。
- `try { ... } catch` —— 整个连接过程包起来，失败就退回"断开"并把错误抛出去。
- `this.rclnodejs = require("rclnodejs");` —— **用上面造的 `require` 加载 rclnodejs**。如果没装，这里抛错（回忆第⑪篇工厂会把它翻译成友好提示）。
- `if (this.domainId !== 0) { process.env.ROS_DOMAIN_ID = String(this.domainId); }` —— 非默认域就设环境变量 `ROS_DOMAIN_ID`。
  - **语法小课堂：`process.env.XXX` 是"读写环境变量"。** `process` 是 Node 的全局对象，`process.env` 是环境变量集合。rclnodejs 通过这个环境变量决定用哪个 DDS 域，所以**必须在 `init()` 之前设好**。`String(this.domainId)` 把数字转成字符串（环境变量都是字符串）。
- `if (!LocalTransport.rclInitialized) { await this.rclnodejs!.init(); ... }` —— **用静态门闩保证只初始化一次**：没初始化过才 `init()`，然后把门闩置 true。
  - `this.rclnodejs!` 的 `!` 是非空断言（第⑨篇）：上面刚赋了值，断言它非 null。
- `this.node = this.rclnodejs!.createNode("rosclaw_local");` —— 创建一个名为 `rosclaw_local` 的 ROS2 节点（我们在 DDS 总线上的"身份"）。
- `this.rclnodejs!.spin(this.node);` —— **`spin`（自转）让节点开始处理消息**。ROS2 里节点必须"spin"起来才能收发消息（相当于"开始监听/泵消息"）。
- `this.entityCache = new EntityCache();` —— 建实体缓存（第28篇）。
- `this.setStatus("connected");` —— 大功告成，标记已连。

---

## 第 92-127 行：`disconnect`——层层清理（逆序拆解）

```typescript
  async disconnect(): Promise<void> {
    if (this.status === "disconnected") return;

    // Cancel any active action goals
    for (const [action] of this.activeGoals) {
      try {
        await this.cancelActionGoal(action);
      } catch {
        // Best-effort
      }
    }
    this.activeGoals.clear();

    if (this.entityCache && this.node) {
      this.entityCache.destroyAll(this.node);
      this.entityCache = null;
    }

    if (this.node) {
      this.node.destroy();
      this.node = null;
    }

    if (this.rclnodejs && LocalTransport.rclInitialized) {
      try {
        this.rclnodejs.shutdown();
      } catch {
        // May already be shut down
      }
      LocalTransport.rclInitialized = false;
    }

    clearTypeCache();
    this.rclnodejs = null;
    this.setStatus("disconnected");
  }
```

- 断开要"按建立的逆序"把资源一层层拆掉。逐段：
  - **先取消所有进行中的动作**：`for (const [action] of this.activeGoals)` —— 遍历 Map。
    - **语法小课堂：`for (const [action] of 某Map)` 遍历 Map + 解构。** Map 遍历时每项是 `[键, 值]` 对，这里用数组解构 `[action]` **只取键**（动作名），值不要。逐个调 `cancelActionGoal` 取消。
    - 每个取消包 `try { } catch {}`（空 catch，第23篇）——`// Best-effort`（尽力而为）：取消失败也不影响继续断开。
    - `this.activeGoals.clear();` —— 清空记录。
  - **销毁实体缓存**：有缓存和节点就 `destroyAll`（第28篇）销毁所有发布器/订阅器/客户端，再置 null。
  - **销毁节点**：`this.node.destroy()`。
  - **关闭 rclnodejs**：`this.rclnodejs.shutdown()`，包 try/catch（可能已关）；并把静态门闩复位 `false`（允许将来重新 init）。
  - `clearTypeCache();` —— 清第27篇那个消息类型缓存。
  - `this.rclnodejs = null;` + `setStatus("disconnected")` —— 收尾。
- **整段是"对称清理"的范例**：connect 里建了什么，disconnect 就逆序拆什么；每步都防御性判断（`if (this.node)` 等）+ 尽力而为（空 catch），保证清理过程本身不会因小错中断。

---

## 第 129-138 行：`getStatus` / `onConnection`

```typescript
  getStatus(): ConnectionStatus {
    return this.status;
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }
```

- `getStatus` —— 直接返回当前状态字段。
- `onConnection` —— **自己管理回调集合**（不像第⑩篇转发给 client）：把回调加进 `Set`，返回一个退订函数（调用时从 `Set` 删除）。这是"登记回调 + 返回退订函数"的标准款（回忆第④/⑦篇）。

---

## 第 142-158 行：`publish` / `subscribe`（借助两个帮手）

```typescript
  publish(options: PublishOptions): void {
    this.ensureConnected();
    const publisher = this.entityCache!.getPublisher(this.node, options.topic, options.type);
    const rosMsg = toRosMessage(options.type, options.msg);
    publisher.publish(rosMsg);
  }

  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription {
    this.ensureConnected();
    const type = options.type ?? this.resolveTopicType(options.topic);
    if (!type) {
      throw new Error(`Cannot subscribe to ${options.topic}: type is required when it cannot be inferred`);
    }
    return this.entityCache!.addSubscription(this.node, options.topic, type, handler);
  }
```

- `this.ensureConnected();` —— 每个干活方法开头先确认已连接（见下面私有助手），没连就抛错。
- **`publish`**：
  - `this.entityCache!.getPublisher(...)` —— 从缓存拿（或建）一个发布器（第28篇）。
  - `const rosMsg = toRosMessage(options.type, options.msg);` —— **关键转换**：把上层给的"普通 JS 对象消息"转成 rclnodejs 要的"类型化消息实例"（第27篇）。这是本地模式特有的——rosbridge 走 JSON 不用转，本地走 rclnodejs 必须转成它认的类型。
  - `publisher.publish(rosMsg);` —— 发出去。
- **`subscribe`**：
  - `const type = options.type ?? this.resolveTopicType(options.topic);` —— 类型可省时，**尝试从节点的图信息里推断**（`resolveTopicType` 见下面）。
  - 推断不出（`if (!type)`）就抛错——本地模式订阅必须知道类型（不像 rosbridge 服务端有时能帮忙）。
  - `return this.entityCache!.addSubscription(...)` —— 委托给缓存去订阅，返回 `Subscription` 句柄（第28篇）。

---

## 第 162-196 行：`callService`（手工拼请求 + Promise 包装）

```typescript
  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    this.ensureConnected();

    const type = options.type ?? this.resolveServiceType(options.service);
    if (!type) {
      throw new Error(`Cannot call service ${options.service}: type is required when it cannot be inferred`);
    }

    const client = this.entityCache!.getServiceClient(this.node, options.service, type);

    const available = await client.waitForService(5000);
    if (!available) {
      throw new Error(`Service ${options.service} not available after 5 seconds`);
    }

    const ServiceClass = loadMessageClass(type);
    const request = new ServiceClass.Request();
    if (options.args) {
      for (const [key, value] of Object.entries(options.args)) {
        request[key] = value;
      }
    }

    const response = await this.sendServiceRequest(client, request, 30_000);

    return {
      result: true,
      values: fromRosMessage(response),
    };
  }
```

- 推断类型（同 subscribe 思路）、从缓存拿服务客户端。
- `await client.waitForService(5000)` —— **等服务端就绪（最多 5 秒）**。本地 DDS 里服务端可能还没起来，先等等；等不到就抛错。
- **手工拼请求对象**：
  - `const ServiceClass = loadMessageClass(type);` —— 加载服务类型类（第27篇）。
  - `const request = new ServiceClass.Request();` —— new 一个空请求实例。
  - `if (options.args) { for (const [key, value] of Object.entries(options.args)) { request[key] = value; } }` —— **把参数逐个拷进请求对象**。
    - **语法小课堂：`Object.entries(对象)` —— 把对象拆成 `[键, 值]` 对的数组**，配合 `for...of` + 解构 `[key, value]` 就能遍历对象的每个字段。这里把 `args` 里每个字段赋到 `request` 上。（这是遍历对象所有键值的标准写法。）
- `const response = await this.sendServiceRequest(client, request, 30_000);` —— 调私有助手把"回调式的发请求"包装成 Promise + 30 秒超时（见下面）。
- 返回 `{ result: true, values: fromRosMessage(response) }` —— **把 rclnodejs 的响应转回普通对象**（`fromRosMessage`，第27篇，与 publish 的 `toRosMessage` 相反方向）。
  - 注意 `result: true` 写死——本地模式里能拿到响应就算成功（不像 rosbridge 响应自带 result 字段）。

---

## 第 200-257 行：`sendActionGoal`（回调式动作 → Promise + finally 清理）

```typescript
  async sendActionGoal(options: ActionGoalOptions): Promise<ActionResult> {
    this.ensureConnected();

    const ActionClass = loadMessageClass(options.actionType);
    const actionClient = new (this.rclnodejs!.ActionClient as any)(
      this.node, ActionClass, options.action,
    );

    const available = await actionClient.waitForServer(5000);
    if (!available) {
      actionClient.destroy();
      throw new Error(`Action server ${options.action} not available after 5 seconds`);
    }

    const goal = new ActionClass.Goal();
    if (options.args) {
      for (const [key, value] of Object.entries(options.args)) {
        goal[key] = value;
      }
    }

    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.activeGoals.delete(options.action);
          reject(new Error(`Action ${options.action} timed out after 120 seconds`));
        }, 120_000);

        actionClient.sendGoal(
          goal,
          (goalHandle: any) => {
            this.activeGoals.set(options.action, goalHandle);
          },
          (feedback: any) => {
            if (options.onFeedback) {
              options.onFeedback(fromRosMessage(feedback));
            }
          },
          (resultResponse: any) => {
            clearTimeout(timer);
            this.activeGoals.delete(options.action);
            resolve(fromRosMessage(resultResponse));
          },
        );
      });

      return { result: true, values: result };
    } finally {
      actionClient.destroy();
    }
  }
```

这是本篇最复杂的方法，但**骨架就是第⑨篇 + 第⑯篇的组合**（Promise 包装回调 + 超时 + `try/finally` 清理）。逐看：

- 加载动作类、`new ActionClient(...)`：
  - `new (this.rclnodejs!.ActionClient as any)(...)` —— **语法小课堂：`new (表达式 as any)(...)`。** `ActionClient` 类挂在 rclnodejs 上、是 `any`（无类型）。要 `new` 一个 `any` 的构造器，TS 会犹豫，所以把它 `as any` 后用圆括号包起来再 `new`。是和无类型库打交道时的常见写法。
- `await actionClient.waitForServer(5000)` —— 等动作服务器就绪，等不到先 `destroy()` 清理再抛错。
- 拼 `goal` 对象（同 callService 拼 request 的写法：`Object.entries` 逐个赋）。
- **核心 Promise**（包住 rclnodejs 那套回调）：
  - `setTimeout(...120_000)` —— 120 秒超时（动作是长任务，第⑨篇同款时长），超时就从 `activeGoals` 删掉并 reject。
  - `actionClient.sendGoal(goal, 回调1, 回调2, 回调3)` —— rclnodejs 的发目标要**三个回调**：
    1. **目标响应回调** `(goalHandle) => this.activeGoals.set(options.action, goalHandle)` —— 服务器接受目标后给个"目标句柄"，**存进 `activeGoals` 备用**（取消时要用它）。
    2. **进度反馈回调** `(feedback) => { if (options.onFeedback) options.onFeedback(fromRosMessage(feedback)); }` —— 每来一条进度，转成普通对象后转交上层的 `onFeedback`（回忆第⑩篇也做过类似的"进度转交"）。
    3. **结果回调** `(resultResponse) => { clearTimeout(timer); this.activeGoals.delete(...); resolve(fromRosMessage(resultResponse)); }` —— 动作完成：清超时、移除记录、`resolve` 最终结果（转成普通对象）。
  - 这就是"把回调式 API 包装成 Promise"（第⑧篇思想）的又一次实践，只是这里有三个回调要安置。
- `return { result: true, values: result };` —— 成功返回。
- **`finally { actionClient.destroy(); }`** —— **无论成功/超时/出错，都销毁这个动作客户端**（第⑨篇 `try/finally` 的清理精髓）。动作客户端是一次性的，用完必须销毁，放 finally 万无一失。

---

## 第 259-265 行：`cancelActionGoal`

```typescript
  async cancelActionGoal(action: string): Promise<void> {
    const goalHandle = this.activeGoals.get(action);
    if (goalHandle && typeof goalHandle.cancelGoal === "function") {
      await goalHandle.cancelGoal();
      this.activeGoals.delete(action);
    }
  }
```

- 从 `activeGoals` 取出那个动作的"目标句柄"（上面回调1存的）。
- `if (goalHandle && typeof goalHandle.cancelGoal === "function")` —— **双重保险**：句柄存在、且它确实有个 `cancelGoal` 方法（`typeof ... === "function"` 检查，第⑥篇）。因为句柄是 `any`，不确定有没有这方法，先查一下更稳。
- 有就 `await goalHandle.cancelGoal()` 取消、并从记录里删除。

---

## 第 269-310 行：三个自省方法（filter + some 过滤内部项）

```typescript
  async listTopics(): Promise<TopicInfo[]> {
    this.ensureConnected();
    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getTopicNamesAndTypes();
    return namesAndTypes
      .filter((t) => !INTERNAL_TOPIC_PREFIXES.some((prefix) => t.name.startsWith(prefix)))
      .map((t) => ({ name: t.name, type: t.types[0] ?? "" }));
  }
```

- `this.node.getTopicNamesAndTypes()` —— rclnodejs **直接从 DDS 图里拿到所有话题名和类型**（比 rosbridge 还方便——本地能直接查图，不用调 rosapi 服务）。
  - 返回类型显式标成 `Array<{ name: string; types: string[] }>`（每项有名字和类型数组）。
- **链式 `.filter(...).map(...)`**：
  - `.filter((t) => !INTERNAL_TOPIC_PREFIXES.some((prefix) => t.name.startsWith(prefix)))` —— 滤掉内部话题。
    - **语法小课堂：`数组.some(判断函数)` —— "有没有任意一个元素满足"**，返回 true/false。`INTERNAL_TOPIC_PREFIXES.some((prefix) => t.name.startsWith(prefix))` 读作"这话题名是否以**任意一个**内部前缀开头"。前面加 `!` 取反 → "不以任何内部前缀开头的才保留"。
    - `.some` 配 `.filter` 是"按一组条件批量过滤"的经典组合。
  - `.map((t) => ({ name: t.name, type: t.types[0] ?? "" }))` —— 转成 `TopicInfo`（第⑩篇见过的 `.map` + 返回对象套圆括号 + `?? ""` 兜底）。取 `types[0]`（第一个类型）。
- `listServices`（第280行）—— 同款，但**两道 filter**：先滤"内部服务后缀"（`.endsWith` + `.some`），再滤"内部前缀"。链式 filter 可以叠加多个条件。
- `listActions`（第292行）—— **和第⑩篇 `listActions` 几乎一字不差**：没有现成的列动作接口，用"找 `/_action/feedback` 后缀话题反推动作名"的启发式（第⑩篇详讲过，这里直接复用同一套 `.slice`/`.endsWith` 逻辑）。注释也明说 `Same ... heuristic as rosbridge/adapter.ts`。

---

## 第 314-374 行：私有助手们

### `setStatus`（改状态 + 通知所有回调）

```typescript
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      handler(status);
    }
  }
```
- 改状态字段，然后**遍历回调集合挨个通知**（`for...of` 遍历 Set）。这就是为什么前面 `connect`/`disconnect` 里改状态都走 `setStatus`——好统一触发通知。

### `ensureConnected`（前置守卫）

```typescript
  private ensureConnected(): void {
    if (this.status !== "connected" || !this.node || !this.entityCache) {
      throw new Error("LocalTransport is not connected");
    }
  }
```
- 三个条件任一不满足就抛错。每个干活方法开头都调它，**把"没连接"的情况挡在最前面**，省得后面各方法各自判空。

### `resolveTopicType` / `resolveServiceType`（从图里推断类型）

```typescript
  private resolveTopicType(topic: string): string | undefined {
    if (!this.node) return undefined;
    const namesAndTypes: Array<{ name: string; types: string[] }> =
      this.node.getTopicNamesAndTypes();
    const entry = namesAndTypes.find((t) => t.name === topic);
    return entry?.types[0];
  }
```
- 用来在 `subscribe`/`callService` 省略类型时自动推断。
- **语法小课堂：`数组.find(判断函数)` —— "找出第一个满足条件的元素"**（找不到返回 `undefined`）。和 `.filter`（找全部）不同，`.find` 只要第一个。这里找名字匹配的那一项。
- `return entry?.types[0];` —— 可选链（第⑥篇）：找到就返回它第一个类型，没找到（`entry` 是 undefined）整体返回 undefined。
- `resolveServiceType` 同款，换成服务。

### `sendServiceRequest`（回调式 → Promise + 超时）

```typescript
  private sendServiceRequest(client: any, request: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Service call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        client.sendRequest(request, (response: any) => {
          clearTimeout(timer);
          if (response) {
            resolve(response);
          } else {
            reject(new Error("Service returned no response"));
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }
```
- 又一次"把回调式 API 包成 Promise + 超时"（第⑧/⑯篇思想）：
  - 设超时定时器 → 超时 reject。
  - `client.sendRequest(request, 回调)` —— rclnodejs 发请求，响应到了走回调：清超时 → 有响应 resolve、没响应 reject。
  - 外层 try/catch：发请求这一步本身就抛错的话，也清超时 + reject。
- 这是 `callService` 用到的底层助手。

---

## 整章回顾

`LocalTransport`（模式 A）和第⑩篇 `RosbridgeTransport` 实现**同一个 `RosTransport` 接口**，但底层从"WebSocket+JSON"换成"rclnodejs+DDS"。关键差异：

| 方面 | rosbridge（⑩） | local（本篇） |
|---|---|---|
| 加载方式 | 普通 import | **`createRequire`** 加载 CJS 的 rclnodejs |
| 消息形态 | JSON 对象直接走 | 需 `toRosMessage`/`fromRosMessage` **转换类型化消息**（第27篇） |
| 实体管理 | client 内部管 | 自己用 **`EntityCache`** 缓存发布器/订阅器/客户端（第28篇） |
| 初始化 | 连 WebSocket | `rclnodejs.init()`（**static 门闩保证全进程一次**）+ 建节点 + spin |
| 自省 | 调 rosapi 服务 | 直接 `node.getTopicNamesAndTypes()` 查 DDS 图 + filter/some 过滤内部项 |
| 类型 | 有类型 | 大量 `any`（rclnodejs 可选依赖、无类型） |

但"每个方法该返回什么、回调式如何包成 Promise、动作如何 try/finally 清理"这些**模式你全在前面学过了**——这正是"实现同一接口"带来的熟悉感。

**语法点回顾清单**（本章新增/巩固）：
- **`createRequire(import.meta.url)`**：在 ESM 里借用 CJS 的 `require` 加载老库（最后一个预告大语法）
- `process.env.XXX`：读写环境变量；`import.meta.url` 当前文件地址
- `static` 静态成员（类共享一份）+ 静态门闩（全进程只初始化一次）
- `Object.entries(对象)` + `for...of [key,value]`：遍历对象所有键值
- `for (const [key] of 某Map)`：遍历 Map 只取键
- 数组 `.some(判断)`（有无任一满足）、`.find(判断)`（找第一个）、链式 `.filter().map()`、叠加多个 `.filter`
- `new (x as any)(...)`、`typeof x.fn === "function"` 防御性检查（与无类型库打交道）
- 对称清理：connect 建什么、disconnect 逆序拆什么 + 防御判断 + 尽力而为空 catch
- 回调式 API → Promise + 超时（巩固第⑧⑯篇）、动作三回调 + `try/finally` 销毁（巩固第⑨篇）

下一份：[`transport/local/conversion.ts` 逐行详解 →](27-local-conversion.ts.md)（本篇反复用到的"消息转换"帮手：普通对象 ↔ rclnodejs 类型化消息，含递归赋值）
