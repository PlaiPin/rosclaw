# 逐行详解 ⑫：`service.ts`

> 对应源文件：[extensions/openclaw-plugin/src/service.ts](../../extensions/openclaw-plugin/src/service.ts)
>
> 推荐阅读顺序第 12 个文件。前面我们把"造传输"的活儿交给了第⑪篇的工厂 `createTransport`。但工厂只负责"造"——造出来之后，谁来保管这个传输？什么时候连上、什么时候断开？运行中想换一种模式怎么办？这些"**生命周期管理**"全在本篇。它是工厂的上一层调用者，也是整个插件与传输层之间的"中枢"。

---

## 先理解本篇要解决的三件事

1. **保管唯一的传输实例**：整个插件只该有**一个**活着的传输连接，所有工具共用它。本篇用一个"模块级变量"把它存起来。
2. **管连接的开关**：插件启动时连上 ROS2，插件停止时断开——这叫"服务（service）"的生命周期，交给 OpenClaw 托管。
3. **运行中热切换模式**：用户发 `/transport webrtc` 想换种连法时，先断旧的、再连新的，过程中还得防止"切到一半又来一个切换请求"。

这三件事分别对应文件里的三块：模块级状态、`switchTransport`、`registerService`。

---

## 第 1-6 行：导入

```typescript
import type { TransportConfig } from "./transport/types.js";
import type { RosTransport } from "./transport/transport.js";
import { createTransport } from "./transport/factory.js";
import type { OpenClawPluginApi } from "./plugin-api.js";
import type { PluginLogger } from "./plugin-api.js";
import type { RosClawConfig } from "./config.js";
```

- 大部分是 `import type`（只借类型，回忆第⑩篇判断标准）：`TransportConfig`（第③篇配置）、`RosTransport`（第④篇接口）、`OpenClawPluginApi`/`PluginLogger`（第①篇宿主 API）、`RosClawConfig`（第②篇校验后的配置）。
- **只有一个是值导入**：`import { createTransport }`——因为下面要**调用**它（工厂函数），不是只拿它当类型标注。判断标准还是那句：要调用/`new` 的用 `import`，只标注的用 `import type`。

---

## 第 8-15 行：三个"模块级变量"——本篇的状态核心

```typescript
/** Shared transport instance for all tools. */
let transport: RosTransport | null = null;

/** Tracks the active transport mode. */
let currentMode: TransportConfig["mode"] | null = null;

/** Concurrency guard — prevents overlapping switchTransport calls. */
let switching = false;
```

**语法小课堂：模块级变量（module-level state）。**
- 前面我们见过的变量，要么在函数体里（用完就没），要么是类的字段（挂在某个对象实例上）。这三个变量**直接写在文件最外层**，不属于任何函数或类——它们是"**模块级变量**"。
- 它的特点：**整个文件共享同一份，且只要程序在跑就一直存在**。第一次加载这个文件时它们被创建，之后这个文件里所有函数读到的都是同一份。
- 这正好满足需求："整个插件只有一个传输实例"——把它存成模块级变量，谁需要都来这里拿同一个。这其实是**单例（singleton）模式**的最朴素实现：用模块级变量保管唯一实例。

逐个看：

- `let transport: RosTransport | null = null;`
  - 类型是 `RosTransport | null`（联合类型，第③篇）：要么是个传输实例，要么是 `null`（还没连或已断开）。
  - 初值 `null`——插件刚加载时还没连接。
  - 用 `let` 不用 `const`，因为它会被反复改写（连上时赋实例、断开时赋回 `null`）。

- `let currentMode: TransportConfig["mode"] | null = null;`
  - **语法小课堂：`TransportConfig["mode"]` 是"索引访问类型（indexed access type）"。** 这是个新写法：用**方括号 + 字段名**，从一个对象类型里"取出某个字段的类型"。
    - `TransportConfig` 是第③篇那个判别联合，它的 `mode` 字段类型是 `"rosbridge" | "local" | "webrtc"`（三个字面量之一）。
    - `TransportConfig["mode"]` 就等于"把 `mode` 那个字段的类型抠出来"，结果正是 `"rosbridge" | "local" | "webrtc"`。
    - **为什么不直接写 `"rosbridge" | "local" | "webrtc"`？** 因为那样要重复抄一遍。用 `TransportConfig["mode"]` 等于说"跟着源头走"——以后 `TransportConfig` 加了第四种 mode，这里**自动跟着变**，不用手改。这是"别重复自己"的类型版技巧。
  - 整体 `TransportConfig["mode"] | null`：当前模式（三选一）或 `null`（没连接）。

- `let switching = false;`
  - 一个布尔"门闩"。没写类型标注——TS 看到初值 `false` 就**自动推断**它是 `boolean`（回忆第②篇：能推断出来就不必手写）。
  - 它的用途：标记"现在是否正有一个切换操作在进行"，防止两个切换撞车。下面 `switchTransport` 会用到。

---

## 第 17-23 行：`getTransport`——取出传输（取不到就报错）

```typescript
/** Get the active transport. Throws if not connected. */
export function getTransport(): RosTransport {
  if (!transport) {
    throw new Error("Transport not initialized. Is the service running?");
  }
  return transport;
}
```

- 这是给"所有工具"用的取货口：工具想发指令，先来这里拿传输实例。
- `if (!transport)` —— **逻辑取反 `!`**（回忆第⑥篇：写在值**前面**是取反）。`transport` 是 `RosTransport | null`，当它是 `null` 时 `!transport` 为 `true`，进入分支。即"还没连接"。
- `throw new Error(...)` —— 没连接就抛错，提示"传输没初始化，服务在跑吗？"。这比返回 `null` 让调用方自己去判空更省事——**取不到就直接报清楚的错**。
- `return transport;` —— 走到这里说明 `transport` 不是 `null`。
  - **小细节**：经过上面 `if (!transport) throw` 之后，TS 会**自动收窄**——它知道"能走到这行，`transport` 必然不是 `null`"，于是返回类型 `RosTransport`（不含 `null`）成立，不用再写 `!` 断言。这是"提前 throw 帮 TS 收窄"的常见手法。

---

## 第 25-28 行：`getTransportMode`——查当前模式

```typescript
/** Get the current transport mode, or null if no transport is active. */
export function getTransportMode(): TransportConfig["mode"] | null {
  return currentMode;
}
```

- 最简单的"读一个模块级变量并返回"。返回类型就是上面那个索引访问类型 `TransportConfig["mode"] | null`。
- 谁会用它？比如 `/transport` 命令想显示"当前用的是哪种模式"，就调它。

---

## 第 30-65 行：`switchTransport`——运行中热切换（本篇主菜）

这是全篇最有料的函数：用户在聊天里发 `/transport local` 想换种连法，它负责"断旧连新"。

### 第 30-38 行：注释 + 签名 + 防撞车检查

```typescript
/**
 * Switch the active transport at runtime.
 * Disconnects the old transport, creates a new one, and connects it.
 * No rollback on failure — the user retries with `/transport`.
 */
export async function switchTransport(config: TransportConfig, logger: PluginLogger): Promise<void> {
  if (switching) {
    throw new Error("A transport switch is already in progress. Please wait.");
  }
```

- 注释最后一句很诚实：「**失败不回滚**——用户用 `/transport` 重试即可。」意思是如果切到一半连不上，它不会帮你自动切回旧的，而是让你重来。这是个有意的简化设计，写在注释里以免误会。
- `async ... (config, logger): Promise<void>` —— 异步函数（连接要等），不返回有用值（`Promise<void>`）。收两个参数：目标配置、记日志用的 `logger`。
- `if (switching) { throw ... }` —— **并发门闩（concurrency guard）的第一半**：
  - 进函数先看 `switching`。如果它已经是 `true`，说明"已经有一个切换在进行中"，立刻抛错拒绝，让用户等。
  - **为什么要防这个？** 切换是"先断后连"的多步异步操作，中间有 `await`（会让出执行权）。万一用户连点两次 `/transport`，第二次可能在第一次还没切完时就插进来，两个流程交织会把状态搞乱（比如同时改 `transport`）。门闩保证"同一时刻只有一个切换在跑"。

### 第 40-47 行：上闩 + 断开旧传输

```typescript
  switching = true;
  try {
    // Disconnect old transport
    if (transport) {
      await transport.disconnect();
      transport = null;
      currentMode = null;
    }
```

- `switching = true;` —— **门闩的第二半**：把闩落下。从这一刻起，再有切换请求进来就会被上面那个 `if` 挡掉。
- `try {` —— 注意紧接着开了 `try`。配合下面的 `finally` 保证"无论成败，最后一定把闩抬起来"。（回忆第⑨篇 `try/finally`：清理类代码的归宿。这里"清理"的就是那个门闩。）
- `if (transport) { ... }` —— 如果当前**有**活着的传输，先把它收拾掉：
  - `await transport.disconnect();` —— 等它断开（第④/⑩篇的 `disconnect`）。
  - `transport = null;` / `currentMode = null;` —— 把两个模块级状态清空，表示"现在没有活动传输"。
  - 注意顺序：**先断开、再清空引用**。

### 第 49-61 行：造新的、连上、记录

```typescript
    // Create and connect new transport
    const newTransport = await createTransport(config);

    newTransport.onConnection((status: string) => {
      logger.info(`ROS2 transport status: ${status}`);
    });

    await newTransport.connect();

    transport = newTransport;
    currentMode = config.mode;

    logger.info(`ROS2 transport switched to ${config.mode}`);
```

- `const newTransport = await createTransport(config);` —— 调第⑪篇的工厂，按新配置造一个传输。`await` 因为工厂是异步的（动态 import）。
  - **注意这里先存进局部变量 `newTransport`，而不是直接赋给模块级的 `transport`。** 为什么？因为接下来的 `connect` 可能失败。如果直接赋给 `transport`，万一连接失败，`transport` 就指向一个"造出来但没连上"的半成品。先放局部变量，**等连接成功了再赋给模块级变量**，更稳妥。
- `newTransport.onConnection((status: string) => { logger.info(...) });` —— 登记一个"连接状态变化"的回调（第④/⑩篇的 `onConnection`）。
  - 回调 `(status: string) => { logger.info(\`...${status}\`) }`：每次状态变化，往日志写一行。`status: string` 显式标了参数类型。
  - 这是个"只为副作用（记日志）"的回调，不关心它返回的退订函数，所以没接住返回值。
- `await newTransport.connect();` —— 真正连上去，等它连成功。**如果这一步抛错，下面三行就不会执行**，`transport` 也就不会被赋成这个连不上的实例——这正是"先存局部变量"的好处兑现。
- 连成功后才提交状态：
  - `transport = newTransport;` —— 现在才把新传输放进模块级变量，正式"上岗"。
  - `currentMode = config.mode;` —— 记下当前模式。
  - `logger.info(...)` —— 日志报告切换成功。

### 第 62-65 行：`finally` 抬闩

```typescript
  } finally {
    switching = false;
  }
}
```

- 不管上面 `try` 块是**成功跑完**、还是**中途抛错**（比如连接失败），`finally` 都一定执行。
- `switching = false;` —— 把门闩抬起来，允许下一次切换。
- **为什么非得放 `finally`？** 设想：如果把 `switching = false` 写在 `try` 块末尾，那么一旦连接失败抛错，这行就被跳过，门闩永远落着——之后所有切换请求都会被"已有切换在进行"挡掉，等于把功能锁死了。放进 `finally`，才能保证"哪怕这次切换炸了，门闩也会被抬起，不影响下次"。这是第⑨篇 `finally` 用法的又一个真实范例。

> **整个 `switchTransport` 的骨架**：上闩 → `try`{ 断旧 → 造新 → 连新 → 提交状态 } → `finally`{ 抬闩 }。门闩防并发、`finally` 保证闩一定抬起，是这类"有临界区的异步操作"的标准写法。

---

## 第 67-114 行：`registerService`——把连接生命周期托管给 OpenClaw

这个函数在插件启动时被调一次（下一篇 `index.ts` 会看到），作用是"告诉 OpenClaw：我有个叫 ros2-transport 的服务，开机时这样连、关机时这样断"。

### 第 67-72 行：注释 + 签名 + 取模式

```typescript
/**
 * Register the ROS2 transport connection as an OpenClaw managed service.
 * The service handles connection lifecycle (connect on start, disconnect on stop).
 */
export function registerService(api: OpenClawPluginApi, config: RosClawConfig): void {
  const mode = config.transport.mode;
```

- 不是 `async`——它本身只是"登记"（瞬间完成），真正的异步连接逻辑写在下面 `start`/`stop` 里。
- 参数：`api`（第①篇宿主提供的接口）、`config`（第②篇校验后的整份配置）。
- `const mode = config.transport.mode;` —— 从配置里取出用户选定的传输模式，存个短变量备用。

### 第 74-90 行：注册服务 + `start` 的开头

```typescript
  api.registerService({
    id: "ros2-transport",

    async start(_ctx) {
      let transportCfg: TransportConfig;

      switch (mode) {
        case "rosbridge":
          transportCfg = { mode: "rosbridge", rosbridge: config.rosbridge };
          break;
        case "local":
          transportCfg = { mode: "local", local: config.local };
          break;
        case "webrtc":
          transportCfg = { mode: "webrtc", webrtc: config.webrtc };
          break;
      }
```

- `api.registerService({ ... })` —— 调宿主的"注册服务"方法，传一个对象描述这个服务：它有 `id`、`start`、`stop`。
- `id: "ros2-transport"` —— 给服务起个唯一名字，OpenClaw 用它来识别/管理。
- `async start(_ctx) { ... }` —— **对象里直接写一个 async 方法**（回忆第⑩篇 `{ unsubscribe(){...} }` 的内联方法写法，这里是它的 async 版）。这是 OpenClaw 在"启动服务"时会替我们调的钩子。
  - **语法小课堂：参数名前的下划线 `_ctx`。** OpenClaw 调 `start` 时会传一个上下文对象进来，但本函数**用不到它**。给没用到的参数名加 `_` 前缀（`_ctx` 而非 `ctx`）是一种**约定**：明示"我知道有这个参数，但故意不用它"。这能避免某些 lint 工具报"未使用变量"的警告，也让读代码的人一眼明白。
- `let transportCfg: TransportConfig;` —— **声明一个变量但暂不赋值**。
  - **语法小课堂：先声明、后赋值。** 之前的变量都是"声明即赋值"（`const x = ...`）。这里先写 `let transportCfg: TransportConfig;`（只声明、给了类型、没给值），打算在下面的 `switch` 里**根据模式赋不同的值**。这种"一处声明、多分支赋值"必须用 `let`（`const` 要求声明时就赋值）。
  - 因为没初值，**必须显式写类型** `: TransportConfig`，否则 TS 不知道它是什么。
- `switch (mode) { ... }` —— 按模式拼出对应的 `TransportConfig`：
  - 每个 `case` 都把对应那一节配置包成判别联合的一员。比如 `case "rosbridge"` 里赋 `{ mode: "rosbridge", rosbridge: config.rosbridge }`——`mode` 字段是判别标签，`rosbridge` 字段装那一节配置（回忆第③篇判别联合的结构）。
  - 每个 `case` 末尾 `break;`（回忆第⑥篇：防止"贯穿"到下一个 case）。
  - **注意这个 `switch` 没有 `default`**。因为 `mode` 的类型是 `"rosbridge" | "local" | "webrtc"` 三选一，三个 case 已穷尽所有可能，TS 能确认"`transportCfg` 在每条路径上都会被赋值"，于是后面用它时不报"可能未赋值"的错。（这和第⑪篇工厂里那个带 `default` + `never` 的 switch 是两种风格：那里要在运行时兜底非法输入，这里输入已被类型限死，可省 default。）

### 第 92-103 行：连接（`start` 的主体）

```typescript
      api.logger.info(`Connecting to ROS2 via ${mode} transport...`);

      transport = await createTransport(transportCfg);

      transport.onConnection((status: string) => {
        api.logger.info(`ROS2 transport status: ${status}`);
      });

      await transport.connect();
      currentMode = mode;
      api.logger.info(`ROS2 transport connected (mode: ${mode})`);
```

- 这段和 `switchTransport` 的"造新连新"几乎一样，但这里直接赋给模块级 `transport`（开机首连，没有"旧的"要保护，也无需局部变量过渡）。
- 流程：记日志 → `createTransport` 造 → `onConnection` 登记状态日志回调 → `connect` 连上 → 记 `currentMode` → 报告连接成功。
- 注意这里用的是 `api.logger`（宿主提供的日志器），而 `switchTransport` 用的是单独传入的 `logger` 参数——两者其实是同一个东西，只是来源不同（一个从 `api` 上取，一个由调用方传入）。

### 第 105-114 行：断开（`stop`）

```typescript
    async stop(_ctx) {
      if (transport) {
        await transport.disconnect();
        transport = null;
        currentMode = null;
        api.logger.info("ROS2 transport disconnected");
      }
    },
  });
}
```

- `async stop(_ctx)` —— OpenClaw 在"停止服务"（如插件卸载、应用关闭）时调它。
- `if (transport) { ... }` —— 有活动传输才需要断（没有就什么都不做）。
- 断开三连：`await disconnect()` → `transport = null` → `currentMode = null`，再记一行日志。和 `switchTransport` 里"断旧"那段完全一致。
- 最后 `});` 关闭 `registerService` 的参数对象和调用，`}` 关闭函数。

> **`start`/`stop` 是一对"生命周期钩子"**：你只管写"开机怎么连、关机怎么断"，**何时**调它们由 OpenClaw 决定。这就是"托管服务（managed service）"——把连接的开关交给宿主统一调度，插件不用自己操心时机。

---

## 整章回顾

`service.ts` 是插件与传输层之间的"中枢"，干三件事：

| 部分 | 函数 | 职责 |
|---|---|---|
| 状态保管 | 三个模块级变量 | 用单例方式存唯一的 `transport`、当前 `currentMode`、并发门闩 `switching` |
| 取货口 | `getTransport`/`getTransportMode` | 给工具取传输实例、查当前模式（取不到就抛错） |
| 热切换 | `switchTransport` | 运行中"断旧连新"，靠门闩防并发、靠 `finally` 保证抬闩 |
| 生命周期托管 | `registerService` | 把"开机连、关机断"登记成 OpenClaw 的 `start`/`stop` 钩子 |

一条主线：**所有人都通过这个模块拿到那个唯一的传输**，而连接的开关被收拢到 `start`/`stop`/`switchTransport` 三处统一管理。

**语法点回顾清单**（本章新增/巩固）：
- 模块级变量（写在文件最外层、全文件共享、程序在跑就一直存在）——单例的朴素实现
- 索引访问类型 `TransportConfig["mode"]`（从对象类型里取某字段的类型，跟着源头自动变）
- 先声明后赋值 `let x: T;` + 在 `switch` 各分支赋值（穷尽分支时可省 `default`）
- 提前 `throw` 帮 TS 收窄（`if (!x) throw` 之后 x 不再含 null）
- 并发门闩：布尔标志 + `try { 上闩... } finally { 抬闩 }`
- 参数名加 `_` 前缀（`_ctx`）表示"故意不用"
- 对象里内联 `async` 方法（`async start(_ctx){...}`）（巩固第⑩篇内联方法）
- "先存局部变量、成功后再提交到共享状态"的稳妥赋值顺序

下一份：[`index.ts` 逐行详解 →](13-index.ts.md)（整个插件的总入口 `register()`——把上面这些注册函数一次性串起来）
