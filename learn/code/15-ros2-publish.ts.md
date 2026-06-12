# 逐行详解 ⑮：`tools/ros2-publish.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-publish.ts](../../extensions/openclaw-plugin/src/tools/ros2-publish.ts)
>
> 推荐阅读顺序第 15 个文件，**第一个真实的工具**。上一篇我们讲了工具的通用骨架，这篇就用最简单的工具——"发布消息到话题"——把骨架填满：第一次真正写 **TypeBox 参数定义**，第一次写 **`execute` 方法体**。它对应第⑩篇适配器的 `publish`，是"发指令给机器人"的入口。吃透这一篇，后面几个工具都是同款换内容。

---

## 工具速览

- **它干什么**：让 AI 往任意 ROS2 话题发一条消息。最典型用途：发速度指令到 `/cmd_vel` 让机器人动起来。
- **属于哪类**：发布是"发完即忘"（回忆第⑦篇），不等回应。所以这是最简单的工具。

---

## 第 1-3 行：导入

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";
```

- `import { Type } from "@sinclair/typebox";` —— **值导入** TypeBox 的 `Type`。它是个对象，上面挂着 `Type.Object`、`Type.String` 等一堆方法，用来描述参数形状（上一篇讲过 TypeBox 的作用）。要调用它，所以是值导入（不带 `type`）。
- `import type { OpenClawPluginApi }` —— 宿主能力包，类型标注。
- `import { getTransport } from "../service.js";` —— **值导入** 第⑫篇那个"取传输实例"的函数。工具干活时靠它拿到传输。注意路径 `../service.js`（工具在 `tools/` 子目录，要回上一层）。

---

## 第 5-9 行：注释 + 注册函数签名

```typescript
/**
 * Register the ros2_publish tool with the AI agent.
 * Allows publishing messages to any ROS2 topic.
 */
export function registerPublishTool(api: OpenClawPluginApi): void {
  api.registerTool({
```

- `registerPublishTool(api)` —— 就是第⑭篇 `registerTools` 里调的那个。它只做一件事：调 `api.registerTool({...})`，把一个工具对象递给宿主。
- `api.registerTool({` —— 开始传那个 `AgentTool` 对象（第⑭篇讲的 5 件套）。下面逐字段填。

---

## 第 11-15 行：name / label / description

```typescript
    name: "ros2_publish",
    label: "ROS2 Publish",
    description:
      "Publish a message to a ROS2 topic. Use this to send commands to the robot " +
      "(e.g., velocity commands to /cmd_vel, navigation goals, etc.).",
```

- `name: "ros2_publish"` —— AI 调用时用的机器名（下划线命名）。
- `label: "ROS2 Publish"` —— 给人看的显示名。
- `description:` —— **写给 AI 的使用说明**（第⑭篇强调过：这是最关键的字段）。
  - 内容翻译：「往一个 ROS2 话题发布消息。**用它来给机器人发指令**（例如发速度指令到 `/cmd_vel`、发导航目标等）。」
  - 注意它**举了例子**（`e.g.`）——告诉 AI 典型场景，引导它在"用户想让机器人动"时想到用这个工具。
  - **语法点**：这段字符串用 `+` 把两行拼成一整句（回忆第⑪篇字符串 `+` 拼接）。源码里换行只是为了不超宽，拼起来是一句话。

---

## 第 16-22 行：`parameters`——第一次写 TypeBox 参数

```typescript
    parameters: Type.Object({
      topic: Type.String({ description: "The ROS2 topic name (e.g., '/cmd_vel')" }),
      type: Type.String({ description: "The ROS2 message type (e.g., 'geometry_msgs/msg/Twist')" }),
      message: Type.Record(Type.String(), Type.Unknown(), {
        description: "The message payload matching the ROS2 message type schema",
      }),
    }),
```

这是本篇第一个新东西。逐个拆 TypeBox 的写法：

**语法小课堂：`Type.Object({...})` —— 描述一个"对象参数"。**
- `Type.Object({ 字段: 字段类型, ... })` 等于说"这个工具收一个对象，里头有这么几个字段"。括号里每个字段配一个"字段类型描述"。
- 它和 `interface { topic: string; ... }` 表达的意思类似，但它是**函数调用**、产出**运行时可用的 schema**（第⑭篇讲过为什么要这样）。

里头三个字段：

- `topic: Type.String({ description: "..." })`
  - **语法小课堂：`Type.String()` —— 描述"这是个字符串"。** 括号里可以传一个选项对象，这里给了 `description`——**注意这个 description 也是写给 AI 看的**，告诉 AI 这个字段填什么（"ROS2 话题名，例如 `/cmd_vel`"）。每个字段都配描述 + 例子，AI 才知道怎么填。
- `type: Type.String({ description: "..." })`
  - 同样是字符串：ROS2 消息类型，例 `geometry_msgs/msg/Twist`（Twist 是"线速度+角速度"的标准消息类型）。
- `message: Type.Record(Type.String(), Type.Unknown(), { description: "..." })`
  - **语法小课堂：`Type.Record(键类型, 值类型)` —— 描述一个"键值对对象"。** 回忆第①篇的 `Record<string, unknown>`——这就是它的 TypeBox 版：
    - `Type.String()` 第一个参数：键是字符串。
    - `Type.Unknown()` 第二个参数：值是"未知/任意"（`Type.Unknown()` = TypeBox 版的 `unknown`）。
    - 第三个参数 `{ description: ... }`：照例配说明。
  - 为什么 `message` 用这么宽松的"任意键值对"？因为**不同话题的消息结构千差万别**（速度消息长一个样、导航目标又另一个样），工具没法预先写死，只能说"给我个对象，里面具体啥字段由消息类型决定"，把灵活性留给 AI 按 `type` 去填。
  - 这正对应第①篇说的"消息体是任意结构"的设计。

> **小结这段**：`parameters` 用 TypeBox 声明"我要三个参数：话题名（字符串）、消息类型（字符串）、消息体（任意对象）"，每个都配了给 AI 看的说明和例子。

---

## 第 24 行：`execute` 方法签名

```typescript
    async execute(_toolCallId, params) {
```

- `async execute(...)` —— 工具被调用时执行的方法（第⑭篇讲的签名），`async` 因为里面可能要等（虽然发布本身不等，但接口统一要求返回 Promise）。
- `_toolCallId` —— 这次调用的编号，**本工具用不到**，加 `_` 前缀表示故意不用（回忆第⑫篇）。
- `params` —— AI 填进来的参数对象（类型 `Record<string, unknown>`，第⑭篇说过）。
- 注意这里**没写参数类型和返回类型**——因为 `api.registerTool` 已知道 `execute` 该长什么样（来自 `AgentTool` 接口），TS 能**自动推断**出 `_toolCallId: string`、`params: Record<string, unknown>`、返回 `Promise<ToolResult>`。这叫"上下文类型推断"：写在已知形状的位置上，类型不必重复写。

---

## 第 25-27 行：取出并断言参数

```typescript
      const topic = params["topic"] as string;
      const type = params["type"] as string;
      const message = params["message"] as Record<string, unknown>;
```

- 从 `params` 里把三个参数取出来。注意两个点：
  - **`params["topic"]` 用方括号取属性**（回忆第⑩篇：`对象["键名"]`）。这里用方括号是因为 `params` 的类型是 `Record<string, unknown>`（一个宽泛的字符串键映射），用方括号取键更自然。
  - **`as string` 类型断言**（回忆第⑥篇）：`params` 的值类型是 `unknown`（外部来的，不确定），取出来得断言成具体类型才能用。
    - 这里为什么敢直接断言？因为参数已经过 `parameters`（TypeBox schema）校验——宿主在调 `execute` 前会按 schema 验过，所以工具内部可以放心断言成声明的类型。**断言是"我知道它一定是这个类型"的承诺，这里有 schema 校验兜底，承诺站得住。**
- 三行分别拿到话题名、消息类型、消息体。

---

## 第 29-30 行：取传输 + 发布

```typescript
      const transport = getTransport();
      transport.publish({ topic, type, msg: message });
```

- `const transport = getTransport();` —— 调第⑫篇那个函数拿到当前活动的传输实例（取不到会抛错，第⑫篇讲过）。
- `transport.publish({ topic, type, msg: message });` —— 调传输的 `publish`（第④篇接口、第⑩篇适配器实现）发布消息。
  - 参数是个 `PublishOptions` 对象（第③篇）：`{ topic, type, msg }`。
  - `topic`、`type` 是**对象简写**（即 `topic: topic`，回忆第⑥篇）。
  - `msg: message` —— **注意这里改了名**：本工具的参数叫 `message`，但 `PublishOptions` 的字段叫 `msg`，所以写 `msg: message`（把 `message` 装进 `msg` 字段）。不能简写，因为名字不同。
- 发布是"发完即忘"，没有 `await`、没有返回值——这正是发布最简单的体现（对比下一篇订阅要等消息）。

---

## 第 32-37 行：组装并返回结果

```typescript
      const result = { success: true, topic, type };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- `const result = { success: true, topic, type };` —— 拼一个"结果摘要"对象：`success: true`（发出去了）、回显 `topic`/`type`（对象简写）。
  - 注意：发布"发完即忘"，工具**无法真正确认机器人收到没**，所以 `success: true` 只表示"消息已发出"，不代表"机器人执行了"。
- `return { content: [...], details: result };` —— 返回一个 `ToolResult`（第⑭篇讲的形状）：
  - `content: [{ type: "text", text: JSON.stringify(result) }]` —— 给 AI 看的内容：一个文本项。
    - **`JSON.stringify(result)`**（回忆第⑥篇）—— 把结果对象转成 JSON 字符串文本。**为什么转字符串？** 因为 `content` 的文本项要的是字符串，而 AI 读到的就是这串文本——它会看到 `{"success":true,"topic":"/cmd_vel","type":"..."}`，据此知道"发成功了、发的是哪个话题"。
  - `details: result` —— 把原始结果对象也附上（给程序/UI 用，AI 不必细读）。
  - **content vs details 的分工**：`content` 是"给 AI 读的文本版"，`details` 是"给机器用的对象版"。同一份结果，两种形态各取所需。这是几乎所有工具结尾的固定套路。
- `},` 关闭 `execute`，`});` 关闭 `registerTool` 调用，`}` 关闭注册函数。

---

## 整章回顾

`ros2_publish` 是最简单的工具，完整展示了工具骨架被填满的样子：

| 字段 | 本工具填的内容 |
|---|---|
| `name` | `"ros2_publish"` |
| `description` | 「发消息到话题、用来给机器人发指令」+ 举例（写给 AI） |
| `parameters` | TypeBox：`topic`(字符串) + `type`(字符串) + `message`(任意对象) |
| `execute` | 取参数（断言）→ `getTransport()` → `transport.publish(...)` → 包成 `ToolResult` 返回 |

执行流就一句话：**把 AI 给的话题/类型/消息，转成一次 `transport.publish` 发出去，再把"已发送"的摘要包成文本返回给 AI。**

**语法点回顾清单**（本章新增/巩固）：
- TypeBox：`Type.Object({...})`（对象）、`Type.String()`（字符串）、`Type.Record(键, 值)`（键值对）、`Type.Unknown()`（任意值），每项可带 `{ description }`（写给 AI）
- `execute` 的上下文类型推断（参数/返回类型由 `AgentTool` 接口推出，不必重写）
- `params["键"] as 类型`：从 `Record<string,unknown>` 取参数并断言（有 schema 校验兜底）
- 对象字段改名 `msg: message`（参数名与目标字段名不同，不能简写）
- `JSON.stringify` 把结果对象转文本放进 `content`、`details` 附原始对象——工具返回的固定套路
- 发布"发完即忘"：无 `await`、无返回，`success` 仅表示"已发出"

下一份：[`ros2-subscribe.ts` 逐行详解 →](16-ros2-subscribe.ts.md)（订阅一条消息——比发布多了"等一条消息回来"，会用上 Promise + 超时竞速）
