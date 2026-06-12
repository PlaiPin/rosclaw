# 逐行详解 ㉑：`tools/ros2-camera.ts`

> 对应源文件：[extensions/openclaw-plugin/src/tools/ros2-camera.ts](../../extensions/openclaw-plugin/src/tools/ros2-camera.ts)
>
> 推荐阅读顺序第 21 个文件，**工具层的最后一个**。它让 AI 抓取摄像头的一帧画面（"机器人现在看到什么"）。结构上它和第⑯篇订阅工具**几乎一样**（同一个竞速 Promise），所以骨架你已经懂了。本篇真正的新东西只有一个概念：**图像数据是怎么在文本协议里传输的**（base64 编码）。我们重点讲这个，其余快速过。

---

## 工具速览

- **它干什么**：从摄像头话题抓一帧图像返回。用户问"你看到什么""拍张照"时用。
- **底层结构**：和第⑯篇 `subscribe_once` 同款——订阅一次、拿到一帧就退订、带超时竞速。区别在订阅的是**图像话题**、返回的是**图像数据**。

---

## 先理解"图像怎么通过文本传"

这里有个新手会困惑的点：rosbridge 走的是 **JSON 文本**协议（回忆第⑤⑥篇），而图像是**二进制数据**（一堆字节）。文本里怎么塞二进制？

答案是 **base64 编码**：

- **base64** 是一种"把任意二进制数据编码成纯文本字符串"的标准方法。它用 64 个安全字符（A-Z、a-z、0-9、`+`、`/`）来表示二进制。
- 一张 JPEG 图片本是二进制，经 base64 编码后变成一长串文本（像 `"/9j/4AAQSkZJRg..."`），就能塞进 JSON 传输了。接收方再 base64 解码还原成图片。
- 所以本工具拿到的 `data` 字段，就是**图像的 base64 文本**。description 里 "base64-encoded data" 说的正是这个。

> 你不需要会写 base64 编解码——底层和宿主会处理。你只要理解：**图像在这套文本协议里以 base64 字符串的形态传输**。

---

## 第 1-19 行：导入 + 说明字段 + 参数

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import { getTransport } from "../service.js";

/**
 * Register the ros2_camera_snapshot tool with the AI agent.
 * Grabs a single frame from a camera topic.
 */
export function registerCameraTool(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "ros2_camera_snapshot",
    label: "ROS2 Camera Snapshot",
    description:
      "Capture a single image from a ROS2 camera topic. Returns the image as base64-encoded data. " +
      "Use this when the user asks what the robot sees or requests a photo.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "The camera image topic (default: '/camera/image_raw/compressed')" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 10000)" })),
    }),
```

- 骨架同前。`description`：「从摄像头话题抓一帧图像，**以 base64 编码数据返回**。当用户问机器人看到什么、或要照片时用它。」
- 参数两个，都**可选**（`Type.Optional`，第⑯篇）：
  - `topic` —— 摄像头话题，默认 `/camera/image_raw/compressed`（`compressed` 表示压缩图像，即 JPEG 之类）。
  - `timeout` —— 超时，默认 10000 毫秒（10 秒，比第⑯篇订阅的 5 秒长——图像帧大、可能慢一点）。
  - 默认值同第⑯篇套路：描述里写"default"只是告知，真正兜底在 `execute` 里用 `??`。

---

## 第 21-23 行：`execute` 取参数（带默认值兜底）

```typescript
    async execute(_toolCallId, params) {
      const topic = (params["topic"] as string | undefined) ?? "/camera/image_raw/compressed";
      const timeout = (params["timeout"] as number | undefined) ?? 10000;
```

- 两个参数都用第⑯篇学的**断言 + `??` 兜底**写法：
  - `topic` 没填就用默认话题字符串。
  - `timeout` 没填就用 `10000`。
- 注意 `topic` 这里和第⑯篇的不同：第⑯篇 `topic` 是必填（无默认），这里 `topic` 可选且有默认值——因为摄像头话题名通常是约定俗成的那个，AI 不填也能work。

---

## 第 25-45 行：竞速 Promise（和第⑯篇同款）

```typescript
      const transport = getTransport();

      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const subscription = transport.subscribe(
          { topic, type: "sensor_msgs/msg/CompressedImage" },
          (msg: Record<string, unknown>) => {
            clearTimeout(timer);
            subscription.unsubscribe();
            resolve({
              success: true,
              topic,
              format: msg["format"] ?? "jpeg",
              data: msg["data"] ?? "",
            });
          },
        );
        const timer = setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error(`Timeout waiting for camera frame on ${topic}`));
        }, timeout);
      });
```

**这段的骨架和第⑯篇订阅工具一模一样**——竞速 Promise：订阅收到一帧就 `resolve`、超时就 `reject`，两条路都 `unsubscribe`/`clearTimeout` 清理。如果第⑯篇看懂了，这里只需看两处**不同**：

1. **订阅类型写死为图像类型**：
   ```typescript
   { topic, type: "sensor_msgs/msg/CompressedImage" }
   ```
   - 第⑯篇的订阅工具 `type` 是 AI 传的；这里直接写死 `sensor_msgs/msg/CompressedImage`（ROS2 标准的压缩图像消息类型）。因为这工具**专门**抓图像，类型固定，不用 AI 操心。

2. **收到消息后从中提取图像字段**：
   ```typescript
   resolve({
     success: true,
     topic,
     format: msg["format"] ?? "jpeg",
     data: msg["data"] ?? "",
   });
   ```
   - 第⑯篇是把整条 `msg` 原样返回；这里**只挑出图像相关的两个字段**：
     - `format: msg["format"] ?? "jpeg"` —— 图像格式。从消息里取 `format` 字段（方括号取属性，第⑩篇），万一没有就兜底成 `"jpeg"`（`??`，第⑥篇）。
     - `data: msg["data"] ?? ""` —— **图像的 base64 数据**。取消息的 `data` 字段（就是上面讲的 base64 文本），没有就兜底成空字符串。
   - `CompressedImage` 消息里就是 `format` + `data` 两个关键字段，这里精准取出，丢掉其余无关字段。

> 除这两处外，竞速、超时、清理逻辑和第⑯篇完全相同，不再重复讲。这再次体现工具的"套路化"：换个话题、换组要提取的字段，骨架照搬。

---

## 第 47-52 行：返回结果

```typescript
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
```

- **和前面所有工具一样的 `content` + `details` 套路**——把 `result`（含 base64 图像数据）`JSON.stringify` 成文本返回。
- **一个值得注意的点**：回忆第⑭篇 `ToolResult` 的 `content` 其实支持**图片类型** `{ type: "image", data, mimeType }`。本工具拿到了图像 base64，**理论上可以**返回成 `type: "image"` 让 AI 直接"看图"。但这里**仍用 `type: "text"`** 把整个结果（含 base64 串）当文本返回。
  - 这是当前实现的简化：图像数据作为文本字段塞在 JSON 里，由宿主/上层决定怎么进一步处理（比如渲染）。
  - 这是个可以改进的地方——未来若要让 AI 真正"看见"图像，可以把 `data` 单独拿出来组成 `{ type: "image", data, mimeType: "image/jpeg" }` 的 content 项。**注意到这种"现状 vs 可改进"，正是读源码读出门道的表现。**

---

## 整章回顾

- `ros2_camera_snapshot` 抓取一帧摄像头图像，**结构完全复用第⑯篇的竞速 Promise**，只改了两处：订阅类型写死为 `CompressedImage`、收到后提取 `format`/`data` 两个图像字段。
- 关键概念：**图像以 base64 字符串在 JSON 文本协议里传输**（`data` 字段就是 base64 编码的图像）。
- 当前用 `type: "text"` 返回（把 base64 塞在文本 JSON 里），`ToolResult` 其实支持 `type: "image"`，是个未来可优化点。

**语法点回顾清单**（本章新增/巩固）：
- base64：把二进制（图像）编码成纯文本，以便在 JSON 文本协议里传输（概念）
- 竞速 Promise + 超时清理（完全复用第⑯篇）
- 订阅类型写死 `"sensor_msgs/msg/CompressedImage"`（专用工具不需 AI 给类型）
- 从消息提取特定字段 `msg["format"] ?? "jpeg"` / `msg["data"] ?? ""`（方括号取属性 + `??` 兜底）
- `ToolResult.content` 支持 `text`/`image` 两型（回扣第⑭篇），本工具用 text

---

## 🎉 工具层全部讲完！

到这里，**第五部分（工具层）7 个工具文件全部讲完**（14 总装 + 15 发布 + 16 订阅 + 17 服务 + 18 动作 + 19 参数读写 + 20 自省 + 21 摄像头）。回头看，你已经掌握了：

> **一个工具 = 五件套骨架（name/label/description/parameters/execute）+ TypeBox 参数 + execute 里"取参数→调传输某方法→包成 ToolResult 返回"。** 七个工具的差别只在中间那几行，骨架完全一致。

而且工具层让你彻底吃透了 TypeBox、`content/details` 返回、竞速 Promise 等模式。**这是 AI 与机器人之间的全部"动作按钮"。**

接下来**第六部分（钩子与命令）**换一个主题：不再是"AI 主动调的工具"，而是**"在特定时机自动触发的钩子"**（动手前安全校验、开聊前注入能力）和**"用户直接打的命令"**（`/estop`、`/transport`）。会引入一些新概念（钩子机制、命令处理），但有了工具层的基础，理解起来会顺。

下一份：[`safety/validator.ts` 逐行详解 →](22-safety-validator.ts.md)（安全校验钩子：每次 AI 要调工具前，先拦一道，检查指令安不安全）
