# 逐行详解 ⑰：`tools/ros2-service.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-service.ts](../../extensions/openclaw-plugin/src/tools/ros2-service.ts)
>
> 推荐阅读顺序第 17 个文件。调用服务的工具。好消息：**它几乎没有新语法**——骨架和第⑮⑯篇一模一样，干活的脏活早在第⑧篇 `callService` 里做完了。本篇的价值是让你看到"工具层有多薄"：当底层（传输 + 适配器）做扎实后，上层工具就只是"取参数 → 调一个传输方法 → 包结果返回"。我们快速过一遍，重点放在它和发布/订阅的细微差别上。

---

## 工具速览

- **它干什么**：调用一个 ROS2 服务，等回应。用于"请求-响应"类操作：设参数、触发某个行为、查节点状态。
- **属于哪类**：请求-响应（回忆第③篇打电话的比方、第⑧篇的 `callService`）。比订阅省心——因为"等回应 + 超时"这套逻辑早被 `callService` 封装好了，工具不用自己写竞速。

---

## 第 1-3 行：导入

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";
```

和第⑮⑯篇完全一致：TypeBox、宿主类型、取传输。

---

## 第 5-22 行：注册 + 说明字段 + 参数

```typescript
export function registerServiceTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_service_call",
    label: "ROS2 Service Call",
    description:
      "Call a ROS2 service and return the response. Use this for request/response operations " +
      "like setting parameters, triggering behaviors, or querying node state.",
    parameters: Type.Object({
      service: Type.String({ description: "The ROS2 service name (e.g., '/spawn_entity')" }),
      type: Type.Optional(Type.String({ description: "The ROS2 service type (e.g., 'gazebo_msgs/srv/SpawnEntity')" })),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "The service request arguments",
      })),
    }),
```

- 骨架你已经熟了。`description` 翻译：「调用一个服务并返回响应。**用于请求-响应操作**，比如设参数、触发行为、查节点状态。」
- 参数三个，全是见过的 TypeBox 写法（第⑮⑯篇）：
  - `service: Type.String(...)` —— 服务名，必填。
  - `type: Type.Optional(Type.String(...))` —— 服务类型，**可选**（`Type.Optional`，第⑯篇）。
  - `args: Type.Optional(Type.Record(...))` —— 请求参数，**可选的键值对对象**。这里是 `Type.Optional` 套着 `Type.Record`——"可以不填；要填就是个任意对象"。
- 没有任何新语法，跳过细讲。

---

## 第 24-41 行：`execute`——取参数、调 callService、包结果

```typescript
    async execute(_toolCallId, params) {
      const service = params["service"] as string;
      const type = params["type"] as string | undefined;
      const args = params["args"] as Record<string, unknown> | undefined;

      const transport = getTransport();
      const response = await transport.callService({ service, type, args });

      const result = {
        success: response.result,
        service,
        response: response.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

逐段：

- **取参数**（第⑮⑯篇套路）：
  - `service` 必填 → 断言 `string`。
  - `type`、`args` 可选 → 断言成 `... | undefined`（诚实写"可能没有"，回忆第⑯篇）。
- `const transport = getTransport();` —— 拿传输。
- `const response = await transport.callService({ service, type, args });` —— **本工具的核心一行**：
  - 调传输的 `callService`（第④篇接口、第⑩篇适配器、底层是第⑧篇那个函数），传一个 `{ service, type, args }` 对象（三个对象简写）。
  - `await` 等响应回来。**注意：这里不用自己写 Promise、不用 setTimeout 超时**——因为这些第⑧篇的 `callService` 内部全做好了（它自带 30 秒超时、自带按 id 配对）。工具只管 `await` 拿结果。**这就是"底层做扎实、上层就轻松"的直接体现**——对比第⑯篇订阅工具得自己手写竞速，这里一行 `await` 搞定。
- **包结果**：
  - `const result = { success: response.result, service, response: response.values };`
    - `success: response.result` —— 服务响应里的 `result` 字段是"成功与否"的布尔（第⑤篇 `ServiceCallResult`），这里改名装进 `success`。
    - `service` —— 对象简写，回显服务名。
    - `response: response.values` —— 把服务返回的数据 `values` 装进 `response` 字段。
    - **注意这里的字段改名**：底层的 `result`/`values` 被重命名成对 AI 更友好的 `success`/`response`。回忆第⑩篇适配器也做过"重塑结果形状"——这里工具又做了一层面向 AI 的措辞调整。
  - 最后 `return { content: [...JSON.stringify(result)...], details: result }` —— 还是第⑮篇那个固定收尾套路。

---

## 整章回顾

- `ros2_service_call` 是"调服务"工具，本质就是 `execute` 里一句 `await transport.callService(...)`，前面取参数、后面包结果。
- **它最大的教学意义是反衬"分层"的好处**：请求-响应那套麻烦逻辑（配对、等待、超时）沉在第⑧篇，工具层因此薄得只剩"翻译参数、转发、整理结果"。这正是好架构的样子——复杂度被关在底层，上层一目了然。
- 全篇无新语法，是一篇"巩固 + 体会分层"的轻松章节。

**语法点回顾清单**（本章无新增，全是巩固）：
- 工具五件套骨架（第⑭篇）、TypeBox 参数（第⑮⑯篇）、`Type.Optional`（第⑯篇）
- 可选参数断言成 `... | undefined`（第⑯篇）
- `await transport.callService(...)`：直接复用第⑧篇封装好的请求-响应（自带超时/配对）
- 结果字段改名 `success: response.result` / `response: response.values`（面向 AI 的措辞）
- `content` + `details` 返回套路（第⑮篇）

下一份：[`ros2-action.ts` 逐行详解 →](18-ros2-action.ts.md)（发动作目标的工具——和本篇几乎双胞胎，底层换成第⑨篇的 `sendActionGoal`）
