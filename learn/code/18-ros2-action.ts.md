# 逐行详解 ⑱：`tools/ros2-action.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-action.ts](../../extensions/openclaw-plugin/src/tools/ros2-action.ts)
>
> 推荐阅读顺序第 18 个文件。发动作目标的工具。它和上一篇 `ros2-service.ts` 几乎是**双胞胎**——只把底层从 `callService` 换成第⑨篇的 `sendActionGoal`。**完全没有新语法。** 我们更快地过一遍，重点只说"动作工具和服务工具差在哪"，以及一个值得注意的取舍。

---

## 工具速览

- **它干什么**：给动作服务器发一个目标，用于**长任务**：导航到某处、机械臂运动等（回忆第③⑨篇：动作 = 长任务 + 进度反馈 + 可中途取消）。
- **和服务工具的关系**：骨架一字不差，底层方法换成 `sendActionGoal`。

---

## 第 1-22 行：导入 + 说明字段 + 参数

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_action_goal tool with the AI agent.
 * Sends action goals with progress feedback streaming.
 */
export function registerActionTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_action_goal",
    label: "ROS2 Action Goal",
    description:
      "Send a goal to a ROS2 action server and stream feedback. " +
      "Use this for long-running operations like navigation or arm movements.",
    parameters: Type.Object({
      action: Type.String({ description: "The ROS2 action server name (e.g., '/navigate_to_pose')" }),
      actionType: Type.String({ description: "The ROS2 action type (e.g., 'nav2_msgs/action/NavigateToPose')" }),
      goal: Type.Record(Type.String(), Type.Unknown(), {
        description: "The action goal parameters",
      }),
    }),
```

- 导入、骨架同前。`description` 翻译：「给动作服务器发目标并流式接收反馈。**用于长任务**，如导航或机械臂运动。」
- 三个参数（都是熟面孔）：
  - `action: Type.String(...)` —— 动作服务器名，必填。
  - `actionType: Type.String(...)` —— 动作类型，**必填**（注意没套 `Type.Optional`——回忆第⑨篇：动作类型不能省）。
  - `goal: Type.Record(...)` —— 目标参数（任意对象），**必填**（注意也没 `Optional`——发动作总得给个目标）。
- 和服务工具的细微差别：服务的 `type`/`args` 都是可选，这里 `actionType`/`goal` 都必填。这反映了"动作必须明确目标"的语义。

---

## 第 24-45 行：`execute`

```typescript
    async execute(_toolCallId, params) {
      const action = params["action"] as string;
      const actionType = params["actionType"] as string;
      const goal = params["goal"] as Record<string, unknown>;

      const transport = getTransport();
      const actionResult = await transport.sendActionGoal({
        action,
        actionType,
        args: goal,
      });

      const result = {
        success: actionResult.result,
        action,
        result: actionResult.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- **取参数**：三个都必填，全断言成确定类型（不带 `| undefined`，因为没一个是可选的）。
- `const actionResult = await transport.sendActionGoal({ action, actionType, args: goal });`
  - 调第⑨篇的 `sendActionGoal`（经第⑩篇适配器），`await` 等动作做完拿最终结果。
  - 参数对象：`action`、`actionType` 对象简写；`args: goal` —— **改名**（本工具参数叫 `goal`，但 `ActionGoalOptions` 的字段叫 `args`，所以 `args: goal`，回忆第⑮篇 `msg: message` 同理）。
  - **注意一个"缺失"**：第⑨/③篇的 `sendActionGoal` 支持 `onFeedback`（进度回调），但**这里没传**。也就是说，这个工具虽然 description 说"stream feedback（流式反馈）"，实现上却只 `await` 等最终结果、没有真正把中途进度转给 AI。
    - 为什么？因为工具的 `execute` 是"调用一次、返回一次"的模型——它没有一个持续的通道把"导航到 30%…60%…"实时喂给 AI。所以这里务实地只等最终结果。description 里的"stream feedback"更多是底层能力的描述，工具层暂未利用。**这是个诚实值得记下的取舍**：底层支持进度，但工具这一层用"等最终结果"简化了。（将来若做实时仪表盘——第 32 篇的 canvas——才会真正用上进度流。）
- **包结果**：
  - `success: actionResult.result` —— 动作结果的成功标志（第⑤篇 `ActionResult` 的 `result`）。
  - `action` —— 回显动作名。
  - `result: actionResult.values` —— 动作返回数据装进 `result` 字段。
    - **小注意**：这里外层结果对象有个字段也叫 `result`（`result: actionResult.values`），别和 `actionResult.result`（成功标志）搞混——前者是"返回数据"、后者是"成功与否"，名字撞了但含义不同。服务工具那里把数据叫 `response`，这里叫 `result`，是各文件各自的措辞，不必深究。
  - 收尾还是 `content` + `details` 套路。

---

## 服务工具 vs 动作工具：双胞胎对照

| | 服务工具 ⑰ | 动作工具 ⑱ |
|---|---|---|
| 底层方法 | `callService` | `sendActionGoal` |
| 参数可选性 | `type`/`args` 可选 | `actionType`/`goal` 必填 |
| 等待 | 等响应（秒级） | 等最终结果（可能很久） |
| 进度反馈 | 无此概念 | 底层支持，但**工具未利用** |
| execute 复杂度 | 一行 await | 一行 await（同样薄） |

> 两个工具骨架完全相同，差别全在"底层调哪个方法""哪些参数必填"。再次印证：**工具层是薄薄的转发层。**

---

## 整章回顾

- `ros2_action_goal` 是"发动作目标"工具，`execute` 核心就是 `await transport.sendActionGoal(...)`，和服务工具是双胞胎。
- 值得记住的一点：它**没有利用底层的进度回调**，只等最终结果——这是"工具调用一次返回一次"模型下的务实简化，description 里的"stream feedback"暂未在工具层兑现。
- 全篇无新语法。

**语法点回顾清单**（本章无新增，全是巩固）：
- 工具骨架 + TypeBox 参数（必填 vs `Type.Optional`）
- 全必填参数断言成确定类型（无 `| undefined`）
- `await transport.sendActionGoal(...)` 复用第⑨篇动作骨架
- 对象字段改名 `args: goal`
- 底层能力（进度回调）在工具层可以选择不用——一个真实的工程取舍

下一份：[`ros2-param.ts` 逐行详解 →](19-ros2-param.ts.md)（参数读写——一个文件里注册**两个**工具，且看到"把参数操作翻译成调用标准服务"的巧思）
