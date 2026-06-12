# 逐行详解 ⑥：`transport/rosbridge/client.ts`（最难的一篇）

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/client.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/client.ts)
>
> 推荐阅读顺序第 6 个文件，也是**全项目最复杂、最值得细读**的一个。它是底层 WebSocket 连接的完整管理者，负责四件事：**①连接与重连 ②消息路由 ③请求-响应追踪 ④重连后恢复订阅**。
>
> 这是第一篇出现大量"真正执行逻辑"的文件。语法密度很高，所以我先用一节把贯穿全文的几个大概念讲透，再逐行走。**别急，慢慢来。**

---

## 开篇预备：5 个贯穿全文件的大语法

读这个文件前，先建立这 5 个概念，后面就顺了。

### 预备 1：什么是"类（class）"？

前面我们用 `interface` 描述"形状"，但形状不会自己干活。**`class`（类）才是"既有数据、又有能做事的方法、还能被造出实例"的东西。**

打个比方：`class` 是"图纸"（比如汽车设计图），按图纸造出来的具体东西叫"**实例（instance）**"或"对象"（比如一辆真车）。同一个 class 能造很多实例。

```typescript
class 计数器 {
  count = 0;             // 这是"字段"——每个实例自带的数据
  increase() {           // 这是"方法"——实例能做的事
    this.count = this.count + 1;
  }
}

const c = new 计数器();  // new 关键字：按图纸造一个实例
c.increase();            // 调用方法，c.count 变成 1
```

- **`new`** 关键字用来"造一个实例"。
- 实例自带数据（字段）和能力（方法）。

本文件就是定义了一个 `class RosbridgeClient`——一个能管理 WebSocket 连接的"机器"。

### 预备 2：`this` 是什么？

在 class 的方法内部，**`this` 指"当前这个实例自己"**。`this.count` 就是"我这个实例的 count 字段"，`this.connect()` 就是"调用我自己的 connect 方法"。

为什么需要 `this`？因为同一个 class 能造很多实例，每个实例的数据各不相同。方法里必须用 `this` 才能指明"操作的是我这个实例的数据，不是别人的"。

**只要看到 `this.xxx`，就读成"我自己的 xxx"。** 这是本文件出现最频繁的写法。

### 预备 3：`Map` 和 `Set` 是什么？

它们是 JS 内置的两种"容器"：

- **`Map`（映射表）**：存"键 → 值"的对应关系，像一本字典。
  - `map.set(键, 值)` 存一条；`map.get(键)` 取值；`map.has(键)` 问"有没有这个键"；`map.delete(键)` 删一条；`map.keys()` 拿所有键。
- **`Set`（集合）**：存"一堆不重复的值"，像一个无序、去重的清单。
  - `set.add(值)` 加一个；`set.delete(值)` 删一个；`set.has(值)` 问"在不在"。
  - 同一个值加两次只算一个（自动去重）。

本文件用 `Map` 记"话题名 → 哪些处理器"、用 `Set` 装"一组处理器"。

### 预备 4：`Promise` 的"构造"用法

第①篇讲过 `Promise` 是"将来才有的结果"。之前我们只是"接收"别人给的 Promise，这里要**亲手造一个**：

```typescript
new Promise<void>((resolve, reject) => {
  // 这里写"异步操作"
  // 成功时调用 resolve(结果) —— 兑现承诺
  // 失败时调用 reject(错误) —— 拒绝承诺
});
```

- `new Promise(...)` 造一个承诺。
- 括号里传一个函数，这个函数会**立刻被执行**，它收到两个工具：
  - `resolve` —— 你调用它，就表示"成功了"，Promise 兑现，`await` 它的人就拿到结果继续。
  - `reject` —— 你调用它，表示"失败了"，Promise 被拒绝，`await` 它的人会收到一个错误（异常）。
- 这套机制专门用来**把"基于回调/事件的老式异步"包装成现代的 Promise**。WebSocket 是基于事件的（`onopen`、`onclose`……），所以这里要手动包一层。

### 预备 5：`setTimeout` 定时器

- `setTimeout(函数, 毫秒)` —— "等这么多毫秒后，执行一次这个函数"。它返回一个"定时器句柄"。
- `clearTimeout(句柄)` —— "取消那个还没触发的定时器"。

本文件用它做"连接超时""请求超时""延迟重连"。

好，预备知识到此。下面逐行走。

---

## 第 1-8 行：导入

```typescript
import WebSocket from "ws";
import type {
  RosbridgeClientOptions,
  ConnectionStatus,
  RosbridgeMessage,
  MessageHandler,
  ConnectionHandler,
} from "./types.js";
```

- `import WebSocket from "ws";` —— 从第三方库 `"ws"` 导入 `WebSocket`。
  - **语法小课堂：这是"默认导入"。** 注意它**没有花括号**（对比第②篇 `import { z }` 有花括号）。
    - `import { 名字 }` —— **具名导入**：拿这个库导出的、叫这个名字的东西。
    - `import 名字 from` —— **默认导入**：拿这个库的"默认导出"（一个库只能有一个默认导出），名字随你起。
  - `"ws"` 是 Node.js 上最常用的 WebSocket 库（浏览器自带 WebSocket，但 Node.js 服务端需要这个库补上）。
  - 注意这一行**没有** `type`——因为我们要在运行时真的 `new WebSocket(...)`，它是真实代码。
- 第二段 `import type { ... } from "./types.js"` —— 从上一篇的 `types.ts` 导入 5 个类型（只导类型，故有 `type`）。

---

## 第 10-15 行：辅助接口 `PendingRequest`

```typescript
/** Pending request/response tracker for service calls and action goals. */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
```

注释：「用于服务调用和动作目标的"待响应请求"追踪器」。

这个接口描述"一个还在等回应的请求"需要记住哪三样东西：

- `resolve: (value: unknown) => void;` —— 一个"兑现"函数（来自某个 Promise）。等回应到了，调用它就能让那个 Promise 成功。
- `reject: (reason: Error) => void;` —— 一个"拒绝"函数。出错/超时就调用它让 Promise 失败。
  - **为什么要把 `resolve`/`reject` 存起来？** 这是本文件最核心的设计：我们发出一个服务请求时，造一个 Promise 并把它的 `resolve`/`reject` **存进一张表**；将来回应从 WebSocket 飘回来时，再从表里找出对应的 `resolve` 来兑现。这样就把"事件"和"Promise"接起来了（预备 4 的实战）。
- `timer: ReturnType<typeof setTimeout>;` —— 这个请求的超时定时器句柄。
  - **语法小课堂：`ReturnType<typeof setTimeout>` 是什么？** 拆开看：
    - `typeof setTimeout` —— 取 `setTimeout` 这个函数的类型（第②篇讲过 `typeof 值` 把值翻译成类型）。
    - `ReturnType<...>` —— TS 内置的"取一个函数的**返回值类型**"的工具。
    - 合起来：`setTimeout` 返回的那个定时器句柄是什么类型，这里就是什么类型。（在 Node.js 和浏览器里这个类型不一样，用 `ReturnType` 自动适配，不用写死。）

---

## 第 17-21 行：类声明开始

```typescript
/**
 * WebSocket client for the rosbridge protocol.
 * Handles connection lifecycle, reconnection, and message routing.
 */
export class RosbridgeClient {
```

- 注释：「rosbridge 协议的 WebSocket 客户端。处理连接生命周期、重连和消息路由。」
- `export class RosbridgeClient {` —— 导出一个类（预备 1）。从这里到第 317 行的 `}` 都是它的内容。

---

## 第 22-31 行：类的字段（实例自带的数据）

```typescript
  private ws: WebSocket | null = null;
  private options: Required<RosbridgeClientOptions>;
  private status: ConnectionStatus = "disconnected";
  private messageHandlers = new Map<string, Set<MessageHandler>>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private idCounter = 0;
```

这是这个 class 的"随身数据"。每造一个 `RosbridgeClient` 实例，它就自带这 10 个字段。

**语法小课堂：`private` 是什么？**
`private` 表示"私有"——这个字段**只能在 class 内部用 `this.xxx` 访问，外部碰不到**。这是"封装"：把内部细节藏起来，只对外暴露该暴露的方法。外面的人不该直接动 `ws`，只能调用 `connect()` 等公开方法。

逐字段看：

- `private ws: WebSocket | null = null;` —— 真正的 WebSocket 连接对象。
  - 类型 `WebSocket | null`：要么是一个连接，要么是 `null`（空）。
  - **语法小课堂：`null` 是什么？** `null` 表示"空、没有东西"。一开始还没连接，所以是 `null`；连上后才赋成真正的 WebSocket。`= null` 是给字段的**初始值**。
  - 为什么类型要带 `| null`？因为它确实会在"没有"和"有"两种状态间切换，类型如实反映，TS 才会提醒你"用之前先检查是不是 null"。
- `private options: Required<RosbridgeClientOptions>;` —— 配置选项。
  - **语法小课堂：`Required<T>` 是什么？** TS 内置工具，把一个类型里**所有可选字段变成必填**。`RosbridgeClientOptions` 里 `reconnect?`、`reconnectInterval?` 等是可选的；`Required<...>` 把它们全变必填。
  - 为什么？因为构造函数会给所有可选项都补上默认值（马上看到），补完之后它们就一定有值了，类型如实反映成"全必填"，后面用起来不用再判断 `undefined`。
  - 注意这个字段**没有** `= 初始值`——因为它在构造函数里赋值（必须赋，否则 TS 报错）。
- `private status: ConnectionStatus = "disconnected";` —— 当前连接状态，初始 `"disconnected"`（断开）。
- `private messageHandlers = new Map<string, Set<MessageHandler>>();` —— **消息处理器表**（预备 3 的 Map）。
  - 类型 `Map<string, Set<MessageHandler>>`：键是 `string`（话题名），值是 `Set<MessageHandler>`（这个话题的一组处理器）。
  - 即"每个话题名 → 一堆订阅它的回调函数"。为什么值是 `Set` 而不是单个函数？因为同一话题可能被订阅多次，要存多个处理器，且去重。
  - `= new Map<...>()` 初始化成一个空 Map。
- `private connectionHandlers = new Set<ConnectionHandler>();` —— **连接状态处理器集合**（一个 Set）。所有想知道"连接状态变了"的回调都丢这里。
- `private pendingRequests = new Map<string, PendingRequest>();` —— **待响应请求表**（核心）。键是请求 ID，值是上面定义的 `PendingRequest`（含 resolve/reject/timer）。
- `private reconnectAttempts = 0;` —— 已经重连了几次，初始 0。（用于指数退避计算。）
- `private reconnectTimer: ReturnType<typeof setTimeout> | null = null;` —— 重连定时器句柄，初始 `null`（没有在排队的重连）。
- `private intentionalClose = false;` —— "是不是我主动关的"，初始 `false`。
  - 用途：WebSocket 关闭时要判断——是用户主动断开（那就别重连），还是意外掉线（那就自动重连）。
- `private idCounter = 0;` —— 生成唯一 ID 用的计数器，初始 0。每发一个请求就 +1。

---

## 第 33-40 行：构造函数 `constructor`

```typescript
  constructor(options: RosbridgeClientOptions) {
    this.options = {
      url: options.url,
      reconnect: options.reconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 3000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    };
  }
```

**语法小课堂：`constructor` 是什么？**
`constructor`（构造函数）是 class 里一个特殊方法，**在 `new RosbridgeClient(...)` 那一刻自动执行一次**，用来做"初始化"。它接收的参数，就是 `new` 时括号里传的东西。

- `constructor(options: RosbridgeClientOptions)` —— 造实例时要传一个配置对象 `options`。
- 函数体：把传进来的 `options` 整理后，存到 `this.options`（我自己的 options 字段）。逐字段：
  - `url: options.url,` —— url 直接照搬（它是必填的）。
  - `reconnect: options.reconnect ?? true,` —— **重点看 `??`**。
    - **语法小课堂：`??` 是"空值合并运算符"。** `a ?? b` 的意思是"如果 `a` 是 `null` 或 `undefined`（即'没有值'），就用 `b`，否则用 `a`"。
    - 所以 `options.reconnect ?? true`：用户传了 `reconnect` 就用用户的，没传（`undefined`）就用默认值 `true`。
    - **这就是"给可选项补默认值"的标准手法。** 补完之后 `this.options.reconnect` 一定有值，正好对应上面 `Required<...>` 把它变必填。
  - `reconnectInterval: options.reconnectInterval ?? 3000,` —— 没传就默认 3000 毫秒。
  - `maxReconnectAttempts: options.maxReconnectAttempts ?? 10,` —— 没传就默认最多重连 10 次。

> 你可能问：第②篇 `config.ts` 不是已经用 Zod 补过默认值了吗？这里为什么又补一遍？因为 `RosbridgeClient` 是个独立、自包含的类，它不假设别人一定帮它补好了默认值——自己再兜一次底，更健壮。

---

## 第 42-108 行：`connect()` —— 连接（含超时与重连触发）

这是本文件最长的方法。它要"发起 WebSocket 连接，并把这个基于事件的过程包装成一个 Promise"。

```typescript
  /** Connect to the rosbridge WebSocket server. */
  async connect(): Promise<void> {
    if (this.status === "connected") return;
```

- `async connect(): Promise<void>` —— 一个**异步方法**，返回 `Promise<void>`。
  - **语法小课堂：`async` 是什么？** 写在函数前的 `async` 表示"这是个异步函数"。它有两个效果：①函数自动返回一个 Promise；②函数内部可以用 `await` 等待别的 Promise。这里我们主要用它的"返回 Promise"特性。
- `if (this.status === "connected") return;` —— **守卫语句**。
  - **语法小课堂：`if (条件) 语句` 是条件判断。** 条件为真才执行后面的语句。
  - **语法小课堂：`===` 是"严格相等"。** 判断两边是不是完全相等（值和类型都相同）。JS 里要用三个等号 `===`，不要用两个 `==`（`==` 有奇怪的隐式转换规则，容易出 bug，本项目一律用 `===`）。
  - 整句意思：如果已经连上了，就直接 `return`（什么都不做、提前结束）。避免重复连接。

```typescript
    this.intentionalClose = false;
    this.setStatus("connecting");
```

- `this.intentionalClose = false;` —— 重置"主动关闭"标记（这次是要连接，不是要关）。
- `this.setStatus("connecting");` —— 把状态改成"连接中"（`setStatus` 是下面定义的方法，它顺便会通知所有监听器）。

```typescript
    return new Promise<void>((resolve, reject) => {
```

- `return new Promise<void>((resolve, reject) => { ... })` —— 造一个 Promise 并返回它（预备 4）。
  - 谁 `await connect()`，谁就会一直等，直到下面代码里调用了 `resolve()`（连上了）或 `reject(...)`（连接失败）。
  - `(resolve, reject) => { ... }` 是传给 Promise 的那个"立即执行的函数"，箭头函数写法。

```typescript
      const connectTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new Error(`Connection to ${this.options.url} timed out`));
      }, 10_000);
```

- 这是**连接超时保护**：设一个 10 秒的定时器，如果 10 秒内还没连上，就放弃。
- `const connectTimeout = setTimeout(() => { ... }, 10_000);` —— 设一个定时器（预备 5），10 秒后执行里面的函数。把句柄存进 `connectTimeout`，以便连上后取消它。
  - **语法小课堂：`10_000` 里的下划线是什么？** 纯粹是"数字分隔符"，让大数字好读。`10_000` 就是 `10000`（一万），下划线被忽略。这里 10000 毫秒 = 10 秒。
- 定时器到点后做的事：
  - `if (this.ws) { this.ws.close(); this.ws = null; }` —— 如果已经创建了 WebSocket，就关掉它并置空。`if (this.ws)` 利用了"非 null 即为真"——`this.ws` 不是 `null` 时条件成立。
  - `reject(new Error(\`Connection to ${this.options.url} timed out\`));` —— 拒绝 Promise，报"连接超时"。
    - **语法小课堂：`new Error("...")` 是什么？** 造一个"错误对象"，里面装一句错误描述。配合 `reject` 或 `throw` 用，告诉接收方"出了什么错"。
    - **语法小课堂：反引号 `` ` `` 和 `${...}` 是"模板字符串"。** 用反引号包起来的字符串里，可以用 `${表达式}` 嵌入变量的值。这里 `` `Connection to ${this.options.url} timed out` `` 会把 `this.options.url` 的实际地址填进去，得到类似 `"Connection to ws://localhost:9090 timed out"`。比用 `+` 拼接字符串清爽得多。

```typescript
      try {
        this.ws = new WebSocket(this.options.url);
      } catch (err) {
        clearTimeout(connectTimeout);
        this.setStatus("disconnected");
        reject(err);
        return;
      }
```

- **语法小课堂：`try { ... } catch (err) { ... }` 是"异常捕获"。**
  - `try` 块里放"可能出错的代码"。
  - 如果里面**抛出异常**，程序不会崩，而是跳到 `catch` 块，把错误对象给 `err`，让你处理。
- 这里：尝试 `new WebSocket(地址)` 创建连接对象。如果连"创建"这一步就抛错（比如地址格式非法）：
  - `clearTimeout(connectTimeout);` —— 取消那个 10 秒超时定时器（不然它过会还会触发）。
  - `this.setStatus("disconnected");` —— 状态改回断开。
  - `reject(err);` —— 用捕获到的错误拒绝 Promise。
  - `return;` —— 提前结束这个 Promise 函数，别再往下走。

接下来是 WebSocket 的**四个事件回调**。WebSocket 是事件驱动的：连上了触发 `onopen`、来消息触发 `onmessage`、出错触发 `onerror`、关闭触发 `onclose`。我们给每个事件挂一个处理函数。

```typescript
      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        resolve();
      };
```

- `this.ws.onopen = () => { ... };` —— 给"连接成功"事件挂回调。`onopen` 触发说明连上了：
  - `clearTimeout(connectTimeout);` —— 取消超时定时器（已经连上，不需要超时了）。
  - `this.reconnectAttempts = 0;` —— 重连次数清零（连上了，之前的失败记录作废）。
  - `this.setStatus("connected");` —— 状态改成"已连接"。
  - `resolve();` —— **兑现 Promise！** 此刻 `await connect()` 的人才会拿到结果、继续往下走。

```typescript
      this.ws.onmessage = (event) => {
        const data = typeof event.data === "string"
          ? event.data
          : event.data.toString();
        this.handleMessage(data);
      };
```

- `this.ws.onmessage = (event) => { ... };` —— 给"收到消息"事件挂回调。每来一条消息触发一次，消息装在 `event` 里。
  - `const data = typeof event.data === "string" ? event.data : event.data.toString();`
    - **语法小课堂：`条件 ? A : B` 是"三元运算符"，等于一个迷你 if-else。** 读作"如果条件成立就取 A，否则取 B"。
    - `typeof event.data === "string"` —— 判断收到的数据是不是字符串。（`typeof 值` 在运行时会返回该值的类型名，如 `"string"`、`"number"`。注意这和第②篇类型层面的 `typeof` 是两个不同场景的同名用法。）
    - 整句：如果数据本来就是字符串，直接用；否则（可能是二进制 Buffer）调 `.toString()` 转成字符串。无论哪种，最终 `data` 都是字符串。
  - `this.handleMessage(data);` —— 把这条消息文本交给自己的 `handleMessage` 方法去分类处理（后面会细看）。

```typescript
      this.ws.onerror = (_event) => {
        clearTimeout(connectTimeout);
        if (this.status === "connecting") {
          this.ws = null;
          this.setStatus("disconnected");
          reject(new Error(`WebSocket error connecting to ${this.options.url}`));
        }
      };
```

- `this.ws.onerror = (_event) => { ... };` —— "出错"事件回调。
  - **语法小课堂：参数名前的下划线 `_event`。** 参数我们其实用不到（不关心具体错误事件内容），但 WebSocket 调用回调时会传它。约定俗成地在参数名前加 `_`，表示"我知道有这个参数，但我故意不用它"，避免 lint 工具警告。
  - `if (this.status === "connecting")` —— 只有在"连接中"出错才特殊处理：
    - 置空 ws、状态改断开、`reject` 报错——让正在 `await` 的 `connect()` 失败。
  - 如果是连上之后才出错，这里不 reject（因为那时 connect 的 Promise 早就 resolve 过了，一个 Promise 只能兑现或拒绝一次，再调用无效）。连上后的错误交给 `onclose` 处理。

```typescript
      this.ws.onclose = () => {
        clearTimeout(connectTimeout);
        this.ws = null;

        if (this.status === "connecting") {
          this.setStatus("disconnected");
          reject(new Error(`WebSocket closed during connection to ${this.options.url}`));
          return;
        }

        this.setStatus("disconnected");
        this.rejectAllPending(new Error("WebSocket connection closed"));

        if (!this.intentionalClose && this.options.reconnect) {
          this.attemptReconnect();
        }
      };
```

- `this.ws.onclose = () => { ... };` —— "连接关闭"事件回调（最重要的善后逻辑）。
  - `clearTimeout(connectTimeout);` + `this.ws = null;` —— 清超时定时器、置空连接。
  - 第一种情况——**在连接过程中就关了**：
    - `if (this.status === "connecting") { ... reject(...); return; }` —— 说明还没连上就被关，视为连接失败：状态置断开、`reject` 报错、`return` 结束。
  - 第二种情况——**连上之后才断开**（代码走到下面）：
    - `this.setStatus("disconnected");` —— 状态改断开。
    - `this.rejectAllPending(new Error("WebSocket connection closed"));` —— **把所有"还在等回应的请求"全部拒绝**（连都断了，它们不可能再有回应，必须让它们失败，否则会一直挂着）。这个方法在文件末尾。
    - `if (!this.intentionalClose && this.options.reconnect) { this.attemptReconnect(); }` —— **判断要不要自动重连**：
      - **语法小课堂：`!` 是"逻辑非"。** `!x` 把真变假、假变真。`!this.intentionalClose` 意思是"不是主动关闭的"。
      - **语法小课堂：`&&` 是"逻辑与"。** `A && B` 表示"A 和 B 都成立"才算成立。
      - 整句：如果"不是我主动关的" **并且** "配置允许重连"，就调用 `attemptReconnect()` 启动自动重连。（用户主动 `disconnect()` 时会把 `intentionalClose` 设成 `true`，于是这里 `!true` = `false`，就不会重连——这正是我们想要的。）

到这里，`connect()` 这个又长又关键的方法就读完了。**核心思想**：把 WebSocket 那套 `onopen/onmessage/onerror/onclose` 事件，巧妙地接到一个 Promise 的 `resolve/reject` 上，让外部能用 `await connect()` 优雅地等待。

---

## 第 110-136 行：`disconnect()` —— 优雅断开

```typescript
  /** Disconnect from the rosbridge server. */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
```

- `this.intentionalClose = true;` —— **关键**：标记"这是我主动关的"。这样上面 `onclose` 里的重连判断 `!this.intentionalClose` 就会是 `false`，**不会触发自动重连**。

```typescript
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
```

- 如果当前正排着一个"待执行的重连定时器"，就取消它并置空。（既然要主动断开，就别再自动重连了。）

```typescript
    this.rejectAllPending(new Error("Client disconnected"));
```

- 把所有等待中的请求全部拒绝（报"客户端已断开"）。理由同前：连接要没了，别让它们傻等。

```typescript
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
          ws.onclose = () => resolve();
          ws.close();
          // Force-resolve after 2s if server doesn't ack the close
          setTimeout(resolve, 2000);
        });
      }
    }
```

- `if (this.ws) { ... }` —— 只有当前确实有连接时才处理。
  - `const ws = this.ws; this.ws = null;` —— 先把连接存到本地变量 `ws`，再把 `this.ws` 置空。
    - **为什么先存到本地变量？** 因为下面要异步等待，期间 `this.ws` 可能被别处改动；先抓一份到本地 `ws`，确保后面操作的是同一个连接对象，不受干扰。这是处理异步时常见的小心思。
  - `if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)` —— 检查连接是不是"开着"或"正在连"。
    - `readyState` 是 WebSocket 的内置属性，表示当前处于哪个阶段；`WebSocket.OPEN`、`WebSocket.CONNECTING` 是预定义的常量。
    - `||` 是**逻辑或**（A 或 B 任一成立即可）。
  - 如果是，就 `await` 一个新 Promise，优雅等待关闭完成：
    - `ws.onclose = () => resolve();` —— 重新挂一个 onclose：连接真正关闭时兑现这个 Promise。
      - **语法小课堂：`() => resolve()` 这种箭头函数。** 它是一个"无参数、执行 `resolve()`"的小函数。等价于写 `() => { resolve(); }`，单行可省略花括号和分号。
    - `ws.close();` —— 真正发起关闭。
    - `setTimeout(resolve, 2000);` —— **兜底**：万一服务端不响应关闭、`onclose` 迟迟不触发，2 秒后强制 `resolve`，免得 `disconnect()` 永远卡住。
      - 注意这里直接传 `resolve` 而不是 `() => resolve()`——因为 `setTimeout` 到点会自动调用它，两种写法效果一样。
  - **语法小课堂：`await` 终于出场。** `await 某个Promise` 的意思是"在这里暂停，等这个 Promise 兑现/拒绝后再继续"。因为本方法是 `async`，才允许用 `await`。所以 `await new Promise(...)` 让 `disconnect()` 真正等到连接关闭（或 2 秒兜底）才往下走。

```typescript
    this.setStatus("disconnected");
  }
```

- 最后把状态置为断开，方法结束。

---

## 第 138-149 行：`send()` 与 `nextId()`

```typescript
  /** Send a rosbridge protocol message. */
  send(message: RosbridgeMessage & Record<string, unknown>): void {
    if (!this.ws || this.status !== "connected") {
      throw new Error("Not connected to rosbridge server");
    }
    this.ws.send(JSON.stringify(message));
  }
```

- `send(message: RosbridgeMessage & Record<string, unknown>): void` —— 发送一条 rosbridge 消息。
  - **语法小课堂：参数类型里的 `&` 是"交叉类型"。** `A & B` 表示"同时满足 A 和 B 两种类型"。这里 `RosbridgeMessage & Record<string, unknown>` 意思是"既要有 `RosbridgeMessage` 规定的 `op`/`id`，又允许带任意其它字段"。因为不同消息额外字段不同，用 `& Record<string, unknown>` 留出灵活空间。
  - `if (!this.ws || this.status !== "connected") { throw ... }` —— **守卫**：如果没有连接（`!this.ws`）**或**状态不是已连接（`this.status !== "connected"`，`!==` 是"严格不等"），就抛异常。不能往一个不存在/没连好的连接上发数据。
  - `this.ws.send(JSON.stringify(message));` —— 真正发送。
    - **语法小课堂：`JSON.stringify(对象)` 把一个 JS 对象变成 JSON 字符串。** WebSocket 只能传字符串/二进制，所以发之前要把对象"序列化"成文本。它的反操作是 `JSON.parse(字符串)`（把文本变回对象），下面 `handleMessage` 会用到。

```typescript
  /** Generate a unique message ID. */
  nextId(prefix = "rosclaw"): string {
    return `${prefix}_${++this.idCounter}`;
  }
```

- `nextId(prefix = "rosclaw"): string` —— 生成一个唯一 ID（用来配对请求和响应）。
  - **语法小课堂：`prefix = "rosclaw"` 是"默认参数值"。** 调用时不传 `prefix` 就用 `"rosclaw"`，传了就用传的。
  - `return \`${prefix}_${++this.idCounter}\`;` —— 用模板字符串拼出 ID，形如 `"service_1"`、`"action_2"`。
    - **语法小课堂：`++this.idCounter` 是"前置自增"。** `++x` 表示"先把 x 加 1，再用加完的值"。所以第一次调用，`idCounter` 从 0 变 1，用的就是 1，得到 `xxx_1`；下次得到 `xxx_2`……保证每个 ID 都不重复。
    - （对比：`x++` 是"后置自增"，先用旧值再加 1。这里用前置 `++this.idCounter`，所以从 1 开始而不是 0。）

---

## 第 151-168 行：`onMessage()` 与 `onConnection()` —— 登记回调

```typescript
  /** Subscribe to messages on a specific topic. */
  onMessage(topic: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, new Set());
    }
    this.messageHandlers.get(topic)!.add(handler);
    return () => {
      this.messageHandlers.get(topic)?.delete(handler);
    };
  }
```

- `onMessage(topic, handler): () => void` —— 为某话题登记一个消息处理器。返回一个"取消登记"的函数（回忆第④篇：返回清理函数）。
  - `if (!this.messageHandlers.has(topic)) { this.messageHandlers.set(topic, new Set()); }` —— 如果这个话题在表里还没有对应的 Set，就先建一个空 Set 放进去。（确保下一步能往里加。）
  - `this.messageHandlers.get(topic)!.add(handler);` —— 取出这个话题的 Set，往里加这个处理器。
    - **语法小课堂：`!` 这里是"非空断言"。** 注意这个 `!` 紧贴在 `.get(topic)` 后面、`.add` 前面，和前面"逻辑非"的 `!` 位置不同、含义也不同。`map.get(key)` 的类型是"值 或 undefined"（万一没这个键就是 undefined）。我们刚刚才确保过它一定有，所以用 `!` 告诉 TS："我保证它不是 undefined，别报警"。它只是消除类型警告，运行时不做任何事。
  - 返回的清理函数：
    - `return () => { this.messageHandlers.get(topic)?.delete(handler); };` —— 调用它就把这个处理器从 Set 里删掉。
    - **语法小课堂：`?.` 是"可选链"。** `a?.b` 意思是"如果 `a` 存在就取 `a.b`，如果 `a` 是 null/undefined 就整体返回 undefined、不报错"。这里 `this.messageHandlers.get(topic)?.delete(handler)`：万一这个话题的 Set 已经没了（get 返回 undefined），`?.` 让它安静地跳过，不会因为"对 undefined 调用 .delete"而崩溃。
    - 对比上一行的 `!`（我担保有，强行用）和这里的 `?.`（不确定有没有，没有就算了）——两种应对"可能是 undefined"的不同策略。

```typescript
  /** Register a connection status change handler. */
  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }
```

- `onConnection(handler)` —— 登记一个"连接状态变化"回调。把 handler 加进 `connectionHandlers` 这个 Set，返回一个"删掉它"的清理函数。比上面简单，因为连接处理器不分话题，直接一个 Set 管全部。

---

## 第 170-173 行：`getStatus()`

```typescript
  /** Get current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }
```

- 直接返回当前状态。简单的"读取器"。注意它不是 `async`、不返回 Promise——查状态是瞬间的（呼应第④篇"要不要等"的规律）。

---

## 第 175-206 行：请求追踪三件套 `registerPending` / `resolvePending` / `rejectPending`

这是把"事件"接回"Promise"的核心机制（呼应预备 4 和 `PendingRequest` 接口）。

```typescript
  registerPending(id: string, resolve: (value: unknown) => void, reject: (reason: Error) => void, timeoutMs = 30_000): void {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.pendingRequests.set(id, { resolve, reject, timer });
  }
```

- `registerPending(id, resolve, reject, timeoutMs = 30_000)` —— **登记一个"等待响应"的请求**。
  - 参数：请求 `id`、它对应 Promise 的 `resolve`/`reject`、超时毫秒数（默认 30 秒）。
  - `const timer = setTimeout(() => { ... }, timeoutMs);` —— 设一个超时定时器：如果到点了还没等到响应，就：
    - `this.pendingRequests.delete(id);` —— 从表里删掉这条（不再等）。
    - `reject(new Error(\`Request ${id} timed out after ${timeoutMs}ms\`));` —— 拒绝对应 Promise，报超时。
  - `this.pendingRequests.set(id, { resolve, reject, timer });` —— 把 `{ resolve, reject, timer }` 三件套存进表，键是 `id`。
    - **语法小课堂：`{ resolve, reject, timer }` 是"对象简写"。** 当字段名和变量名相同时，可以省略 `字段: 值`，直接写变量名。它等价于 `{ resolve: resolve, reject: reject, timer: timer }`。

```typescript
  resolvePending(id: string, result: unknown): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.resolve(result);
    }
  }
```

- `resolvePending(id, result)` —— **响应到了，兑现对应的请求**。
  - `const pending = this.pendingRequests.get(id);` —— 按 id 从表里取出那条登记。
  - `if (pending) { ... }` —— 如果找到了（不是 undefined）：
    - `clearTimeout(pending.timer);` —— 取消它的超时定时器（已经有响应了，不需要超时了）。
    - `this.pendingRequests.delete(id);` —— 从表里删除（处理完毕）。
    - `pending.resolve(result);` —— **调用当初存的 `resolve`，把响应结果交出去！** 此刻，当初发请求时 `await` 的那个地方就拿到结果、继续执行了。这就是"事件 → Promise"的接合点。

```typescript
  rejectPending(id: string, error: Error): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }
```

- `rejectPending(id, error)` —— 和上面几乎一样，只是最后调用 `pending.reject(error)`（让对应 Promise 失败）而不是 resolve。用于"明确知道这个请求失败了"的场景。

---

## 第 208-213 行：`setStatus()` —— 改状态并广播

```typescript
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const handler of this.connectionHandlers) {
      handler(status);
    }
  }
```

- `private setStatus(status)` —— 私有方法，统一改连接状态。
  - `this.status = status;` —— 更新状态字段。
  - `for (const handler of this.connectionHandlers) { handler(status); }` —— **挨个通知所有登记过的连接处理器**。
    - **语法小课堂：`for (const x of 集合) { ... }` 是"遍历循环"。** 它把集合（数组/Set/Map 等）里的元素一个个取出来，每次叫 `x`，执行一遍循环体。这里把 `connectionHandlers` 这个 Set 里的每个处理器取出来叫 `handler`。
    - `handler(status);` —— 调用这个处理器，把新状态传给它。
  - 效果：状态一变，所有关心的人都立刻收到通知。前面 `connect`/`disconnect` 里那些 `this.setStatus(...)` 都会触发这个广播。

---

## 第 215-273 行：`handleMessage()` —— 消息路由（核心中的核心）

每条从服务端飘来的消息都经过这里分类、分发。

```typescript
  /** Route an incoming rosbridge message to the appropriate handler. */
  private handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // Ignore malformed messages
    }
```

- `private handleMessage(data: string)` —— 私有方法，收到的原始文本 `data` 进来。
  - `let msg: Record<string, unknown>;` —— 声明一个变量 `msg`（先不赋值）。
    - **语法小课堂：为什么这里用 `let` 不用 `const`？** 因为 `const` 必须声明时就赋值且不能再改；这里要"先声明、在 try 里才赋值"，所以用可重新赋值的 `let`。
  - `try { msg = JSON.parse(data) as Record<string, unknown>; } catch { return; }`
    - `JSON.parse(data)` —— 把文本解析回对象（`JSON.stringify` 的逆操作）。
    - `as Record<string, unknown>` —— **语法小课堂：`as 类型` 是"类型断言"。** `JSON.parse` 返回的类型是 `any`（什么都行），我们用 `as` 告诉 TS"把它当作一个键值对象看待"。断言只影响类型检查，不改变运行时的值。
    - `catch { return; }` —— **如果解析失败**（收到的不是合法 JSON），就直接 `return` 忽略这条坏消息，不让它搞崩整个客户端。注意这个 `catch` 后面没写 `(err)`——因为我们不关心错误内容，新语法允许省略。

```typescript
    const op = msg.op as string | undefined;
    if (!op) return;
```

- `const op = msg.op as string | undefined;` —— 取出消息的 `op` 字段，断言成"字符串或 undefined"。
- `if (!op) return;` —— 如果没有 `op`（`undefined` 或空字符串都算"假"，`!op` 为真），直接忽略。没有 op 的消息我们不认识。

```typescript
    switch (op) {
```

- **语法小课堂：`switch (值) { case A: ... }` 是"多分支选择"。** 它根据 `值` 等于哪个 `case` 后面的常量，跳到对应分支执行。比写一长串 `if-else if` 更清爽。这里根据 `op` 是什么，分别处理不同消息。

```typescript
      case "publish": {
        // Incoming topic message — route to topic subscribers
        const topic = msg.topic as string;
        const payload = msg.msg as Record<string, unknown>;
        const handlers = this.messageHandlers.get(topic);
        if (handlers) {
          for (const handler of handlers) {
            handler(payload);
          }
        }
        break;
      }
```

- `case "publish": { ... break; }` —— 当 `op` 是 `"publish"`（服务端推来一条话题消息）：
  - **语法小课堂：`case` 后面的 `{ }`。** 给 case 包一对花括号，是为了开一个独立的"作用域"，让里面 `const topic` 等变量名只在本 case 有效，不和别的 case 撞名。
  - `const topic = msg.topic as string;` —— 取出话题名。
  - `const payload = msg.msg as Record<string, unknown>;` —— 取出消息体（`payload` 意为"载荷/内容"）。
  - `const handlers = this.messageHandlers.get(topic);` —— 从处理器表里查这个话题登记了哪些处理器。
  - `if (handlers) { for (const handler of handlers) { handler(payload); } }` —— 如果有处理器，就**挨个调用**，把消息内容 `payload` 发给每一个。这就是"消息分发"——谁订阅了这个话题，谁就被叫到。
  - `break;` —— **语法小课堂：`break` 跳出 switch。** 处理完这个 case 就退出 switch，不会"漏"到下一个 case。（漏到下一个是别的语言常见 bug 来源，所以每个 case 末尾都要 break。）

```typescript
      case "service_response": {
        // Response to a call_service request
        const id = msg.id as string | undefined;
        if (id) {
          this.resolvePending(id, msg);
        }
        break;
      }
```

- `case "service_response":` —— 服务调用的响应回来了：
  - 取出 `id`，如果有，就 `this.resolvePending(id, msg)`——按 id 找到当初那个等待的 Promise 并兑现它，把整条响应 `msg` 作为结果交回去。
  - **这就是请求-响应配对的闭环**：发请求时 `registerPending(id, ...)` 存入，响应回来时 `resolvePending(id, msg)` 取出兑现。

```typescript
      case "action_result": {
        // Final result of an action goal
        const id = msg.id as string | undefined;
        if (id) {
          this.resolvePending(id, msg);
        }
        break;
      }
```

- `case "action_result":` —— 动作的**最终结果**回来了。逻辑和服务响应完全一样：按 id 兑现对应 Promise。（动作的"等到做完"就靠这个。）

```typescript
      case "action_feedback": {
        // Intermediate feedback for an action goal — route to feedback handlers
        const id = msg.id as string | undefined;
        if (id) {
          const handlers = this.messageHandlers.get(`__action_feedback__${id}`);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg as Record<string, unknown>);
            }
          }
        }
        break;
      }
    }
  }
```

- `case "action_feedback":` —— 动作的**中途进度反馈**（这不是最终结果，所以不能 resolve Promise，而要分发给"进度回调"）：
  - 取出 `id`。
  - `const handlers = this.messageHandlers.get(\`__action_feedback__${id}\`);` —— **关键技巧**：进度反馈复用了 `messageHandlers` 这张表，但用一个**特殊的键** `__action_feedback__加上id` 来存，避免和普通话题名撞车。
    - 为什么？因为 feedback 的 `op` 是 `"action_feedback"` 不是 `"publish"`，走不了普通话题分发；又因为同一时间可能有多个动作在跑，要用 `id` 区分各自的进度。用 `__action_feedback__{id}` 这个独特的键正好两全。（下一批 `actions.ts` 登记 feedback 时用的就是同一个键。）
  - 找到对应处理器后，挨个调用，把整条 feedback 消息发过去。
  - 最后两个 `}`：第一个关 switch，第二个关 `handleMessage` 方法。

> **小结 `handleMessage` 的分流逻辑**（对照第⑤篇的消息表）：
> - `publish`（话题消息）→ 按话题名找订阅者分发。
> - `service_response` / `action_result`（一锤子的响应）→ 按 id 兑现 Promise。
> - `action_feedback`（连续的进度）→ 按特殊键找进度回调分发。

---

## 第 275-307 行：`attemptReconnect()` —— 指数退避重连

```typescript
  /** Attempt to reconnect with exponential backoff. */
  private attemptReconnect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) return;

    this.reconnectAttempts++;
```

- `private attemptReconnect()` —— 尝试重连。
  - `if (this.intentionalClose) return;` —— 如果是主动关的，不重连。
  - `if (this.reconnectAttempts >= this.options.maxReconnectAttempts) return;` —— 如果已经试够了最大次数（`>=` 是"大于等于"），放弃。
  - `this.reconnectAttempts++;` —— 重连次数加 1（这里用后置 `++`，加不加在这无所谓，因为不取它的返回值）。

```typescript
    // Exponential backoff: interval * 2^(attempt-1), capped at 30s
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30_000,
    );
```

- 计算这次要等多久才重连，用**指数退避**策略（越失败越多、等得越久，避免疯狂重试把服务端打垮）：
  - `Math.pow(2, this.reconnectAttempts - 1)` —— **语法小课堂：`Math.pow(底, 指数)` 是"乘方"。** 这里算 `2 的 (重连次数-1) 次方`：第 1 次失败 = `2^0 = 1`，第 2 次 = `2^1 = 2`，第 3 次 = `2^2 = 4`……翻倍增长。
  - `this.options.reconnectInterval * 那个乘方` —— 乘上基础间隔（默认 3000 毫秒）。于是：3000 → 6000 → 12000 → 24000……
  - `Math.min(那个值, 30_000)` —— **语法小课堂：`Math.min(a, b)` 取两者中较小的。** 这里给延迟设了**上限 30 秒**：无论翻倍到多大，最多等 30 秒。
  - 最终 `delay` = "本次重连前要等待的毫秒数"。

```typescript
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;

      try {
        await this.connect();
        // Re-subscribe to all active topics on successful reconnect
        for (const topic of this.messageHandlers.keys()) {
          if (topic.startsWith("__action_feedback__")) continue;
          this.send({
            op: "subscribe",
            id: this.nextId("resub"),
            topic,
          });
        }
      } catch {
        // connect() failed — onclose will trigger another attemptReconnect
      }
    }, delay);
  }
```

- `this.reconnectTimer = setTimeout(async () => { ... }, delay);` —— 设一个延迟 `delay` 毫秒的定时器，到点执行重连。
  - **语法小课堂：`setTimeout(async () => {...})`——定时器回调本身是 `async`。** 因为里面要 `await this.connect()`，所以这个箭头函数前面要加 `async`。
  - 把定时器句柄存进 `this.reconnectTimer`（前面 `disconnect` 时能取消它）。
- 定时器到点后：
  - `this.reconnectTimer = null;` —— 清掉句柄（这个定时器已经触发了）。
  - `if (this.intentionalClose) return;` —— 等待期间如果用户主动断开了，就别连了。
  - `try { ... } catch { ... }` 包住重连尝试：
    - `await this.connect();` —— 重新连接，等它完成。
    - 连上之后，**恢复所有订阅**（关键！因为服务端重启/重连后不记得我们之前订阅过什么）：
      - `for (const topic of this.messageHandlers.keys()) { ... }` —— 遍历处理器表里所有的话题键（`.keys()` 拿到 Map 的所有键）。
      - `if (topic.startsWith("__action_feedback__")) continue;` —— **语法小课堂：`字符串.startsWith("前缀")` 判断是否以某前缀开头；`continue` 跳过本次循环、进入下一个。** 这里跳过那些"动作进度"的特殊键（它们不是真话题，不该重新订阅）。
      - `this.send({ op: "subscribe", id: this.nextId("resub"), topic });` —— 对每个真话题，重新发一条 `subscribe` 消息给服务端。`id` 用 `nextId("resub")` 生成（resub = re-subscribe，重订阅）。`topic` 用了对象简写（字段名等于变量名）。
    - `catch { }` —— **如果 `connect()` 这次又失败了**，catch 里什么都不做。为什么？因为连接失败会触发 `onclose`，而 `onclose` 里又会调用 `attemptReconnect()` 发起下一轮重连。所以这里不用管，让那条链路自然接力即可。（注释也这么说。）

> **整个重连机制串起来**：连接断开 → `onclose` 判断需重连 → `attemptReconnect` 算退避延迟 → 定时器到点 → `connect` 重连 → 成功则恢复订阅 / 失败则 `onclose` 再次触发 → 循环，直到连上或达到最大次数。

---

## 第 309-316 行：`rejectAllPending()` —— 清空所有等待请求

```typescript
  /** Reject all pending requests (used on disconnect/close). */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
```

- `private rejectAllPending(error)` —— 把所有"还在等回应"的请求全部用同一个错误拒绝。连接断开时调用（前面 `disconnect` 和 `onclose` 都用过）。
  - `for (const [id, pending] of this.pendingRequests) { ... }` —— 遍历整张待处理表。
    - **语法小课堂：`const [id, pending]` 是"数组解构"。** 遍历一个 `Map` 时，每个元素是 `[键, 值]` 这样一个两元素数组。`const [id, pending]` 把这个数组**当场拆开**：第一个给 `id`，第二个给 `pending`。比写 `entry[0]`、`entry[1]` 直观。（这里 `id` 其实没用到，但解构时要占位。）
  - `clearTimeout(pending.timer);` —— 取消它的超时定时器。
  - `pending.reject(error);` —— 拒绝它对应的 Promise，让等待方收到错误。
  - `this.pendingRequests.clear();` —— `Map.clear()` 把整张表清空。
- 最后的 `}` 关闭整个 `class RosbridgeClient`。

---

## 整章回顾：这个类的四大职责

读完这 317 行，回头看它确实只干四件事，现在每件都对应得上具体代码了：

| 职责 | 涉及方法 | 核心机制 |
|---|---|---|
| ① 连接与重连 | `connect` / `disconnect` / `attemptReconnect` / `onclose` | 把 WebSocket 事件包成 Promise；指数退避重连；`intentionalClose` 区分主动/被动断开 |
| ② 消息路由 | `handleMessage` / `setStatus` | `switch (op)` 按消息类型分流；`messageHandlers` 表按话题/特殊键分发 |
| ③ 请求-响应追踪 | `registerPending` / `resolvePending` / `rejectPending` / `nextId` | 把 `resolve`/`reject` 存进 `pendingRequests` 表，靠 `id` 配对 |
| ④ 重连后恢复订阅 | `attemptReconnect` 里的重订阅循环 | 遍历 `messageHandlers` 的键，重发 `subscribe` |

**它和外界的关系**：它是"底层引擎"，本身不认识 `RosTransport` 接口（第④篇）。下一批的 `adapter.ts` 会把这个引擎包装成符合 `RosTransport` 的样子，再供上层工具使用。

**语法点回顾清单**（本章新增，量很大，可当字典查）：
- `class` / `new` / 实例 / `this` / `constructor`
- `private` 私有字段、字段默认值、`Required<T>`、`ReturnType<typeof f>`
- 默认导入 `import X from "..."` vs 具名导入 `import { X }`
- `Map`（`set`/`get`/`has`/`delete`/`keys`/`clear`）与 `Set`（`add`/`delete`）
- `new Promise((resolve, reject) => {...})` 手动构造、`resolve`/`reject`
- `async` / `await`
- `setTimeout` / `clearTimeout`、数字分隔符 `10_000`
- `if`、`===`/`!==`、`!`（逻辑非）、`&&`、`||`、三元 `? :`
- `null`、`?.`（可选链）、`!`（非空断言）、`??`（空值合并）
- 模板字符串 `` `...${x}...` ``、`new Error(...)`
- `JSON.stringify` / `JSON.parse`、`as`（类型断言）
- `switch`/`case`/`break`、`for...of`、`continue`
- `&`（交叉类型）、对象简写 `{ a, b }`、数组解构 `const [x, y]`
- `++x`（前置自增）、`Math.min`/`Math.pow`/`startsWith`
- 默认参数 `prefix = "..."`、`_event`（故意不用的参数）

> 这一篇信息量是前面几篇的总和。**建议你配合真实源码，把 `connect` 和 `handleMessage` 两个方法反复读两三遍**——把它们吃透，后面的文件都会变简单。

下一份：[`transport/rosbridge/topics.ts` 逐行详解 →](07-rosbridge-topics.ts.md)（话题发布/订阅的具体封装，比这篇轻松很多）
