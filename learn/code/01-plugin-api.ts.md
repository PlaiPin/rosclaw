# 逐行详解 ①：`plugin-api.ts`

> 对应源文件：[extensions/openclaw-plugin/src/plugin-api.ts](../../extensions/openclaw-plugin/src/plugin-api.ts)
>
> 这是推荐阅读顺序的第 1 个文件。它**不是程序逻辑，而是一份"合同"**——用 TypeScript 的类型系统，把 OpenClaw 这个平台和我们插件之间的约定写下来。读懂它，你就知道"OpenClaw 会给我们什么、我们要还给它什么"。

---

## 阅读本章前，先建立 3 个最基础的概念

这 3 个概念后面会反复出现，先用大白话讲清楚。

### 概念 1：什么是"类型"？

在 TypeScript（简称 TS）里，每个数据都有"类型"，就是"这个数据长什么样"的标签。

- `string` —— 字符串，也就是文字，比如 `"你好"`、`"/cmd_vel"`。
- `number` —— 数字，比如 `3000`、`1.5`。
- `boolean` —— 布尔值，只有两个取值：`true`（真）和 `false`（假）。
- `void` —— "什么都不返回"。一个函数如果做完事不给你任何结果，它的返回类型就是 `void`。

### 概念 2：什么是 `interface`（接口）？

`interface` 是 TS 的关键字，意思是"定义一种对象的形状"。它**只描述长什么样，不写具体怎么做**。

打个比方：`interface` 就像招聘启事——"我们要招一个人，他必须会做 A、会做 B"。它不关心具体是谁来做，只规定"必须具备哪些能力/字段"。

```typescript
interface 人 {
  名字: string;   // 必须有一个叫"名字"的字段，且是文字
  年龄: number;   // 必须有一个叫"年龄"的字段，且是数字
}
```

任何对象只要同时有 `名字`（文字）和 `年龄`（数字），就算"符合这个接口"。

### 概念 3：什么是"声明文件 / 类型声明"？

这个文件开头的注释说得很清楚（第 1-7 行）：

```typescript
/**
 * Type declarations matching the real OpenClaw plugin SDK.
 *
 * Only the subset used by the rosclaw plugin is declared here.
 * These types mirror openclaw/plugin-sdk so that the plugin compiles
 * without importing the SDK at build time (it is provided at runtime).
 */
```

**语法小课堂：`/** ... */` 是什么？**
以 `/*` 开头、`*/` 结尾的是"块注释"，中间的内容计算机**完全忽略**，纯粹写给人看。开头是 `/**`（两个星号）的叫 **JSDoc 注释**，是一种约定俗成的、写给函数/类型的"文档说明"。

这段注释翻译过来是：
> 这些是与"真正的 OpenClaw 插件 SDK"相匹配的类型声明。这里只声明了 rosclaw 插件用到的那一小部分。这些类型是 `openclaw/plugin-sdk` 的"镜像"，这样插件在**编译时**不需要真的去导入 SDK 就能通过类型检查（真正的实现是在**运行时**由 OpenClaw 提供的）。

用大白话说：**OpenClaw 平台运行的时候，会塞给我们一个真实的工具箱（`api` 对象）。但我们写代码时它还不在手边，所以我们先按它的样子画一张"图纸"（类型声明），照着图纸写代码就不会出错。** 这个文件就是那张图纸。

---

## 第 9 行：导入一个外部类型

```typescript
import type { TSchema } from "@sinclair/typebox";
```

逐部分拆解：

- `import` —— 关键字，"从别的文件/库里拿东西过来用"。
- `type` —— 紧跟在 `import` 后面，强调"我只拿它的**类型**，不拿它的实际代码"。这是个优化：编译成最终运行的 JavaScript 时，这一行会被完全删掉（因为类型只在开发期检查用，运行时不需要）。
- `{ TSchema }` —— 一对花括号里写"我要拿的东西的名字"。这里要拿的是 `TSchema`。
- `from "@sinclair/typebox"` —— "从哪里拿"。`@sinclair/typebox` 是一个第三方库的名字（叫 TypeBox），用来描述"数据的结构和规则"。
- 行末的 `;` —— 分号，表示"这条语句到此结束"。TS 里分号大多数时候可加可不加，本项目风格是加。

**`TSchema` 是什么？** 它代表"一份用 TypeBox 写出来的数据结构定义"。后面工具的 `parameters`（参数定义）字段就是这个类型——AI 调用工具时要填哪些参数、每个参数什么类型，都用它来描述。现在记住"它是参数结构的类型"即可。

---

## 第 13-17 行：日志记录器 `PluginLogger`

```typescript
export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}
```

**语法小课堂：`export` 是什么？**
`export` 意思是"导出"——把这个东西公开出去，让别的文件可以 `import` 它。没有 `export` 的东西只能在本文件内部用。这里 `export interface PluginLogger` 表示"我定义了一个叫 `PluginLogger` 的接口，并且允许别的文件使用它"。

逐行看接口内部：

- `info(msg: string): void;` —— 规定：必须有一个叫 `info` 的**方法（函数）**。
  - `info` 是方法名。
  - 括号 `(msg: string)` 表示它接收一个**参数**，参数名叫 `msg`，类型是 `string`（文字）。`参数名: 类型` 是 TS 写参数的固定格式。
  - `: void` 在括号后面，表示这个方法的**返回类型是 `void`**——调用它，它只是默默打印日志，不会返回任何值给你。
- `warn(msg: string): void;` —— 同理，一个叫 `warn`（警告）的方法。
- `error(msg: string): void;` —— 一个叫 `error`（错误）的方法。

**整体含义**：OpenClaw 会给我们一个"日志对象"，上面挂着三个方法。我们想打印普通信息就调 `api.logger.info("...")`，想打印警告就 `api.logger.warn("...")`，想打印错误就 `api.logger.error("...")`。这三档对应日志的严重程度。

> 第 11 行的 `// --- Logger ---` 是**单行注释**：以 `//` 开头，从这里到行尾都是给人看的说明，计算机忽略。这里只是个分隔小标题。

---

## 第 21-31 行：AI 工具的形状 `AgentTool`

这是整个插件最核心的类型之一——它定义了"一个能被 AI 调用的工具长什么样"。

```typescript
export interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
}
```

逐字段拆解：

- `name: string;` —— 工具的**唯一 ID**，是文字。AI 在内部就是用这个名字来"点名调用"工具，比如 `"ros2_publish"`。
- `label: string;` —— 工具的**显示名**，给人在界面上看的，比如 `"ROS2 Publish"`。
- `description: string;` —— 工具的**说明书**。这一段文字会交给 AI 阅读，AI 靠它判断"什么时候该用这个工具、每个参数该怎么填"。**这段写得越精确，AI 调用得越准**，所以它极其重要。
- `parameters: TSchema;` —— 工具**参数的结构定义**（就是上面导入的 `TSchema` 类型）。它规定了 AI 调用时要提供哪些参数、各是什么类型。
- `execute(...)` —— 工具的**执行函数**，也就是"真正干活的代码"。当 AI 决定调用这个工具时，OpenClaw 就会调用这个 `execute`。

重点看 `execute` 的签名（也就是它的输入和输出）：

```typescript
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
```

它接收三个参数：

1. `toolCallId: string` —— 本次调用的唯一编号（文字），用于追踪是哪一次调用。
2. `params: Record<string, unknown>` —— AI 实际填进来的参数。
   - **语法小课堂：`Record<string, unknown>` 是什么？**
     `Record` 是 TS 内置的一个"泛型类型"，写成 `Record<键的类型, 值的类型>`，表示"一个对象，它的键是某种类型、值是另一种类型"。
     - `string` 是键的类型——意思是对象的字段名都是文字。
     - `unknown` 是值的类型——意思是"值是什么类型我现在不知道"。`unknown` 是 TS 里最"谨慎"的类型，表示"未知"，用它之前你必须先检查/断言它到底是什么，不能直接拿来乱用。
     - 合起来 `Record<string, unknown>` 就是"一个键是文字、值类型未知的普通对象"，等价于 `{ [字段名: string]: unknown }`。这正好适合描述"AI 传进来的、我们还没核实过的一包参数"。
   - **什么是"泛型"？** 就是尖括号 `<...>` 里那部分，相当于给类型传"参数"。`Record` 本身是个模板，你用 `<string, unknown>` 把模板里的空填上，得到一个具体类型。后面会反复见到尖括号，见到就想"这是在给类型传参"。
3. `signal?: AbortSignal` —— 一个"中止信号"，用来在任务执行到一半时取消它。
   - **语法小课堂：参数名后面的 `?` 是什么？**
     `?` 表示"这个参数**可选**"——调用时可以传，也可以不传。没有 `?` 的参数是必填的。所以 `signal?` 意思是"中止信号你爱给不给"。
   - `AbortSignal` 是浏览器/Node.js 内置的一个类型，专门用于"取消异步操作"，现在不深究。

返回类型是 `Promise<ToolResult>`：

- **语法小课堂：`Promise<...>` 是什么？这是理解本项目的关键。**
  很多操作不是一瞬间完成的，比如"通过网络问机器人要数据"，需要等一会儿。TS/JS 用 `Promise`（承诺）来表示"一个将来才会有结果的值"。
  - 你可以把 `Promise` 想成一张"取餐号"：你点了餐（发起了操作），拿到一张号（`Promise`），暂时没饭吃，但承诺将来饭好了凭号取。
  - `Promise<ToolResult>` 的尖括号里写的是"将来兑现时给你的东西的类型"。所以这表示"将来会给你一个 `ToolResult`（工具执行结果）"。
  - 后面你会看到 `async` 和 `await` 两个关键字，它们就是专门用来优雅地"等 Promise 兑现"的，到时再细讲。

**整体含义**：一个工具 = 一个名字 + 一个标签 + 一段给 AI 看的说明 + 一份参数结构 + 一个"将来会返回结果"的执行函数。

---

## 第 33-36 行：工具的返回结果 `ToolResult`

```typescript
export interface ToolResult {
  content: ToolContent[];
  details?: unknown;
}
```

- `content: ToolContent[];` —— 给 AI 看的内容。
  - **语法小课堂：类型后面的 `[]` 是什么？**
    `[]` 表示"数组"，也就是"一串同类型的东西排成队"。`ToolContent[]` 就是"一个由若干 `ToolContent` 组成的数组/列表"。例如 `[内容1, 内容2]`。
  - 为什么是数组？因为一次返回可能包含多条内容，比如"一段文字 + 一张图片"（后面摄像头工具就是这样）。
- `details?: unknown;` —— 可选的（注意那个 `?`）附加数据。类型是 `unknown`（未知结构）。这部分**给界面展示用，AI 不读**。

---

## 第 38-40 行：内容可以是文字或图片 `ToolContent`

```typescript
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
```

**语法小课堂：`type` 和 `interface` 有什么区别？**
`type` 也是用来定义类型的关键字。粗略说，`interface` 偏向描述"对象的形状"，而 `type` 更万能，还能表达"这个 **或** 那个"这种组合。这里用 `type` 正是因为要表达"或"。

**语法小课堂：`|` 是"联合类型"（union），表示"或者"。**
开头那个 `=` 后面换行写的 `| ... | ...`，每个 `|` 引出一个可能的选项。整体读作："`ToolContent` 是下面两种之一"：

- `{ type: "text"; text: string }` —— 第一种：一个对象，有 `type` 字段且值**正好是文字 `"text"`**，外加一个 `text` 字段放具体文字。
  - **语法小课堂：`type: "text"` 这里 `"text"` 当类型用是什么意思？**
    通常类型是 `string`（任意文字），但这里直接写了具体的 `"text"`，叫"字面量类型"——意思是"这个字段的值必须**恰好等于** `"text"` 这个词，别的文字都不行"。它起到"标签"的作用，让程序能一眼区分这是哪一种内容。
- `{ type: "image"; data: string; mimeType: string }` —— 第二种：`type` 必须是 `"image"`，再加 `data`（图片数据，通常是 base64 编码的文字）和 `mimeType`（媒体类型，比如 `"image/jpeg"`）。

**整体含义**：工具返回的每条内容，要么是"文字"，要么是"图片"，通过 `type` 字段区分。这种"用一个固定标签字段区分多种形状"的写法叫**判别联合（discriminated union）**，后面还会再见到。

---

## 第 44-54 行：服务相关类型

```typescript
export interface ServiceContext {
  config: Record<string, unknown>;
  stateDir: string;
  logger: PluginLogger;
}

export interface PluginService {
  id: string;
  start(ctx: ServiceContext): Promise<void>;
  stop?(ctx: ServiceContext): Promise<void>;
}
```

先看 `ServiceContext`（服务上下文）——OpenClaw 启动一个服务时，会把一些"环境信息"打包给我们：

- `config: Record<string, unknown>;` —— 用户填的配置（未知结构的对象）。
- `stateDir: string;` —— 一个目录路径（文字），服务可以把要持久保存的状态写在这里。
- `logger: PluginLogger;` —— 又见到上面定义的日志器类型，方便服务打日志。

再看 `PluginService`（插件服务）——所谓"服务"，是一段有**生命周期**的后台逻辑（比如"维持和机器人的连接"），它需要"启动"和"停止"两个动作：

- `id: string;` —— 服务的唯一标识。
- `start(ctx: ServiceContext): Promise<void>;` —— 启动方法。接收一个上下文 `ctx`，返回 `Promise<void>`（异步执行，做完不返回具体值）。
- `stop?(ctx: ServiceContext): Promise<void>;` —— 停止方法。注意方法名后面的 `?`：**整个 `stop` 方法是可选的**——有的服务不需要清理，就可以不提供 `stop`。

> 小结一下 `?` 出现在不同位置的含义：
> - `参数名?` → 这个**参数**可选（可不传）。
> - `字段名?` 或 `方法名?` → 这个**字段/方法**可选（可不写）。
> 本质都是"可有可无"。

---

## 第 58-80 行：命令相关类型

OpenClaw 里"命令"是用户直接敲 `/xxx` 触发的（比如 `/estop`），**不经过 AI**。这几段定义命令的相关类型。

```typescript
export interface CommandContext {
  senderId?: string;
  channel: string;
  channelId?: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
}
```

`CommandContext` 是"命令被触发时的现场信息"，挑几个关键字段看（带 `?` 的都是可选）：

- `senderId?: string;` —— 谁发的（用户 ID），可选。
- `channel: string;` —— 来自哪个渠道（如 `"telegram"`），必填。
- `isAuthorizedSender: boolean;` —— 这个发送者是否**已授权**（`true`/`false`）。这对安全很重要——比如紧急停止命令，可能只允许授权用户用。
- `args?: string;` —— 命令后面跟的参数文字。比如用户输入 `/transport rosbridge ws://x:9090`，`args` 就是 `"rosbridge ws://x:9090"`。可选（有的命令没参数）。
- `commandBody: string;` —— 命令的完整原文。
- `config: Record<string, unknown>;` —— 配置对象。
- 其余 `from / to / accountId / messageThreadId` 是不同消息平台的细节，可选，现在略过。
- 注意 `messageThreadId?: number;` 这个是**数字**类型，其它大多是文字。

```typescript
export interface PluginCommand {
  name: string;
  description: string;
  handler(ctx: CommandContext): Promise<CommandResult> | CommandResult;
}
```

`PluginCommand`（一个命令的定义）：

- `name: string;` —— 命令名，比如 `"estop"`（用户敲 `/estop`）。
- `description: string;` —— 命令说明（给人看）。
- `handler(ctx: CommandContext): Promise<CommandResult> | CommandResult;` —— 处理函数，命令被触发时执行。
  - 它接收上面的 `ctx`（现场信息）。
  - 返回类型是 `Promise<CommandResult> | CommandResult`——又见到联合 `|`。意思是"返回值**要么**是一个 `Promise<CommandResult>`（异步给结果），**要么**直接是一个 `CommandResult`（同步立刻给结果）"。这样写很贴心：你的命令逻辑如果是异步的就返回 Promise，是同步的就直接返回，两种都允许。

```typescript
export interface CommandResult {
  text: string;
}
```

`CommandResult`（命令的执行结果）非常简单：就一个 `text` 字段，是要回给用户的文字。

---

## 第 84-103 行：钩子之一 —— "会话开始前" `before_agent_start`

**先理解什么是"钩子（hook）"**：钩子是"在某个时机自动被调用的函数"。你把自己的函数"挂"在某个事件上，事件一发生，平台就替你调用它。`before_agent_start` 这个钩子，会在"AI 会话即将开始"这个时机触发——我们正好趁这时把机器人能力信息塞给 AI。

```typescript
export interface BeforeAgentStartEvent {
  prompt: string;
}
```

`BeforeAgentStartEvent`——事件触发时带来的数据，这里就是 `prompt`（用户即将发给 AI 的提示文字）。

```typescript
export interface BeforeAgentStartResult {
  prependContext?: string;
}
```

`BeforeAgentStartResult`——我们的钩子函数可以**返回**的东西：

- `prependContext?: string;` —— 可选的一段文字。如果我们返回了它，OpenClaw 会把这段文字"**前置（prepend）**"插入到 AI 的系统提示最前面。我们正是用它来注入"机器人有哪些话题/服务可用"。

```typescript
export interface BeforeAgentStartContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
}
```

`BeforeAgentStartContext`——额外的现场信息（会话 ID、工作目录等），全是可选，现在略过。

```typescript
export type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: BeforeAgentStartContext,
) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;
```

这是**最绕的一行**，但拆开就不难。它用 `type` 定义了"这个钩子的处理函数长什么样"。

**语法小课堂：`(参数) => 返回类型` 是"函数类型"的写法。**
箭头 `=>` 把"输入"和"输出"分开：左边括号里是参数，右边是返回类型。注意这里是**描述一个函数的类型**，不是真的函数体。

- 参数部分：
  - `event: BeforeAgentStartEvent` —— 第一个参数，是上面的事件数据。
  - `ctx: BeforeAgentStartContext` —— 第二个参数，是现场信息。
- 返回部分（`=>` 右边）：`Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void`
  - 这里嵌了好几层"或"，慢慢读：整体是三选一——
    1. `Promise<BeforeAgentStartResult | void>` —— 异步返回，将来兑现的可能是"一个结果"或"什么都不返回（void）"。
    2. `BeforeAgentStartResult` —— 同步直接返回一个结果。
    3. `void` —— 同步地什么都不返回。
  - 翻译成人话：**你的钩子函数，可以异步也可以同步，可以返回一段要注入的内容、也可以什么都不返回（那就不注入）。** 框架把所有合理写法都允许了，给你最大自由。

---

## 第 105-124 行：钩子之二 —— "工具调用前" `before_tool_call`

这是**安全机制的核心钩子**：在每个工具真正执行**之前**触发，给我们一个"拦下来不让它跑"的机会。

```typescript
export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}
```

`BeforeToolCallEvent`——事件数据：

- `toolName: string;` —— 即将被调用的工具名字（比如 `"ros2_publish"`）。
- `params: Record<string, unknown>;` —— AI 准备传给那个工具的参数。我们可以**检查**这些参数，判断危不危险。

```typescript
export interface BeforeToolCallResult {
  block?: boolean;
  blockReason?: string;
}
```

`BeforeToolCallResult`——我们钩子返回的东西：

- `block?: boolean;` —— 可选。如果设为 `true`，就**拦截**这次工具调用（不让它执行）。
- `blockReason?: string;` —— 可选。拦截的理由（文字）。这段理由会被回给 AI，AI 再解释给用户听（比如"速度超过安全上限，已阻止"）。

```typescript
export interface BeforeToolCallContext {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
}
```

`BeforeToolCallContext`——现场信息，含会话标识和工具名，略过。

```typescript
export type BeforeToolCallHandler = (
  event: BeforeToolCallEvent,
  ctx: BeforeToolCallContext,
) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
```

和前面那个钩子的函数类型**结构完全一样**，只是把类型换成了 `BeforeToolCall...` 系列。返回部分同样是"异步/同步、返回结果/不返回"四种组合都允许。

- **返回一个结果**（里面 `block: true`）→ 拦截工具。
- **返回 `void`（什么都不返回）** → 放行，工具照常执行。

这就是安全校验的工作方式：检查参数 → 危险就返回拦截结果 → 安全就什么都不返回。

---

## 第 128-138 行：总入口 `OpenClawPluginApi`（最重要的接口）

前面定义的所有类型，都是为了这个"总工具箱"。OpenClaw 运行时塞给我们的那个 `api` 对象，就符合这个接口。

```typescript
export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;

  registerTool(tool: AgentTool, opts?: { name?: string; names?: string[]; optional?: boolean }): void;
  registerService(service: PluginService): void;
  registerCommand(command: PluginCommand): void;

  on(hookName: "before_agent_start", handler: BeforeAgentStartHandler): void;
  on(hookName: "before_tool_call", handler: BeforeToolCallHandler): void;
}
```

逐成员拆解：

- `pluginConfig?: Record<string, unknown>;` —— 用户在界面上填的**原始配置**（可选，未知结构）。注意它是"生的"——还没校验过，所以类型是 `unknown`。我们后面会用 `config.ts` 里的工具去校验它。
- `logger: PluginLogger;` —— 那个日志器（`info/warn/error` 三件套）。

接下来三个是**注册方法**——"向 OpenClaw 登记我们提供的东西"：

- `registerTool(tool: AgentTool, opts?: {...}): void;` —— 注册一个工具。
  - 第一个参数 `tool: AgentTool` 就是我们上面讲过的工具定义。
  - 第二个参数 `opts?` 是可选的额外选项，它的类型直接写在原地：`{ name?: string; names?: string[]; optional?: boolean }`。
    - **语法小课堂：类型可以"就地内联"写。** 不一定非得先 `interface` 再引用，简单的对象类型可以直接写在花括号里。这里表示"一个对象，可能有 `name`（文字）、`names`（文字数组）、`optional`（布尔），都可选"。
  - 返回 `void`：登记完不返回东西。
- `registerService(service: PluginService): void;` —— 注册一个服务（前面的 `PluginService`）。
- `registerCommand(command: PluginCommand): void;` —— 注册一个 `/` 命令。

最后两个 `on(...)` 是**挂钩子**的方法。注意它出现了**两次**，名字都叫 `on`：

- `on(hookName: "before_agent_start", handler: BeforeAgentStartHandler): void;`
- `on(hookName: "before_tool_call", handler: BeforeToolCallHandler): void;`

**语法小课堂：为什么同名 `on` 写两遍？这叫"函数重载（overload）"。**
同一个方法，根据第一个参数传的具体值不同，第二个参数要求的类型也不同：

- 如果你调用 `api.on("before_agent_start", ...)`（第一个参数正好是字面量 `"before_agent_start"`），那么第二个参数 `handler` 必须是 `BeforeAgentStartHandler` 类型。
- 如果你调用 `api.on("before_tool_call", ...)`，第二个参数就必须是 `BeforeToolCallHandler` 类型。

TS 会根据你传的钩子名，自动要求你提供对应正确类型的处理函数，传错了会在编译期报错。这就是字面量类型（`"before_agent_start"` 当类型用）的威力——它让方法"看名下菜"。

---

## 整章回顾：这个文件到底说了什么？

用一句话总结：**它画出了 OpenClaw 和我们插件之间的全部"接口契约"。**

把这些类型按用途归类，你的脑子里就有一张地图了：

| 类别 | 类型 | 作用 |
|---|---|---|
| 日志 | `PluginLogger` | 打印 info/warn/error |
| 工具 | `AgentTool` / `ToolResult` / `ToolContent` | 定义 AI 可调用的工具、它的返回值、返回内容（文字或图片） |
| 服务 | `PluginService` / `ServiceContext` | 定义有启停生命周期的后台服务 |
| 命令 | `PluginCommand` / `CommandContext` / `CommandResult` | 定义用户敲 `/xxx` 触发的命令 |
| 钩子 | `BeforeAgentStart*` / `BeforeToolCall*` | 定义"会话前注入上下文""工具执行前拦截"两个时机 |
| 总入口 | `OpenClawPluginApi` | 把上面全部串起来：`registerTool/Service/Command` 注册东西，`on` 挂钩子 |

**你只要记住一件事**：整份文件没有一行"真正干活的代码"，全是"形状描述"。真正的实现由 OpenClaw 在运行时提供。我们后面写的每个文件，本质都是在"填这些形状"——造一个符合 `AgentTool` 的工具、写一个符合 `PluginService` 的服务，等等。

**语法点回顾清单**（这一章你新学到的）：
- `/* */`、`/** */`、`//` 三种注释
- `import type { X } from "..."` 只导入类型
- `export` 导出
- `interface` 定义对象形状；`type` 更万能、能表达"或"
- `string` / `number` / `boolean` / `void` / `unknown` 基础类型
- `字段: 类型`、`参数: 类型`、`): 返回类型` 的标注位置
- `?` 表示可选（参数/字段/方法）
- `[]` 表示数组
- `Record<K, V>` 表示键值对象
- `Promise<T>` 表示"将来才有的值"
- `|` 联合类型（"或"）
- `"具体值"` 当类型用 = 字面量类型
- 判别联合（用一个标签字段区分多种形状）
- 函数类型写法 `(参数) => 返回`
- 函数重载（同名方法写多个签名）

下一份：[`config.ts` 逐行详解 →](02-config.ts.md)
