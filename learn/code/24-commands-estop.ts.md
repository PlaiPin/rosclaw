# 逐行详解 ㉔：`commands/estop.ts`

> 对应源文件：[extensions/openclaw-plugin/src/commands/estop.ts](../../extensions/openclaw-plugin/src/commands/estop.ts)
>
> 推荐阅读顺序第 24 个文件。这是**第三种交互方式**登场——**命令（command）**。前面有"AI 主动调的工具"、"按时机自动触发的钩子"，现在是"**用户直接打的命令**"：在聊天里输入 `/estop`，**绕过 AI**，立刻执行。`/estop` 是急停——一键让机器人停下。它只有 40 行、几乎没有新语法，正好用来认识"命令"这个机制。

---

## 先理解"命令"和它为什么要绕过 AI

回顾三种交互：

| 方式 | 谁触发 | 例子 |
|---|---|---|
| 工具（14–21 篇） | **AI** 主动调用 | AI 听懂"前进"后调 `ros2_publish` |
| 钩子（22–23 篇） | **宿主**按时机自动触发 | 每次调工具前自动安全校验 |
| **命令（本篇）** | **用户**直接输入 `/xxx` | 用户打 `/estop` |

**为什么急停要做成命令、而不是让 AI 处理？** 因为安全！设想机器人正失控，你打字"快停下"，AI 要先理解、再决定调哪个工具、再执行——**这中间的延迟在紧急情况下不可接受**，而且 AI 万一理解错了更糟。命令是**直达**的：`/estop` 一进来，**不经过 AI**，代码立刻发停止指令。**确定、即时、可靠**——这正是急停需要的。

---

## 第 1-11 行：导入 + 注册函数开头

```typescript
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import { getTransport } from "../service.js";

/**
 * Register the /estop command.
 * This command bypasses the AI agent and immediately sends a zero-velocity
 * command to stop the robot.
 */
export function registerEstopCommand(api: OpenClawPluginApi, config: RosClawConfig): void {
  const namespace = config.robot.namespace;
```

- 导入：宿主接口、配置（都 `import type`）、`getTransport`（值导入，要调用）。
- 注释直接点明：「此命令**绕过 AI**，立即发一个零速度指令停住机器人。」
- `registerEstopCommand(api, config)` —— 第⑬篇 `index.ts` 调过它。
- `const namespace = config.robot.namespace;` —— 取命名空间（第23篇见过，给话题名加前缀用）。

---

## 第 13-16 行：注册命令 `api.registerCommand`

```typescript
  api.registerCommand({
    name: "estop",
    description: "Emergency stop — immediately halt the robot (bypasses AI)",
```

**语法小课堂：`api.registerCommand({...})` —— 登记一个命令。**
- 和 `registerTool`（工具）、`api.on`（钩子）并列，这是注册"命令"的口子。传一个 `PluginCommand` 对象（回忆第①篇定义）：
  - `name: "estop"` —— 命令名。**用户打 `/estop`** 就触发它（前面那个 `/` 是命令前缀，由宿主约定）。
  - `description` —— 命令的说明（显示在帮助列表里，给人看）。
  - 还有个 `handler`（处理函数），下面就是。
- 对比工具的 `description`（写给 AI）：命令的 `description` 是**写给人**的——因为命令是人直接打的，AI 不参与。

---

## 第 17-19 行：handler 开头 + 取传输

```typescript
    async handler(_ctx) {
      try {
        const transport = getTransport();
        const topic = namespace ? `${namespace}/cmd_vel` : "/cmd_vel";
```

- `async handler(_ctx)` —— **命令的处理函数**，用户打 `/estop` 时宿主调它。
  - `_ctx` —— 命令上下文（谁发的、哪个频道等，回忆第①篇 `CommandContext`）。急停不关心这些，加 `_` 前缀（第⑫篇）。
- `try {` —— 整个操作包在 `try/catch` 里。**为什么急停尤其要 try/catch？** 因为急停**最不能假定一切正常**——可能正好没连上、传输坏了。必须把失败也处理好、给用户明确反馈，而不是默默崩掉（下面 catch 会讲）。
- `const transport = getTransport();` —— 拿传输（没连上会抛错，进 catch）。
- `const topic = namespace ? \`${namespace}/cmd_vel\` : "/cmd_vel";` —— 三元运算（第⑥篇）拼出速度话题名：有命名空间就 `<ns>/cmd_vel`，没有就 `/cmd_vel`。和第23篇 `prefix` 同款思路。

---

## 第 22-30 行：发送"零速度"指令（急停的核心）

```typescript
        // Send zero velocity
        transport.publish({
          topic,
          type: "geometry_msgs/msg/Twist",
          msg: {
            linear: { x: 0, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
          },
        });
```

- **急停的本质就是：发一条"所有速度都是 0"的指令。** 机器人收到"速度归零"就停下。
- `transport.publish({...})` —— 调发布（第④/⑩篇），和第⑮篇发布工具用的是同一个方法，只是这里参数写死：
  - `topic` —— 刚拼的速度话题（对象简写）。
  - `type: "geometry_msgs/msg/Twist"` —— 速度指令的标准类型（第22篇见过 Twist）。
  - `msg: { linear: {x:0,y:0,z:0}, angular: {x:0,y:0,z:0} }` —— **全零的速度**：
    - `linear`（前后左右上下）三个方向都 0、`angular`（转向）三个轴都 0。
    - 这是个**嵌套对象**（对象里套对象），逐层看就清楚：`msg` 里有 `linear` 和 `angular`，各自又是 `{x,y,z}`。
    - 对照第22篇安全钩子：那里算速度大小、超限就拦；这里直接把速度全设 0——**两者都围绕 Twist，一个管"别太快"、一个管"立刻停"**。
- 注意：发布是"发完即忘"（第⑦篇），**不等回应**。急停要的就是这种"立刻发出、不墨迹"。

---

## 第 32-33 行：成功反馈

```typescript
        api.logger.warn("ESTOP: Zero velocity command sent");
        return { text: "Emergency stop activated. Robot halted." };
```

- `api.logger.warn(...)` —— 记一条**警告级**日志（急停是大事，用 `warn` 而非 `info`，方便日志里醒目）。
- `return { text: "..." };` —— **命令处理函数的返回值是 `{ text: 字符串 }`**（回忆第①篇 `CommandResult`）。
  - **语法小课堂：命令返回 `{ text }` 的含义。** 这段文字会**作为回复发回给用户**（在聊天里显示）。所以这里返回"紧急停止已激活，机器人已停止"——让用户看到确认。
  - 对比：工具返回 `{ content, details }`（给 AI 读）、钩子返回 `{ block }`/`{ prependContext }`（影响宿主）。**命令返回 `{ text }`（直接回给用户看）**——因为命令是人机直接对话，回的就是人话。

---

## 第 34-39 行：失败反馈（catch）

```typescript
      } catch (error) {
        api.logger.error(`ESTOP FAILED: ${String(error)}`);
        return { text: "Emergency stop failed — transport may be disconnected!" };
      }
    },
  });
}
```

- 如果上面任何一步失败（最可能是没连上）：
  - `api.logger.error(...)` —— 记一条**错误级**日志（`error` 比 `warn` 还高一级，回忆第①篇 logger 的级别）。急停失败是最严重的情况。
    - **语法小课堂：`String(error)`** —— 把错误对象**显式转成字符串**。回忆第23篇模板字符串里 `${err}` 会自动转字；这里用 `String(error)` 显式转，效果类似、更明确。
  - `return { text: "..." };` —— 给用户一句**明确的失败告警**："急停失败——传输可能断开了！"
- **这个 catch 的设计很重要**：急停失败**绝不能静默**。必须大声告诉用户"没停成、可能断连了"，让用户赶紧用别的办法（物理急停按钮等）。**安全相关的失败，宁可吵闹也不能沉默。**
- 收尾 `},` 关 handler、`});` 关 registerCommand、`}` 关注册函数。

---

## 整章回顾

- 本篇引入第三种交互——**命令**：用 `api.registerCommand({ name, description, handler })` 登记，用户打 `/estop` 直接触发 handler，**绕过 AI**。
- `/estop` 的实现极简：**发一条全零速度的 Twist 指令**让机器人立刻停。
- 命令返回 `{ text }`，直接作为回复显示给用户（对比工具的 `content`、钩子的 `block`/`prependContext`）。
- 全程 `try/catch` + 分级日志（成功 `warn`、失败 `error`）：**急停这种安全操作，成功要确认、失败要响亮告警，绝不静默。**

**三种交互方式对照（到此集齐）：**

| | 触发者 | 注册口 | 处理函数返回 | 返回给谁 |
|---|---|---|---|---|
| 工具 | AI | `registerTool` | `{ content, details }` | AI 读 |
| 钩子 | 宿主（按时机） | `api.on` | `{ block }` / `{ prependContext }` | 影响宿主 |
| 命令 | 用户（打 `/xxx`） | `registerCommand` | `{ text }` | 用户看 |

**语法点回顾清单**（本章新增/巩固）：
- `api.registerCommand({ name, description, handler })`：登记命令；`description` 写给人（vs 工具写给 AI）
- 命令 `handler(ctx)` 返回 `{ text }`：作为回复直接显示给用户
- 急停 = 发全零速度 Twist；嵌套对象 `{ linear:{x,y,z}, angular:{x,y,z} }`
- `String(error)` 显式转字符串（vs 模板串自动转）
- 日志分级 `info`/`warn`/`error`（安全操作用高级别）（巩固第①篇）
- 安全操作的 `try/catch`：成功确认、失败响亮告警、绝不静默

下一份：[`commands/transport.ts` 逐行详解 →](25-commands-transport.ts.md)（`/transport` 切换传输——带参数解析、`as const`、类型守卫、配置覆盖，是命令里最丰富的一个）
