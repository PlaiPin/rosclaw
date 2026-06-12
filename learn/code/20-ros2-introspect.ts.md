# 逐行详解 ⑳：`tools/ros2-introspect.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-introspect.ts](../../extensions/openclaw-plugin/src/tools/ros2-introspect.ts)
>
> 推荐阅读顺序第 20 个文件，工具层里**最短、最简单的一个**（29 行）。它让 AI 能问"机器人现在有哪些话题"——属于"自省（introspection，自我检查/发现能力）"。本篇唯一的新意是一个小语法：**空参数 `Type.Object({})`**（这个工具不需要任何参数）。其余全是熟套路，几分钟就能过完。

---

## 工具速览

- **它干什么**：列出机器人当前所有话题及其消息类型。让 AI **先了解"机器人能干什么、发什么数据"**，再决定调别的工具。
- **底层**：直接调第⑩篇适配器的 `listTopics`（那个用 `.map` 把 rosapi 返回缝成 `TopicInfo[]` 的方法）。

---

## 第 1-16 行：导入 + 说明字段 + 空参数

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_list_topics tool with the AI agent.
 * Allows the agent to discover available ROS2 topics at runtime.
 */
export function registerIntrospectTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_list_topics",
    label: "ROS2 List Topics",
    description:
      "List all available ROS2 topics and their message types. " +
      "Use this to discover what data the robot publishes and what commands it accepts.",
    parameters: Type.Object({}),
```

- 导入、骨架同前。
- `description`：「列出所有可用话题及其消息类型。**用它来发现机器人发布什么数据、接受什么指令。**」——这段对 AI 尤其重要：它引导 AI 在"不确定机器人有什么"时**先调这个工具摸底**。
- `parameters: Type.Object({})` —— **新点：空对象参数。**
  - **语法小课堂：`Type.Object({})` 表示"这个工具不需要任何参数"。** 回忆第⑮篇 `Type.Object({ topic: ..., ... })` 里花括号装着字段。这里花括号**空着**，就是声明"无参数"。
  - 为什么无参数？因为"列出所有话题"不需要任何输入——AI 直接调用即可。
  - 注意**还是要写 `Type.Object({})`，不能省略 `parameters`**——接口要求每个工具都得有 `parameters`（哪怕是空的），保持形状统一。

---

## 第 18-28 行：`execute`

```typescript
    async execute(_toolCallId, _params) {
      const transport = getTransport();
      const topics = await transport.listTopics();

      const result = { success: true, topics };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- `async execute(_toolCallId, _params)` —— **注意两个参数都加了 `_` 前缀**（`_toolCallId`、`_params`）。回忆第⑫篇：`_` 表示"故意不用"。因为这个工具既不看调用编号、也没有参数要读，两个都用不上，于是都标 `_`。这是目前第一个**连 `params` 都不用**的工具（前面的工具至少要读参数）。
- `const transport = getTransport();` —— 取传输。
- `const topics = await transport.listTopics();` —— **核心一行**：调第⑩篇的 `listTopics`，`await` 拿到话题信息数组 `TopicInfo[]`（每项 `{ name, type }`）。所有复杂活（调 rosapi、`.map` 缝合）都在第⑩篇做完了，这里一行取货。
- `const result = { success: true, topics };` —— 拼结果：成功标志 + 话题数组（`topics` 对象简写）。
- 收尾 `content` + `details` 套路（第⑮篇）。

---

## 整章回顾

- `ros2_list_topics` 是最简单的工具：无参数（`Type.Object({})`）、`execute` 里一句 `await transport.listTopics()` 取货、包结果返回。
- 它的意义在"自省"：让 AI 能在运行时**主动发现机器人的能力**，是 AI 智能使用其他工具的前提（先知道有哪些话题，才知道往哪发、订哪个）。
- 注意工具名叫 `list_topics`（只列话题），虽然第⑩篇适配器还有 `listServices`/`listActions`，但本工具只暴露了话题这一个。（这是当前实现的选择，未来可扩展。）

**语法点回顾清单**（本章新增/巩固）：
- `Type.Object({})`：声明"无参数"工具（花括号空着；仍必须写 `parameters`）
- `execute(_toolCallId, _params)`：两个参数都不用时都加 `_` 前缀（巩固第⑫篇）
- `await transport.listTopics()` 直接复用第⑩篇的自省方法
- `content` + `details` 返回套路（巩固）

下一份：[`ros2-camera.ts` 逐行详解 →](21-ros2-camera.ts.md)（摄像头取一帧——结构像第⑯篇订阅，但第一次处理"图片/二进制数据"）
