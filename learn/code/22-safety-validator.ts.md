# 逐行详解 ㉒：`safety/validator.ts`

> 对应源文件：[extensions/openclaw-plugin/src/safety/validator.ts](../../extensions/openclaw-plugin/src/safety/validator.ts)
>
> 推荐阅读顺序第 22 个文件，**第六部分「钩子与命令」的开篇**。前面的工具是"AI 主动调用"的；从这篇起换一种东西——**钩子（hook）**：它**不是被 AI 调用，而是在某个时机由宿主自动触发**。本篇的钩子叫 `before_tool_call`（每次 AI 要调任何工具**之前**自动触发），用来做**安全校验**：如果 AI 想让机器人开太快，就**拦下来**。第一次见到"钩子"机制、以及一点数学运算语法。

---

## 先理解"钩子（hook）"是什么

- **工具**：AI 说"我要调 `ros2_publish`"，宿主才执行——**被动、按需**。
- **钩子**：你预先告诉宿主"在 XX 时机，请自动帮我跑这段代码"。到点了宿主就触发它——**主动、按时机**。
- 本篇的 `before_tool_call`（工具调用前）就是个时机钩子：**每次 AI 即将调用任何工具，宿主先暂停，把"它要调什么、参数是什么"交给我们的钩子检查；钩子可以放行，也可以喊停（block）。**

```
AI 决定调用某工具
       │
       ▼
宿主触发 before_tool_call 钩子 ──> 我们的校验代码
       │                              │
       │←──── 返回 {block:true} 拦截 ──┤（不安全 → 拦下，工具不执行）
       │←──── 返回 void 放行 ──────────┘（安全 → 照常执行工具）
       ▼
（放行时）工具真正执行
```

这是一种"**拦截器**"模式——在动作发生前插一道关卡。安全校验放这里最合适：**在机器人真正动起来之前**就把危险指令挡掉。

---

## 第 1-9 行：导入 + 注册函数开头

```typescript
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";

/**
 * Register the before_tool_call safety validation hook.
 * Intercepts tool calls and validates them against safety limits.
 */
export function registerSafetyHook(api: OpenClawPluginApi, config: RosClawConfig): void {
  const safety = config.safety;
```

- 两个 `import type`：宿主接口、配置类型。
- `registerSafetyHook(api, config)` —— 第⑬篇 `index.ts` 调过它。它吃 `config`（不像工具只吃 `api`），因为安全限值就存在配置里。
- `const safety = config.safety;` —— 把配置里的安全那一节（含 `maxLinearVelocity`、`maxAngularVelocity` 等，回忆第②篇 Zod schema）取出来存个短变量，下面反复用。

---

## 第 11 行：注册钩子 `api.on(...)`

```typescript
  api.on("before_tool_call", async (event, _ctx) => {
```

**语法小课堂：`api.on(事件名, 处理函数)` —— 登记一个钩子。**
- `api.on(...)` 是宿主提供的"订阅时机"方法（回忆第①篇 plugin-api 里见过它的类型）。
- 第一个参数 `"before_tool_call"` —— 要挂在哪个时机（事件名）。
- 第二个参数 `async (event, _ctx) => {...}` —— 时机到了要跑的**处理函数**：
  - `event` —— 这次事件的信息。对 `before_tool_call` 来说，它是 `BeforeToolCallEvent`，含 `toolName`（要调哪个工具）和 `params`（参数）。
  - `_ctx` —— 上下文（agentId 等），本钩子用不到，加 `_` 前缀（第⑫篇）。
  - `async` —— 处理函数可以是异步的（虽然本篇没 await，但接口允许）。
- **这个处理函数的返回值很关键**：返回 `{ block: true, blockReason: "..." }` 就**拦截**这次工具调用；什么都不返回（`void`）就**放行**。下面会看到。

---

## 第 12-13 行：只关心发布工具

```typescript
    if (event.toolName === "ros2_publish") {
      const msg = event.params["message"] as Record<string, unknown> | undefined;
```

- `if (event.toolName === "ros2_publish")` —— **只检查发布工具**。因为只有发布（发指令给机器人）才可能让机器人危险地动起来；读数据、列话题之类无害，不必管。其他工具进了这个钩子会直接跳过整段、放行。
- `const msg = event.params["message"] as ... | undefined;` —— 取出发布工具的 `message` 参数（回忆第⑮篇：发布工具的参数里有 `message`）。
  - `event.params["message"]` —— 方括号取属性（第⑩篇）。
  - `as Record<string, unknown> | undefined` —— 断言成"对象或没有"（参数可能缺，诚实写 `| undefined`，第⑯篇）。

---

## 第 14-18 行：取出速度的两部分

```typescript
      if (msg) {
        // Check velocity limits for Twist messages
        const linear = msg["linear"] as Record<string, number> | undefined;
        const angular = msg["angular"] as Record<string, number> | undefined;
```

- `if (msg)` —— 真值判断（第⑦篇）：有消息体才往下查。
- 注释 `Twist messages`：速度指令的标准消息类型 `Twist` 长这样——有 `linear`（线速度，含 x/y/z）和 `angular`（角速度，含 x/y/z）两部分。
- 取这两部分：
  - `linear` —— 线速度对象，断言成 `Record<string, number> | undefined`（键是字符串如 "x"/"y"/"z"，值是数字；可能没有）。
  - `angular` —— 角速度对象，同理。
- **注意这里的容错思路**：层层都断言成 `| undefined` 并用 `if` 守卫——因为消息是 AI 拼的，不保证一定有这些字段。**不能假设结构完整，每层都防一手。**

---

## 第 19-29 行：校验线速度（出现数学运算）

```typescript
        if (linear) {
          const speed = Math.sqrt(
            (linear["x"] ?? 0) ** 2 +
            (linear["y"] ?? 0) ** 2 +
            (linear["z"] ?? 0) ** 2,
          );
          if (speed > safety.maxLinearVelocity) {
            api.logger.warn(`Blocked: linear velocity ${speed} exceeds limit ${safety.maxLinearVelocity}`);
            return { block: true, blockReason: `Linear velocity ${speed.toFixed(2)} m/s exceeds safety limit of ${safety.maxLinearVelocity} m/s` };
          }
        }
```

- `if (linear)` —— 有线速度才算。
- **计算合速度**（把 x/y/z 三个方向合成一个总速度大小）：
  ```typescript
  const speed = Math.sqrt(
    (linear["x"] ?? 0) ** 2 +
    (linear["y"] ?? 0) ** 2 +
    (linear["z"] ?? 0) ** 2,
  );
  ```
  - **语法小课堂：`**` 是"乘方（指数）运算符"。** `a ** 2` 就是"a 的平方"（a×a）。`** 3` 就是三次方。
  - **语法小课堂：`Math.sqrt(x)` 是"求平方根"。** （回忆第⑥篇见过 `Math.min`/`Math.pow`，`Math` 是内置数学工具箱。）
  - `(linear["x"] ?? 0)` —— 取 x 分量，没有就当 0（`??` 兜底，第⑥篇）。y、z 同理。
  - 整体是数学里的**三维向量长度公式** √(x²+y²+z²)——把三个方向的速度合成一个"总速度大小"。这就是机器人实际跑多快。
- `if (speed > safety.maxLinearVelocity)` —— 合速度超过配置的上限了吗？
  - 超了就：
    - `api.logger.warn(...)` —— 记一条**警告日志**（`warn` 比 `info` 级别高，回忆第①篇 logger）。
    - `return { block: true, blockReason: "..." };` —— **关键：返回拦截决定。**
      - `block: true` —— 告诉宿主"拦下这次工具调用，别执行"。
      - `blockReason: "..."` —— 拦截理由（会反馈给 AI/用户，说明为啥被拦）。
      - **语法小课堂：`speed.toFixed(2)`** —— 把数字格式化成"保留 2 位小数"的字符串。比如 `1.23456` → `"1.23"`。用在给人看的消息里，免得显示一长串小数。
    - **`return` 在这里直接结束整个钩子函数**——一旦决定拦截，立刻返回，后面的角速度检查也不必做了。

---

## 第 31-37 行：校验角速度

```typescript
        if (angular) {
          const rate = Math.abs(angular["z"] ?? 0);
          if (rate > safety.maxAngularVelocity) {
            api.logger.warn(`Blocked: angular velocity ${rate} exceeds limit ${safety.maxAngularVelocity}`);
            return { block: true, blockReason: `Angular velocity ${rate.toFixed(2)} rad/s exceeds safety limit of ${safety.maxAngularVelocity} rad/s` };
          }
        }
```

- 和线速度对称，但简单些——角速度只看 `z`（绕竖直轴转，即左右转的快慢，地面机器人主要就这个）。
- `const rate = Math.abs(angular["z"] ?? 0);`
  - **语法小课堂：`Math.abs(x)` 是"绝对值"。** 去掉正负号。因为转向有左右（正负），但"转多快"只看大小，所以取绝对值。`Math.abs(-1.5)` = `1.5`。
- 超限同样 `return { block: true, blockReason: ... }` 拦截。

---

## 第 41-43 行：放行（隐式）+ 收尾

```typescript
    // TODO: Add workspace limit checks for navigation goals
  });
}
```

- `// TODO:` —— 标记一个**待办**：以后还要加"导航目标的活动范围限制"（回忆 CLAUDE.md：未实现处用 `// TODO` 标记）。说明安全校验目前只做了速度，是可扩展的。
- **注意：函数走到这里没有 `return`，等于返回 `void`——也就是"放行"。** 这是关键设计：
  - 不安全 → 中途 `return { block: true }` 拦截。
  - 一路没拦 → 自然走到底、返回 `void` → 放行。
  - **"默认放行、命中危险才拦"**，所以无害的工具、安全的速度都会顺畅通过。
- `});` 关闭 `api.on` 的处理函数和调用，`}` 关闭注册函数。

---

## 整章回顾

- 本篇引入**钩子（hook）**：用 `api.on("before_tool_call", 处理函数)` 在"工具调用前"插一道关卡。**返回 `{block:true, blockReason}` 拦截，返回 `void` 放行。**
- 这个安全钩子只盯 `ros2_publish`，把 `Twist` 速度指令的**线速度合成大小**（`√(x²+y²+z²)`）和**角速度大小**（`|z|`）算出来，超过配置上限就拦下、并给出人话理由。
- 设计精髓：**默认放行，命中危险才 `return` 拦截**；层层 `if`+`| undefined` 防 AI 拼的消息结构不完整。这是"机器人动起来之前"的最后一道软件保险。

**语法点回顾清单**（本章新增/巩固）：
- 钩子机制：`api.on(事件名, async (event, ctx) => {...})`，按时机自动触发（vs 工具被动调用）
- `before_tool_call` 钩子：`event.toolName`/`event.params`，返回 `{block, blockReason}` 拦截 / `void` 放行
- `**`（乘方）、`Math.sqrt`（平方根）、`Math.abs`（绝对值）（巩固 `Math.*`）
- `数字.toFixed(2)`：格式化为保留 2 位小数的字符串
- 中途 `return` 提前结束钩子（命中即拦）、走到底隐式 `void`（放行）
- 层层 `as ... | undefined` + `if` 守卫，应对不可信的外部结构

下一份：[`context/robot-context.ts` 逐行详解 →](23-robot-context.ts.md)（另一个钩子：开聊前把"机器人有哪些能力"注入给 AI，含缓存、`Promise.all` 并行、降级兜底）
