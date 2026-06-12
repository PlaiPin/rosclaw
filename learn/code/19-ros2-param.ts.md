# 逐行详解 ⑲：`tools/ros2-param.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-param.ts](../../extensions/openclaw-plugin/src/tools/ros2-param.ts)
>
> 推荐阅读顺序第 19 个文件，工具层里行数最多的一个（83 行），但**不难**——因为它其实是**两个工具**装在一个文件里（读参数 `ros2_param_get` + 写参数 `ros2_param_set`），每个都是熟悉的骨架。本篇真正的新意不在语法，而在一个**设计巧思**：ROS2 没有"直接读写参数"的独立通道，参数读写其实是**调用节点自带的标准服务**完成的。这篇让你看到工具如何"把一种操作翻译成调用某个约定俗成的服务"。

---

## 先理解"参数"和它的读写方式

- ROS2 里每个**节点**（node，机器人上一个运行的程序单元）都可以有一堆**参数**（parameter）——比如最大速度、某个开关。
- 怎么读写它们？ROS2 有个约定：**每个节点自动提供两个标准服务**：
  - `<节点名>/get_parameters` —— 读参数。
  - `<节点名>/set_parameters` —— 写参数。
- 所以"读参数"本质就是"调用那个节点的 `get_parameters` 服务"。本工具做的，就是把 AI 友好的"读 node 的某参数"翻译成"调 `<node>/get_parameters` 服务、传对参数"。**它是建在第⑰篇服务调用之上的一层"语义包装"。**

> 这呼应第⑩篇 `listTopics` 调 `/rosapi/topics`、第⑪篇没有现成接口就找替代——ROS2 里大量能力都是"调某个约定服务"实现的。认识这个模式，很多代码就通了。

---

## 第 1-8 行：导入 + 注册函数（一个函数注册俩工具）

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";

/**
 * Register ros2_param_get and ros2_param_set tools with the AI agent.
 */
export function registerParamTools(api: OpenClawPluginApi): void {
```

- 导入同前。
- **注意函数名是复数 `registerParamTools`**（带 s）——回忆第⑭篇导入清单时埋的伏笔：它一口气注册**两个**工具。函数体里会有**两次** `api.registerTool(...)` 调用。其他工具文件都是"一个文件一个工具"，这个是"一个文件两个工具"。把读、写两个相关工具放一起合情合理。

---

## 第一个工具：`ros2_param_get`（读参数）

### 第 9-18 行：说明字段 + 参数

```typescript
  api.registerTool({
    name: "ros2_param_get",
    label: "ROS2 Get Parameter",
    description:
      "Get the value of a ROS2 parameter from a node. " +
      "Use this to check robot configuration values.",
    parameters: Type.Object({
      node: Type.String({ description: "The fully qualified node name (e.g., '/turtlebot3/controller')" }),
      parameter: Type.String({ description: "The parameter name (e.g., 'max_velocity')" }),
    }),
```

- `description`：「从一个节点读取某参数的值。用它来查机器人的配置值。」
- 参数两个，都必填字符串：
  - `node` —— **完整节点名**（fully qualified，即带完整路径的，如 `/turtlebot3/controller`）。
  - `parameter` —— 参数名（如 `max_velocity`）。

### 第 20-29 行：`execute`——翻译成调 `get_parameters` 服务

```typescript
    async execute(_toolCallId, params) {
      const node = params["node"] as string;
      const parameter = params["parameter"] as string;

      const transport = getTransport();
      const response = await transport.callService({
        service: `${node}/get_parameters`,
        type: "rcl_interfaces/srv/GetParameters",
        args: { names: [parameter] },
      });
```

- 取两个参数 `node`、`parameter`（必填、断言 `string`）。
- 拿传输后，**核心是这次 `callService`**——把"读参数"翻译成"调标准服务"：
  - `service: \`${node}/get_parameters\`` —— **用模板字符串拼出服务名**（回忆第⑥篇 `` `${x}` ``）。比如 `node` 是 `/turtlebot3/controller`，拼出来就是 `/turtlebot3/controller/get_parameters`。**这就是"参数读取 = 调那个节点的 get_parameters 服务"的落地。**
  - `type: "rcl_interfaces/srv/GetParameters"` —— 这是 ROS2 标准的"读参数服务"类型，写死的（所有节点的 get_parameters 都是这个类型）。
  - `args: { names: [parameter] }` —— 这个标准服务要求传一个 `names` 字段，**它是个数组**（可以一次读多个参数）。这里只读一个，所以包成单元素数组 `[parameter]`（回忆第⑥篇数组字面量）。
    - **小注意**：服务接口要的是"参数名列表"，即使只读一个也得放进数组——这是迁就底层服务的固定形状。

### 第 31-42 行：包结果返回

```typescript
      const result = {
        success: response.result,
        node,
        parameter,
        value: response.values,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
```

- 拼结果：`success`（成功标志）、回显 `node`/`parameter`（对象简写）、`value: response.values`（读到的值装进 `value`）。
- 还是 `content` + `details` 套路。
- `});` 关闭第一个工具的注册。**注意这里函数还没结束**——下面紧接着第二个工具。

---

## 第二个工具：`ros2_param_set`（写参数）

### 第 44-54 行：说明字段 + 参数

```typescript
  api.registerTool({
    name: "ros2_param_set",
    label: "ROS2 Set Parameter",
    description:
      "Set the value of a ROS2 parameter on a node. " +
      "Use this to change robot configuration at runtime.",
    parameters: Type.Object({
      node: Type.String({ description: "The fully qualified node name" }),
      parameter: Type.String({ description: "The parameter name" }),
      value: Type.Unknown({ description: "The new parameter value" }),
    }),
```

- **第二次** `api.registerTool(...)`——注册写参数工具。
- `description`：「在节点上设置某参数的值，用来在运行时改机器人配置。」
- 参数比读多一个：
  - `node`、`parameter` 同上。
  - `value: Type.Unknown({ ... })` —— **新参数：要设的新值**。用 `Type.Unknown()`（任意类型，第⑮篇）——因为参数值可能是数字、字符串、布尔……什么都可能，所以用"任意值"。

### 第 56-70 行：`execute`——翻译成调 `set_parameters` 服务

```typescript
    async execute(_toolCallId, params) {
      const node = params["node"] as string;
      const parameter = params["parameter"] as string;
      const value = params["value"];

      const transport = getTransport();
      const response = await transport.callService({
        service: `${node}/set_parameters`,
        type: "rcl_interfaces/srv/SetParameters",
        args: {
          parameters: [
            { name: parameter, value },
          ],
        },
      });
```

- 取参数：`node`、`parameter` 断言 `string`。
- `const value = params["value"];` —— **注意这行没有 `as` 断言**！因为 `value` 本就是"任意类型"，取出来是 `unknown`，而下面要做的只是把它原样传给服务，不需要断言成某个具体类型。**用不到具体类型时，就不必断言**——这和前面"断言成 string 才能用"形成对照：断言是为了"用这个值的某个具体能力"，纯转发则不需要。
- 核心 `callService`，和读参数对称：
  - `service: \`${node}/set_parameters\`` —— 拼出写参数的标准服务名。
  - `type: "rcl_interfaces/srv/SetParameters"` —— 标准的"写参数服务"类型。
  - `args` 这次结构复杂些：
    ```typescript
    args: {
      parameters: [
        { name: parameter, value },
      ],
    },
    ```
    - 这个标准服务要的是一个 `parameters` 字段，**也是数组**（可一次设多个）。
    - 数组里每项是 `{ name, value }`——参数名 + 新值。这里设一个，所以单元素数组里放一个 `{ name: parameter, value }`（`value` 对象简写）。
    - **这是个"对象套数组套对象"的嵌套结构**——逐层看就不晕：最外 `args` 是对象 → 里面 `parameters` 是数组 → 数组元素是 `{name, value}` 对象。新手遇到嵌套结构，**从外往里一层层剥**即可。

### 第 72-82 行：包结果返回

```typescript
      const result = {
        success: response.result,
        node,
        parameter,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- 结果比读参数少个 `value`（写操作不需要回显值，报告成功 + 是哪个节点的哪个参数即可）。
- 收尾 `content` + `details`。
- `});` 关闭第二个工具，最后 `}` 关闭整个 `registerParamTools` 函数（**这才是两个工具都注册完**）。

---

## 整章回顾

- `ros2-param.ts` 在**一个注册函数里注册了两个工具**（读 `ros2_param_get` + 写 `ros2_param_set`），所以函数名是复数 `registerParamTools`。
- 两个工具的核心巧思是同一个：**参数读写没有专门通道，而是调用节点自带的标准服务** `<node>/get_parameters` 和 `<node>/set_parameters`（类型固定为 `rcl_interfaces/srv/Get/SetParameters`）。工具用**模板字符串拼出服务名**、按标准服务要求的形状（`names` 数组 / `parameters` 数组）组织参数。
- 认识这个模式（"某能力 = 调某约定服务"）后，回头看第⑩篇 `listTopics` 调 `/rosapi/topics` 就完全是同一回事。

**语法点回顾清单**（本章新增/巩固）：
- 一个注册函数里 **两次** `api.registerTool`（一个文件注册多个工具）
- 模板字符串拼服务名 `` `${node}/get_parameters` ``（巩固第⑥篇）
- 迁就底层服务形状：单个值也要包成数组 `names: [parameter]`、嵌套 `parameters: [{ name, value }]`
- 嵌套结构"从外往里逐层剥"的阅读法
- `Type.Unknown()` 描述"任意类型的值"参数（第⑮篇）
- 纯转发的值**不必断言**（`const value = params["value"];` 没有 `as`）vs 要用具体能力才断言——一个对照

---

## 工具层进度小结

到这里，工具层已讲完 5 个（发布⑮、订阅⑯、服务⑰、动作⑱、参数⑲）。它们共享同一副骨架，差别只在"调底层哪个方法、参数怎么配、结果怎么措辞"。**你已经完全掌握了工具的写法套路。** 剩下两个工具（第 20 自省、第 21 摄像头）会各带一点小新意（自省是"列能力"、摄像头涉及图片返回），但骨架都一样，会更快。

下一份：[`ros2-introspect.ts` 逐行详解 →](20-ros2-introspect.ts.md)（自省工具：让 AI 问"机器人有哪些话题/服务/动作"——直接调第⑩篇那几个 list 方法）
