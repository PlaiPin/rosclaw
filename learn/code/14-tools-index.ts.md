# 逐行详解 ⑭：`tools/index.ts`（含「工具通用结构」总览）

> 对应源文件：[extensions/openclaw-plugin/src/tools/index.ts](../../extensions/openclaw-plugin/src/tools/index.ts)
>
> 推荐阅读顺序第 14 个文件，**工具层的开篇**。从这里开始进入插件最"接地气"的部分——**工具（tool）**：AI 真正用来指挥机器人的一个个具体动作（发布、订阅、调服务、发动作、查参数……）。本篇文件本身只有 21 行（和第⑬篇 `index.ts` 一个套路：把一堆注册函数串起来），所以我们**借这篇先把"一个工具长什么样"的通用结构讲清楚**，后面第 15–21 篇每个具体工具就只讲它的独特部分，不再重复骨架。

---

## 先理解"工具"在这套系统里的位置

回忆项目架构：用户用自然语言对 AI 说"让机器人前进"，AI 听懂后，需要一个**实际能动手的接口**去操作机器人。这个接口就是"工具"。

- AI 不会直接发 WebSocket、也不懂 rosbridge 协议。它只会"调用工具"——像点菜一样：「我要调用 `ros2_publish` 工具，参数是话题 `/cmd_vel`、消息 `{前进速度: 0.5}`」。
- 工具内部才去干脏活：拿到传输实例（第⑫篇 `getTransport`）、把 AI 给的参数翻译成 ROS2 指令发出去、把结果整理成 AI 能读的文本返回。

```
AI（听懂"前进"）──调用──> ros2_publish 工具 ──getTransport()──> 传输 ──> 机器人
                                  │
                          把结果整理成文本 ──返回──> AI（再回复用户）
```

所以**工具是 AI 与机器人之间的"动作按钮"**。本插件一共注册了一批这样的按钮，`tools/index.ts` 负责把它们全部装上。

---

## 第 1-8 行：导入 7 个工具的注册函数

```typescript
import type { OpenClawPluginApi } from "../plugin-api.js";
import { registerPublishTool } from "./ros2-publish.js";
import { registerSubscribeTool } from "./ros2-subscribe.js";
import { registerServiceTool } from "./ros2-service.js";
import { registerActionTool } from "./ros2-action.js";
import { registerParamTools } from "./ros2-param.js";
import { registerIntrospectTool } from "./ros2-introspect.js";
import { registerCameraTool } from "./ros2-camera.js";
```

- 第 1 行 `import type { OpenClawPluginApi }`——还是那个宿主能力包，只当类型标注。
- 其余 7 个是值导入（要调用）。**这串导入就是工具层的功能清单**：
  - `registerPublishTool`（第 15 篇）—— 发布消息到话题（发指令）。
  - `registerSubscribeTool`（第 16 篇）—— 订阅话题读一条消息（读传感器/状态）。
  - `registerServiceTool`（第 17 篇）—— 调用服务（请求-响应）。
  - `registerActionTool`（第 18 篇）—— 发动作目标（长任务）。
  - `registerParamTools`（第 19 篇）—— 读写参数（注意是 **Tools** 复数，它一口气注册好几个参数相关工具）。
  - `registerIntrospectTool`（第 20 篇）—— 自省：列出机器人有哪些话题/服务/动作。
  - `registerCameraTool`（第 21 篇）—— 取摄像头图像。
- 路径都是 `./ros2-xxx.js`（同目录的各工具文件）。

---

## 第 10-21 行：`registerTools`——挨个装上

```typescript
/**
 * Register all ROS2 tools with the OpenClaw AI agent.
 */
export function registerTools(api: OpenClawPluginApi): void {
  registerPublishTool(api);
  registerSubscribeTool(api);
  registerServiceTool(api);
  registerActionTool(api);
  registerParamTools(api);
  registerIntrospectTool(api);
  registerCameraTool(api);
}
```

- 和第⑬篇 `register` 的风格完全一致：一个函数，把导入的注册函数挨个调一遍，每个把自己那个工具登记到宿主。
- 全部只吃 `api`、不吃 `config`——回忆第⑬篇说过：工具运行时通过 `getTransport()` 现取传输，注册时不需要配置。
- 这个 `registerTools` 就是第⑬篇 `index.ts` 里 `registerTools(api)` 那一行调用的目标。**两层"挨个调"**：`index.ts` 调各大模块的注册函数，其中 `registerTools` 再调各工具的注册函数。一层套一层，结构清爽。

到这里这个文件就讲完了。下面进入本篇重点——**工具的通用结构**。

---

## 工具通用结构：一个工具长什么样（重点，后面都靠它）

第 15–21 篇每个工具，剥开看都是同一副骨架。我们现在把这副骨架讲透，后面就能专注于各工具的"肉"。

回忆第①篇 `plugin-api.ts` 里定义的工具类型 `AgentTool`：

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

也就是说，**注册一个工具，就是给宿主递一个满足这个形状的对象**。它有 4 个"说明字段" + 1 个"干活方法"：

### ① `name`——工具的机器名

AI 调用时用的标识，如 `"ros2_publish"`。**必须唯一**，且通常用下划线命名（AI 工具调用的惯例）。

### ② `label`——给人看的显示名

如 `"ROS2 Publish"`。用在 UI/日志里，方便人辨认。机器不靠它。

### ③ `description`——给 AI 看的"使用说明"

**这是工具里最关键的一段文字**，因为它直接决定 AI 会不会、会怎样使用这个工具。

- AI 看不到工具的代码，它**只能靠 `description` 判断"什么时候该用这个工具、参数怎么填"**。
- 所以这段描述要写得像"对一个聪明但不了解你系统的助手交代任务"：说清用途，最好举例。后面会看到每个工具的 description 都带 `e.g.`（例如）举例，就是为了引导 AI 正确使用。
- 一句话：**`description` 是写给 AI 的提示词，不是写给程序员的注释。** 这是"工具开发"区别于普通函数的最大特点。

### ④ `parameters`——参数的"形状定义"（TypeBox）

声明这个工具接受哪些参数、各是什么类型。它的值是一个 `TSchema`（第①篇提过的 TypeBox 类型）。

**语法小课堂：TypeBox 是什么、为什么不用普通类型标注。**
- 我们之前定义"对象形状"用的是 `interface`/`type`（第①篇）。但那是**纯类型**——编译后就消失了，运行时不存在（回忆第①/⑩篇：类型会被抹掉）。
- 而工具参数有个特殊需求：**运行时也得有这份"形状信息"**。因为宿主要把它发给 AI（让 AI 知道该填什么参数），AI 回填后宿主还要**实际校验**值对不对。这些都发生在运行时，光有"编译期类型"不够。
- TypeBox（`@sinclair/typebox`）就是解决这个的：你用 `Type.Object({...})`、`Type.String()` 这种**函数调用**来描述形状，它产出的是一个**运行时真实存在的对象**（叫 schema/模式），同时 TS 也能从它推出编译期类型。一份定义，运行时和编译期都能用。
- 这和第②篇的 **Zod** 是"同类不同款"：Zod 也是运行时 schema，用在配置校验；TypeBox 用在工具参数（因为 AI 工具生态更认它）。两者思路一样：**用代码描述形状，运行时可用。**
- 具体的 `Type.Object`/`Type.String`/`Type.Optional` 等怎么写，下一篇（第 15）第一次真正用到时细讲。

### ⑤ `execute`——真正干活的方法

工具被 AI 调用时，宿主就执行这个方法。它的签名（第①篇）：

```typescript
execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>
```

- `toolCallId: string`——这次调用的唯一编号（多数工具用不到，所以后面常写成 `_toolCallId`，回忆第⑫篇 `_` 前缀表示故意不用）。
- `params: Record<string, unknown>`——**AI 填进来的参数**。注意类型是 `Record<string, unknown>`（键是字符串、值是"未知"）——因为参数是从外部（AI）来的，进来时类型不确定，工具内部要自己断言成具体类型再用（后面会看到 `params["topic"] as string`）。
- `signal?: AbortSignal`——可选的"取消信号"（用户中途喊停时用），多数工具不处理。
- 返回 `Promise<ToolResult>`——异步返回一个"工具结果"。

`ToolResult` 的形状（第①篇）：

```typescript
export interface ToolResult {
  content: ToolContent[];     // 给 AI 看的内容（文本或图片）
  details?: unknown;          // 可选的结构化数据（程序/UI 用）
}
```

- `content`——一个数组，每项是 `{ type: "text", text: "..." }`（文本）或 `{ type: "image", data, mimeType }`（图片）。**这是 AI 实际"读到"的工具输出**——AI 据此组织给用户的回复。
- `details`——可选的原始结构化结果，给程序或仪表盘用，AI 不一定细看。

> **一句话记住工具骨架**：4 个说明字段告诉宿主和 AI"我是谁、干嘛用、要什么参数"，`execute` 在被调用时"拿参数→干活→把结果包成 content 返回"。**后面每个工具，区别只在 `description` 写什么、`parameters` 要哪些、`execute` 里调传输的哪个方法。** 骨架都一样。

---

## 整章回顾

- `tools/index.ts` 是工具层的总装：`registerTools(api)` 把 7 个工具的注册函数挨个调一遍，被第⑬篇 `index.ts` 调用。
- **工具的通用结构**（贯穿第 15–21 篇）：一个 `AgentTool` 对象 = `name`（机器名）+ `label`（显示名）+ `description`（写给 AI 的使用说明，最关键）+ `parameters`（TypeBox 定义的参数形状，运行时可用）+ `execute`（拿参数、干活、返回 `ToolResult`）。
- 工具是"AI 与机器人之间的动作按钮"：AI 只管按按钮、读返回文本，按钮内部用 `getTransport()` 去操作机器人。

**语法点回顾清单**（本章新增/巩固）：
- 两层"挨个调注册函数"的装配结构（巩固第⑬篇）
- 工具对象的 `AgentTool` 形状：name/label/description/parameters/execute（回扣第①篇）
- `description` 是写给 AI 的提示词（决定 AI 是否/如何使用工具）——工具开发特有
- TypeBox（`Type.xxx()` 产出运行时可用的 schema）vs `interface`/`type`（编译期即抹除）的区别、与 Zod（第②篇）的对照
- `execute(_toolCallId, params): Promise<ToolResult>` 的签名、`ToolResult` 的 `content`/`details`

下一份：[`ros2-publish.ts` 逐行详解 →](15-ros2-publish.ts.md)（第一个真实工具：发布消息。第一次真正写 TypeBox 参数、第一次写 `execute` 体）
