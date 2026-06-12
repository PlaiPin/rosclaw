# 逐行详解 ⑯：`tools/ros2-subscribe.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-subscribe.ts](../../extensions/openclaw-plugin/src/tools/ros2-subscribe.ts)
>
> 推荐阅读顺序第 16 个文件。这是"读"方向的工具——**订阅一个话题、等下一条消息回来就返回**（读电量、读传感器、查机器人状态）。它比上一篇发布多了一件麻烦事：**得等一条消息，但又不能无限等**。于是出现一个新模式——用 `Promise` 把"收到消息"和"超时"**两件事竞速**，谁先发生就按谁结束。这把第⑦篇订阅器、第⑧篇 Promise 桥接、第②篇 `setTimeout` 串到了一起。

---

## 先理解这个工具的难点

发布是"发完即忘"，最简单。订阅却尴尬：

- ROS2 话题是"持续不断推消息"的流，但这个工具只想要**下一条**（叫 `subscribe_once`——订阅一次）。
- 收到一条就该：①把它返回、②立刻退订（别继续收）、③别再等了。
- 但万一这个话题**半天没消息**呢？不能让工具永远卡着。所以要加**超时**：等太久就放弃、报错。

把这两条路（"收到消息"和"等超时"）做成竞速——这就是本篇的核心。

---

## 第 1-3 行：导入

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";
```

和第⑮篇一模一样：TypeBox 的 `Type`、宿主类型、取传输的 `getTransport`。不再赘述。

---

## 第 5-15 行：注册函数 + 三个说明字段

```typescript
/**
 * Register the ros2_subscribe_once tool with the AI agent.
 * Subscribes to a topic and returns the next message received.
 */
export function registerSubscribeTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_subscribe_once",
    label: "ROS2 Subscribe Once",
    description:
      "Subscribe to a ROS2 topic and return the next message. Use this to read sensor data, " +
      "check robot state, or get the current value of a topic.",
```

- 骨架和第⑮篇同款。
- `name: "ros2_subscribe_once"` —— 名字里的 `once`（一次）点明语义：只取下一条就走。
- `description` 翻译：「订阅一个话题并返回下一条消息。**用它来读传感器数据、查机器人状态、或取话题当前值。**」——又是写给 AI 的用途引导 + 举例。

---

## 第 16-20 行：`parameters`——出现"可选参数"

```typescript
    parameters: Type.Object({
      topic: Type.String({ description: "The ROS2 topic name (e.g., '/battery_state')" }),
      type: Type.Optional(Type.String({ description: "The ROS2 message type (e.g., 'sensor_msgs/msg/BatteryState')" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 5000)" })),
    }),
```

- `topic: Type.String(...)` —— 话题名，必填（和第⑮篇一样）。
- `type: Type.Optional(Type.String(...))` —— **新东西**：
  - **语法小课堂：`Type.Optional(...)` —— 把一个字段标成"可选"。** 它是 TypeBox 版的 `?`（回忆第①篇可选字段 `type?: string`）。`Type.Optional(Type.String(...))` = "这个字段是字符串，但可以不填"。
  - 为什么消息类型可选？因为有些情况底层能自己推断出类型，AI 不一定要给。
- `timeout: Type.Optional(Type.Number(...))` —— 可选的超时毫秒数。
  - **语法小课堂：`Type.Number()` —— 描述"这是个数字"。** 和 `Type.String()` 并列的基础类型。
  - 描述里写了 `default: 5000`——但**注意：TypeBox 这里只是在说明文字里告诉 AI"默认 5000"，并没有真的设默认值**。真正的兜底在下面 `execute` 里用 `??` 做（马上看到）。

---

## 第 22-25 行：`execute` 取参数

```typescript
    async execute(_toolCallId, params) {
      const topic = params["topic"] as string;
      const msgType = params["type"] as string | undefined;
      const timeout = (params["timeout"] as number | undefined) ?? 5000;
```

- `topic` —— 必填，断言成 `string`（同第⑮篇）。
- `msgType = params["type"] as string | undefined;` —— **注意断言成 `string | undefined`**（联合类型），不是单纯 `string`。因为这个参数可选，AI 可能没填，取出来可能是 `undefined`。诚实地把"可能没有"写进类型。
  - 变量名用 `msgType` 而非 `type`，因为 `type` 在 TS 里是关键字（如 `type X = ...`），避免混淆，换个名更稳。
- `timeout = (params["timeout"] as number | undefined) ?? 5000;` —— **一行里两个语法点**：
  - `(params["timeout"] as number | undefined)` —— 先取出超时值，断言成"数字或没有"。外面套圆括号是为了让 `as` 先算完，再交给 `??`。
  - `?? 5000` —— **空值合并**（第⑥篇）：如果 AI 没填（`undefined`），就兜底成 `5000`（5 秒）。**这才是"默认 5000"真正生效的地方**——上面 TypeBox 的描述只是"告知"，这里才是"执行"。

---

## 第 27 行：取传输

```typescript
      const transport = getTransport();
```

- 老规矩，拿到活动传输实例。

---

## 第 29-42 行：核心——把"收消息"和"超时"做成竞速

```typescript
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscription = transport.subscribe(
          { topic, type: msgType },
          (msg: Record<string, unknown>) => {
            clearTimeout(timer);
            subscription.unsubscribe();
            resolve({ success: true, topic, message: msg });
          },
        );
        const timer = setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error(`Timeout waiting for message on ${topic}`));
        }, timeout);
      });
```

这是本篇的灵魂，慢慢拆。

### 外层：`await new Promise<...>((resolve, reject) => {...})`

- 回忆第⑥/⑧篇：`new Promise` 建一个"待兑现承诺"，给它一个函数，函数收到 `resolve`（成功）和 `reject`（失败）两个开关。
- `<Record<string, unknown>>` —— 这个承诺将来兑现时给出的值是"一个对象"（订阅结果）。
- 最外面 `await` —— 等这个承诺有结果（要么收到消息成功、要么超时失败）。
- 和第⑧篇服务调用一个思路：**用 Promise 把异步结果接住**。区别是这里要同时安排两条"结束路径"。

### 路径一：订阅，收到消息就成功

```typescript
const subscription = transport.subscribe(
  { topic, type: msgType },
  (msg: Record<string, unknown>) => {
    clearTimeout(timer);
    subscription.unsubscribe();
    resolve({ success: true, topic, message: msg });
  },
);
```

- `transport.subscribe(选项, 回调)` —— 调传输的订阅（第④篇接口、第⑩篇适配器）。返回一个 `subscription` 句柄（带 `unsubscribe`，第③篇）。
  - 第一个参数 `{ topic, type: msgType }` —— 订阅选项：话题名 + 消息类型。`topic` 简写，`type: msgType` 因为名字不同（参数叫 `msgType`、字段叫 `type`）。
  - 第二个参数是**收到消息时的回调** `(msg) => {...}`。`msg: Record<string, unknown>` 是收到的消息体。
- 回调体三件事，顺序有讲究：
  1. `clearTimeout(timer);` —— **取消那个超时定时器**（回忆第②篇 `clearTimeout`）。既然消息已经来了，就不用再等超时了，把定时器撤掉，免得它待会儿又触发 reject。
  2. `subscription.unsubscribe();` —— **退订**。只要这一条，订到手立刻退，不再继续收（这就是 `_once` 的含义）。
  3. `resolve({ success: true, topic, message: msg });` —— **兑现承诺**，把结果交出去：成功标志 + 话题 + 收到的消息。外层 `await` 拿到它。

### 路径二：超时，没等到就失败

```typescript
const timer = setTimeout(() => {
  subscription.unsubscribe();
  reject(new Error(`Timeout waiting for message on ${topic}`));
}, timeout);
```

- `setTimeout(回调, 毫秒)`（回忆第②篇）—— 设一个定时器：过了 `timeout` 毫秒还没被取消，就执行回调。返回的定时器句柄存进 `timer`。
- 超时回调干两件事：
  1. `subscription.unsubscribe();` —— 也要退订（都超时了，别再挂着监听白占资源）。
  2. `reject(new Error(\`Timeout waiting for message on ${topic}\`));` —— **让承诺失败**，抛一个带话题名的清楚错误。外层 `await` 处会抛出这个错。

### 两条路径如何"竞速"

- 两个回调都登记好后，就看**谁先发生**：
  - 消息**先到** → 路径一跑：清掉定时器（路径二永不触发）、退订、`resolve` 成功。
  - 一直**没消息** → `timeout` 毫秒后路径二跑：退订、`reject` 失败。
- **关键：无论走哪条，都会 `unsubscribe`**——保证不留下泄漏的订阅。而 `clearTimeout` 保证"成功路径"不会被"超时路径"误伤。两条路互相清理对方，干干净净。

> **一个易混点：`timer` 在回调里用，却在回调下面才声明，不报错吗？**
> 不报错。因为那个收消息的回调**不是立刻执行**的——它要等真有消息才跑。等它跑的时候，下面的 `const timer = setTimeout(...)` **早已执行完**、`timer` 已经有值了。JavaScript 里"晚定义、但用的时候已存在"是没问题的。这是异步回调里常见的写法。

---

## 第 44-49 行：返回结果

```typescript
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- 和第⑮篇结尾**一模一样**的固定套路：把 `result`（上面竞速拿到的成功结果）`JSON.stringify` 成文本放进 `content` 给 AI，再把原始对象放进 `details`。
- 注意：如果上面是**超时失败**，`await` 那里就直接抛错了，根本走不到这个 `return`——错误会往外抛给宿主，宿主再告诉 AI"工具失败了"。所以这个 `return` 只在成功时执行。
- 收尾的 `},`、`});`、`}` 依次关闭 `execute`、`registerTool`、注册函数。

---

## 发布 vs 订阅：工具复杂度对比

| | 发布 ⑮ | 订阅 ⑯ |
|---|---|---|
| 等回应吗 | 不等（发完即忘） | **等一条消息** |
| 用 Promise 吗 | 不用 | **用**（接住"将来到的消息"） |
| 超时处理 | 无 | **有**（`setTimeout` + `reject`） |
| 清理 | 无 | **有**（两条路都 `unsubscribe` + `clearTimeout`） |
| execute 体 | 三五行 | 一个竞速 Promise |

可以看到，订阅 = 发布的骨架 + 第⑧篇的 Promise 桥接 + 超时竞速。复杂度都在"等一条消息又不能死等"这件事上。

---

## 整章回顾

- `ros2_subscribe_once` 让 AI 读一个话题的下一条消息，用于读传感器/查状态。
- 核心是一个**竞速 Promise**：同时安排"收到消息→`resolve` 成功"和"超时→`reject` 失败"两条路，谁先到按谁结束，且两条路都负责退订清理。
- 参数出现了**可选**（`Type.Optional`）和**默认值兜底**（`?? 5000`），默认值的"说明"在 TypeBox 描述里、"执行"在 `execute` 的 `??` 里——两处别混淆。

**语法点回顾清单**（本章新增/巩固）：
- `Type.Optional(...)`（可选参数，TypeBox 版的 `?`）、`Type.Number()`（数字）
- 取可选参数断言成 `string | undefined` / `number | undefined`（诚实写"可能没有"）
- `(... as number | undefined) ?? 5000`：断言 + 空值合并兜底默认值（默认值真正生效处）
- 竞速 Promise：`subscribe` 回调 `resolve` vs `setTimeout` 回调 `reject`，谁先发生谁结束
- 成功路径 `clearTimeout` + 失败路径都 `unsubscribe`：两条路互相清理，防泄漏
- 异步回调里"晚声明的变量（`timer`）在回调真正执行时已存在"
- 工具返回的固定套路 `content`(文本) + `details`(对象)（巩固第⑮篇）
- 变量名避开关键字 `type` → 改用 `msgType`

下一份：[`ros2-service.ts` 逐行详解 →](17-ros2-service.ts.md)（调用服务的工具——直接复用第⑧篇的请求-响应，比订阅还省心）
