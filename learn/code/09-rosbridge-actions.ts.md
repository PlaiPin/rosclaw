# 逐行详解 ⑨：`transport/rosbridge/actions.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/actions.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/actions.ts)
>
> 推荐阅读顺序第 9 个文件，rosbridge 三小帮手的最后一个。**它就是上一篇 `services.ts` 那套"请求-响应"骨架，再叠两样东西**：①动作是长任务，途中会不断推"进度反馈"，要单独接住；②不管成功失败，结束时都得把进度监听清理掉——这引出新语法 `try/finally`。把第⑧篇吃透了，这篇只剩"增量"要学。

---

## 先理解动作 vs 服务的差别

回忆第③篇：
- **服务（service）**＝打个电话问一句、对方答一句就完事（一来一回）。
- **动作（action）**＝交代一个大任务（"导航到客厅"），它要干几十秒，**途中不断汇报进度**（"走了 30%……60%……"），最后才给个总结果，而且**中途可以喊停**。

所以动作比服务多两件事要处理：
1. **进度反馈**：任务跑的过程中，服务端会推来一条条 `action_feedback`，得有人接。
2. **善后清理**：任务一结束（无论成功还是出错），那个"接进度"的监听器要撤掉，别留垃圾。

---

## 第 1-5 行：导入

```typescript
import type { RosbridgeClient } from "./client.js";
import type {
  ActionResultMessage,
  ActionFeedbackMessage,
} from "./types.js";
```

- `RosbridgeClient` —— 底层客户端类型。
- `ActionResultMessage` —— 第⑤篇定义的"动作最终结果"消息类型（含 `result`+`values`）。
- `ActionFeedbackMessage` —— "动作进度反馈"消息类型（含必有的 `values`）。
- 多个名字用花括号换行列出，是纯排版（回忆第④篇），和写一行没区别。

---

## 第 7-13 行：动作目标选项 `ActionGoalOptions`

```typescript
export interface ActionGoalOptions {
  action: string;
  actionType: string;
  args?: Record<string, unknown>;
  onFeedback?: (feedback: ActionFeedbackMessage) => void;
  timeoutMs?: number;
}
```

发送一个动作目标要带的信息（和第③篇同名接口几乎一致，这里是 rosbridge 模块自己的版本）：

- `action: string;` —— 动作服务器名，必填。
- `actionType: string;` —— 动作类型，必填（注意无 `?`，动作类型不能省）。
- `args?: Record<string, unknown>;` —— 目标参数，可选（如目标坐标）。
- `onFeedback?: (feedback: ActionFeedbackMessage) => void;` —— **可选的进度回调**。它是个函数类型：接收一条进度反馈、返回 `void`。你给了它，就能实时收到进度；不给，就只等最终结果。
- `timeoutMs?: number;` —— 可选超时（动作很长，下面会看到默认值比服务大得多）。

---

## 第 15-19 行：`ActionClient` 类骨架

```typescript
/**
 * Client for sending action goals and receiving feedback/results.
 */
export class ActionClient {
  constructor(private client: RosbridgeClient) {}
```

- 又一个薄包装类，只存一个底层 `client`（用了第⑦篇讲的 `private` 参数属性简写）。
- 它对外提供两个方法：`sendGoal`（发目标并等结果）和 `cancelGoal`（取消）。

---

## 第 21-29 行：`sendGoal` 开头——拿号 + 定超时

```typescript
  async sendGoal(options: ActionGoalOptions): Promise<ActionResultMessage> {
    const id = this.client.nextId("action");
    const timeoutMs = options.timeoutMs ?? 120_000; // Actions can be long-running
```

- `async sendGoal(options): Promise<ActionResultMessage>` —— 异步方法，接收一个选项对象，最终兑现成"动作结果"。
- `const id = this.client.nextId("action");` —— 和第⑧篇一样，拿唯一号给请求/结果配对。
- `const timeoutMs = options.timeoutMs ?? 120_000;` —— 定超时：
  - **语法小课堂复习：`??`（空值合并）**（第⑥篇讲过）。`options.timeoutMs ?? 120_000` 意思是"如果调用方传了 `timeoutMs` 就用它，没传（是 `undefined`）就用 `120_000`"。
  - `120_000` 毫秒 = 120 秒 = 2 分钟。比服务的 30 秒长 4 倍——注释 `// Actions can be long-running`（动作可能很耗时）正解释了原因。
  - 注意这里**没用第⑧篇那种"参数默认值"写法**（`timeoutMs = 120_000`），而是用 `??` 在函数体内兜底。两种写法效果类似；因为 `timeoutMs` 藏在 `options` 对象里，没法写成参数默认值，只能进来后用 `??` 补。

---

## 第 31-38 行：登记进度反馈监听（动作独有的部分）

```typescript
    // Register feedback handler if provided
    let removeFeedbackHandler: (() => void) | null = null;
    if (options.onFeedback) {
      const feedbackKey = `__action_feedback__${id}`;
      removeFeedbackHandler = this.client.onMessage(feedbackKey, (msg) => {
        options.onFeedback!(msg as unknown as ActionFeedbackMessage);
      });
    }
```

这一段是动作比服务**多出来**的处理，逐行看：

```typescript
let removeFeedbackHandler: (() => void) | null = null;
```
- 和第⑦篇订阅器里那个字段同款：一个"可空的退订函数"。先 `null`，待会儿若登记了监听就填进来，最后清理时调用它。
- 用 `let` 不用 `const`，因为它的值后面要被改（从 `null` 变成函数）。

```typescript
if (options.onFeedback) {
```
- 真值判断（第⑦篇讲过）：只有**调用方确实传了 `onFeedback` 回调**，才需要费劲去登记进度监听。没传就整段跳过，省事。

```typescript
const feedbackKey = `__action_feedback__${id}`;
```
- 拼一个**专门给"这次动作的进度"用的频道名**。用了模板字符串（第⑥篇）：`__action_feedback__` 前缀 + 这次的 `id`。
- 为什么要这么个怪名字？因为进度反馈和最终结果是**两路消息**：最终结果按 `id` 走 `registerPending`（下面会写），进度则单独挂在这个 `__action_feedback__<id>` 频道上，互不干扰。`client` 内部会把进度反馈消息路由到这个 key。前后双下划线只是约定俗成表示"内部专用、别乱碰"。

```typescript
removeFeedbackHandler = this.client.onMessage(feedbackKey, (msg) => {
  options.onFeedback!(msg as unknown as ActionFeedbackMessage);
});
```
- `this.client.onMessage(频道, 回调)` —— 在那个进度频道上登记一个回调，并把返回的退订函数存进 `removeFeedbackHandler`（同第⑦篇套路）。
- 回调体 `options.onFeedback!(msg as unknown as ActionFeedbackMessage)`：每来一条进度，就转交给调用方给的 `onFeedback`。这里有两个新点：
  - **语法小课堂：`options.onFeedback!` 里的 `!` 是"非空断言"。** 回忆第⑥篇区分过：`!` 跟在值后面表示"我担保它不是 null/undefined"。`onFeedback` 类型是可选的（`?`，可能 `undefined`），但我们是在 `if (options.onFeedback)` 成立的分支里，明知它一定存在，于是用 `!` 告诉 TS"放心，这里它必有"，免得 TS 唠叨。（注意：这 `!` 是断言，**不是**逻辑取反——逻辑取反的 `!` 写在值**前面**，如 `!flag`。）
  - **语法小课堂：`msg as unknown as ActionFeedbackMessage` 是"双重类型断言"。** 单个 `as` 是类型断言（第⑥篇）。这里连用两次 `as unknown as X`，是一种"强行改类型"的手法：当源类型和目标类型差得太远、TS 不允许直接 `as` 时，先 `as unknown`（退到"什么都可能"的 `unknown`），再 `as ActionFeedbackMessage`（断成目标类型）。相当于"先清空 TS 的成见，再重新指定"。属于不得已的强转，能少用就少用，这里是为了把宽泛的 `msg` 贴成具体的反馈类型。

> 整段小结：**只有当调用方想看进度时，才开一条专用频道接进度，并把退订函数存好备用。**

---

## 第 40-48 行：架好"等最终结果"的 Promise

```typescript
    // Create promise that resolves on action_result
    const resultPromise = new Promise<ActionResultMessage>((resolve, reject) => {
      this.client.registerPending(
        id,
        (result) => resolve(result as ActionResultMessage),
        reject,
        timeoutMs,
      );
    });
```

这段和第⑧篇 `services.ts` 里那段**几乎一字不差**，只是类型从 `ServiceResponseMessage` 换成 `ActionResultMessage`：
- `new Promise` 建一个待兑现承诺；
- `registerPending(id, 成功回调, reject, timeoutMs)` 登记"按 `id` 等最终结果，超时则失败"。

如果第⑧篇看懂了，这里直接跳过即可——**最终结果走的就是和服务一模一样的"按 id 配对"通道**。进度反馈走上面那条独立频道，两不相干。

---

## 第 50-57 行：发出动作目标

```typescript
    // Send the goal
    this.client.send({
      op: "send_action_goal",
      id,
      action: options.action,
      action_type: options.actionType,
      args: options.args,
    });
```

- 第⑤篇的 `ActionGoalMessage` 格式：
  - `op: "send_action_goal"` —— 操作标签。
  - `id,` —— 带上配对号。
  - `action: options.action` —— 动作名。
  - `action_type: options.actionType` —— **注意命名转换**：选项里是驼峰 `actionType`，这里发给协议时变成下划线 `action_type`（回忆第⑤篇"驼峰↔下划线"——贴协议就得用下划线）。
  - `args: options.args` —— 目标参数。
- 至此：进度频道开好了、结果承诺张好了、目标也发出去了。剩下就是等。

---

## 第 59-67 行：等结果 + 无论如何都清理（`try/finally` 登场）

```typescript
    try {
      return await resultPromise;
    } finally {
      // Clean up feedback handler regardless of outcome
      if (removeFeedbackHandler) {
        removeFeedbackHandler();
      }
    }
  }
```

这是本篇唯一的全新控制结构，重点讲。

**语法小课堂：`try { ... } finally { ... }`。**
回忆第②、⑥篇见过 `try/catch`（试着跑，出错就进 `catch`）。这里是它的近亲 `try/finally`：
- `try { ... }` —— 先跑这块。
- `finally { ... }` —— **不管 `try` 块是正常结束、还是中途出错、还是 `return` 了，`finally` 块都一定会执行。** 它是"善后保证"——保证某些清理动作一定发生。
- 这里没有 `catch`，意味着"出错我不拦截（让错误照常往外抛），但**抛之前先把清理做了**"。

逐句看：

```typescript
return await resultPromise;
```
- `await resultPromise` —— 等那个"最终结果"承诺兑现，拿到结果。
  - 成功：动作做完，`registerPending` 触发 `resolve`，这里拿到 `ActionResultMessage`，`return` 出去。
  - 失败/超时：触发 `reject`，`await` 在此**抛出错误**——注意，即便抛错，下面的 `finally` 也照样会先跑。

```typescript
} finally {
  if (removeFeedbackHandler) {
    removeFeedbackHandler();
  }
}
```
- 无论上面是 `return` 了还是抛错了，都会进到这里。
- `if (removeFeedbackHandler)` —— 真值判断：当初**有**登记进度监听（不是 null）才需要撤。
- `removeFeedbackHandler();` —— 调用退订函数，把那条进度频道的监听撤掉。
- 注释 `regardless of outcome`（无论结果如何）正是 `finally` 的精髓。

> **为什么进度清理非得放 `finally`，不能直接写在 `await` 后面？**
> 因为如果动作**失败/超时**，`await` 会抛错，"写在后面的清理代码"就被跳过了，那条进度监听就**泄漏**了（永远挂在那、白占内存）。放进 `finally`，才能保证"成功也好、失败也好，监听一定被撤掉"。这正是 `finally` 存在的意义——**清理类代码的最佳归宿。**

- 最外层 `}` 结束 `sendGoal`。

---

## 第 69-80 行：`cancelGoal` 取消动作

```typescript
  /**
   * Cancel an in-progress action goal.
   *
   * @param action - The action server name
   */
  async cancelGoal(action: string): Promise<void> {
    this.client.send({
      op: "cancel_action_goal",
      id: this.client.nextId("cancel"),
      action,
    });
  }
}
```

- `async cancelGoal(action: string): Promise<void>` —— 取消某个动作，参数就一个动作名（回忆第④篇：只需一条信息时不必包成选项对象），返回 `Promise<void>`。
- 方法体只发一条第⑤篇的 `ActionCancelMessage`：
  - `op: "cancel_action_goal"` —— 操作标签。
  - `id: this.client.nextId("cancel")` —— 给取消请求也配个号（这里取消是"发完即走"，没有去 `registerPending` 等回执，所以这个 id 主要用于日志/追踪）。
  - `action,` —— 对象简写，取消哪个动作。
- 它比 `sendGoal` 简单得多——"喊停"这个动作本身不需要等结果。
- 最后的 `}` 关闭类。

---

## 三篇对照：发布 / 服务 / 动作，复杂度递增

| | 发布 (⑦) | 服务 (⑧) | 动作 (⑨) |
|---|---|---|---|
| 等回应吗 | 不等（发完即忘） | 等一个响应 | 等最终结果 |
| 配对 id | 无需 | 要（请求↔响应） | 要（目标↔结果） |
| 进度反馈 | 无 | 无 | **有**（独立频道 `__action_feedback__<id>`） |
| 善后清理 | 无 | 无 | **有**（`try/finally` 撤进度监听） |
| 超时默认 | — | 30 秒 | 120 秒（任务长） |

可以清楚看到：动作 = 服务的请求-响应骨架 + 进度旁路 + finally 清理。一层层叠上去，没有凭空冒出的新东西。

---

## 整章回顾

- `ActionClient` 把"发动作目标"做成两路并行：
  - **结果路**：和服务一样，`new Promise` + `registerPending` 按 `id` 等最终 `action_result`。
  - **进度路**：若调用方给了 `onFeedback`，单开一条 `__action_feedback__<id>` 频道实时转交进度。
- 用 `try { return await … } finally { 撤监听 }` 保证**无论成功失败，进度监听都被清理**——这是 `finally` 最典型的用法。
- `cancelGoal` 只是发一条取消消息，最简单。

至此 rosbridge 的三个小帮手（topics / services / actions）全部讲完。它们各自只懂"组一条消息、交给 client"，真正的连接与配对全靠第⑥篇的 `client`。下一篇 `adapter.ts` 会把这三个帮手 + client 拼装起来，正式"实现"第④篇那个 `RosTransport` 统一接口——届时第一次见到 `implements` 关键字。

**语法点回顾清单**（本章新增/巩固）：
- `try { ... } finally { ... }`：无论是否出错/返回，`finally` 必定执行（清理类代码的归宿）
- `!` 非空断言（值后面）vs `!` 逻辑取反（值前面）的再区分
- 双重断言 `as unknown as X`：源/目标类型差太远时的强转手法（慎用）
- `??` 在函数体内兜底默认值（vs 第⑧篇的参数默认值写法）
- `let` 用于"值会被改写"的变量（vs `const`）
- 命名转换 `actionType`(驼峰) → `action_type`(下划线贴协议)（巩固第⑤篇）

下一份：[`transport/rosbridge/adapter.ts` 逐行详解 →](10-rosbridge-adapter.ts.md)（把 client + 三帮手组装成实现 `RosTransport` 的适配器，首见 `implements`）
