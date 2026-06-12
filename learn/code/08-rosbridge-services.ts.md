# 逐行详解 ⑧：`transport/rosbridge/services.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/services.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/services.ts)
>
> 推荐阅读顺序第 8 个文件。整个文件只有**一个函数** `callService`，但它是全项目"请求-等待响应"模式最干净的范例。上一篇 `topics.ts` 的发布是"发完即忘"，这篇的服务调用是"发出去之后**得等对方答复**"——这中间怎么把"将来才回来的响应"接住，正是本篇的主角。

---

## 先理解要解决的难题

ROS2 的"服务"是请求-响应式的（回忆第③篇打电话的比方）。难点在于：**消息是在 WebSocket 上异步来回的**。我们 `send` 出一个请求后，函数不能"原地卡住等"，但调用方又确实想"等到结果再继续"。

第⑥篇的 `client` 已经备好了解决工具——`registerPending`：你给它一个 `id` 和"响应回来时该怎么办"，它就先记在一个 Map 里；将来对应 `id` 的响应到了，它替你调用。

本篇就是把这个工具和 `Promise` 一拼，变魔术：让一个看似"返回结果"的函数，其实返回的是"将来会有结果的承诺"。

---

## 第 1-2 行：导入

```typescript
import type { RosbridgeClient } from "./client.js";
import type { ServiceResponseMessage } from "./types.js";
```

- `RosbridgeClient` —— 底层客户端类型，函数第一个参数要用。
- `ServiceResponseMessage` —— 第⑤篇定义的"服务响应消息"类型（含 `result` 成功与否、`values` 返回数据）。这就是我们最终想拿到的东西。

---

## 第 4-13 行：函数的文档注释

```typescript
/**
 * Call a ROS2 service via rosbridge.
 *
 * @param client - The rosbridge client instance
 * @param service - The service name (e.g., "/my_node/set_parameters")
 * @param args - The service request arguments
 * @param type - Optional service type
 * @param timeoutMs - Request timeout in milliseconds (default 30s)
 * @returns The service response
 */
```

- **语法小课堂：`@param` 和 `@returns` 是 JSDoc 标记。** 回忆第⑤篇见过的 `@see`。这里：
  - `@param 名字 - 说明` —— 逐个解释参数。
  - `@returns 说明` —— 解释返回值。
- 这些标记不影响运行，但编辑器会读它们：当你在别处调用 `callService` 时，鼠标悬停就能看到这些说明。等于"给函数配了说明书"。

---

## 第 14-20 行：函数签名

```typescript
export async function callService(
  client: RosbridgeClient,
  service: string,
  args?: Record<string, unknown>,
  type?: string,
  timeoutMs = 30_000,
): Promise<ServiceResponseMessage> {
```

逐部分拆：

- `export async function callService(...)` —— 导出一个 **async（异步）函数**（回忆第⑥篇：`async` 表示"这函数里会有等待，它整体返回一个 `Promise`"）。
- 参数列表：
  - `client: RosbridgeClient` —— 用哪个客户端去发。
  - `service: string` —— 服务名，必填。
  - `args?: Record<string, unknown>` —— 请求参数，**可选**（`?`）。
  - `type?: string` —— 服务类型，可选。
  - `timeoutMs = 30_000` —— **默认参数**（回忆第⑥篇）：不传就用 `30_000`（即 30000 毫秒＝30 秒；下划线 `30_000` 只是分位好读，第⑥篇讲过）。意思是"等响应最多等 30 秒，超了就算失败"。
- 返回类型 `: Promise<ServiceResponseMessage>` —— 返回一个"将来会兑现成服务响应"的承诺。因为是 `async` 函数，返回值天然被包进 `Promise`。

> **小注意：必填参数在前、可选参数在后。** `args?`、`type?` 这些带 `?` 的必须排在必填参数后面——否则调用时位置对不上。`timeoutMs` 有默认值，也相当于可选，放最后。

---

## 第 21 行：生成本次请求的唯一 id

```typescript
  const id = client.nextId("service");
```

- 调用 `client.nextId("service")` 拿一个唯一编号，比如 `"service_1"`、`"service_2"`……（第⑥篇讲过 `nextId` 内部用自增计数器）。
- **这个 `id` 是整篇的灵魂**：请求带着它发出去，响应也会带着相同的 `id` 回来。我们就靠这个号码，把"哪个响应对应哪个请求"配上对。如同快递单号。

---

## 第 23-30 行：先架好"接住响应"的 Promise（本篇核心）

```typescript
  const responsePromise = new Promise<ServiceResponseMessage>((resolve, reject) => {
    client.registerPending(
      id,
      (result) => resolve(result as ServiceResponseMessage),
      reject,
      timeoutMs,
    );
  });
```

这是全篇最需要嚼的一段。一层层拆：

**外层：`new Promise<...>((resolve, reject) => {...})`**
- 回忆第⑥篇的"Promise 构造小课堂"：`new Promise` 需要你传一个函数，这个函数收到两个开关——`resolve`（成功兑现，把结果交出去）和 `reject`（失败，抛出错误）。
- `<ServiceResponseMessage>` 指明这个 Promise 将来兑现时给出的值是 `ServiceResponseMessage` 类型。
- 重点理解：`new Promise` 此刻**并不会立刻有结果**。它只是先创建一个"待兑现的承诺"，并把"将来怎样才算成功/失败"的规则登记好。规则就写在那个箭头函数体里。

**内层：把 `resolve`/`reject` 交给 `client.registerPending`**
```typescript
client.registerPending(
  id,
  (result) => resolve(result as ServiceResponseMessage),
  reject,
  timeoutMs,
);
```
- `registerPending` 是第⑥篇 `client.ts` 里那个方法：把 `(id → 成功回调 / 失败回调 / 超时)` 记进一个待处理 Map。将来对应 `id` 的响应回来，`client` 就替我们调用成功回调；超时了就调用失败回调。
- 四个参数：
  1. `id` —— 用哪个号码登记。
  2. `(result) => resolve(result as ServiceResponseMessage)` —— **成功回调**。当响应回来，`client` 会把响应数据当 `result` 传进来；我们立刻调用 `resolve(...)`，于是外层那个 Promise 就兑现了、把结果交出去。
     - `result as ServiceResponseMessage` —— **类型断言**（回忆第⑥篇 `as`）。`client` 给回来的 `result` 类型比较宽泛，我们"断言"它其实就是服务响应，好让类型对上。
  3. `reject` —— **失败回调**。直接把 Promise 的 `reject` 交过去——一旦超时或出错，`client` 调用 `reject`，外层 Promise 就变成失败。
     - 注意这里直接写 `reject`，没有包一层箭头函数。因为 `reject` 本身就是个函数，签名正好匹配，直接整个传过去即可（回忆第①篇"函数是一等公民，可当参数传"）。
  4. `timeoutMs` —— 多久没回就算超时。

**这一段整体在干嘛？** 一句话：**"建一个空承诺，并约定好——响应到了就兑现它、超时了就让它失败。"** 注意此刻我们还没发请求！只是先把"接球网"张开。

> **再次强调顺序**：和上一篇订阅一样——**先登记好怎么接响应，再发请求**。万一服务端秒回，接球网已经张好，不会漏。

---

## 第 32-38 行：真正发出请求

```typescript
  client.send({
    op: "call_service",
    id,
    service,
    args,
    type,
  });
```

- 现在才把请求发出去。这是第⑤篇的 `ServiceCallMessage` 格式：
  - `op: "call_service"` —— 操作标签。
  - `id,` —— **对象简写**：带上刚才那个号码（`id: id`）。响应将来会带着同一个 `id` 回来，配对就靠它。
  - `service,` / `args,` / `type,` —— 都是对象简写，把同名参数原样塞进去。
- 发完这一句，请求就在路上了。但函数还没结束——下面要把"那个待兑现的承诺"返回出去。

---

## 第 40-41 行：返回承诺

```typescript
  return responsePromise;
}
```

- `return responsePromise;` —— 把第 23 行建的那个 Promise 返回给调用方。
- **关键理解**：函数到这里就返回了，但 Promise 里**还没有结果**（响应还在路上）。调用方拿到的是一个"待兑现的承诺"，它会 `await` 这个承诺——直到响应回来触发 `resolve`，`await` 才拿到结果继续往下；或者超时触发 `reject`，`await` 处抛出错误。
- `}` 结束函数。

> **为什么函数明明 `async`，却不在里面 `await`，而是直接 `return` 一个 Promise？**
> 完全可以。`async` 函数返回一个 Promise 时，外层不会再多包一层（会"摊平"）。这里作者用 `async` 主要是表明"这是个异步操作"的语义，并让返回类型自然写成 `Promise<...>`。真正的"等待"逻辑被巧妙地塞进了 `registerPending` 的回调里，而不是用 `await` 写在函数体内——这是处理"事件式异步"（响应靠回调送达，而非靠某个 `await` 的调用）的标准手法。

---

## 把整个流程串成一张图

```
①拿号 id ──→ ②张开接球网（new Promise + registerPending：约定"id 的响应到了就 resolve"）
                                   │
③发请求 send({op:"call_service", id, ...}) ──→ （消息上路，飞向 rosbridge）
                                   │
④return responsePromise（把承诺交给调用方，函数结束）
                                   ┊  …时间流逝，调用方在 await…
⑤服务端回了 {op:"service_response", id, ...}
   → client 在 Map 里按 id 找到我们登记的成功回调 → 调用 resolve(响应)
   → 那个承诺兑现 → 调用方的 await 拿到响应，继续往下
   （若 30 秒没回 → client 触发 reject → 调用方 await 处抛错）
```

这套"拿号 → 先登记回调 → 再发请求 → 返回承诺 → 响应回来按号兑现"的五步流程，就是异步请求-响应的通用骨架。下一篇动作（action）几乎是同一套，只是多了"中途进度反馈"。

---

## 整章回顾

- 本篇只有一个函数 `callService`，演示了**如何把"事件式的异步响应"包装成一个干净的 `Promise`**，让调用方能用 `await` 像写同步代码一样等结果。
- 核心三件套：
  1. `nextId` 拿唯一号——给请求和响应配对用。
  2. `new Promise` + `registerPending`——先把"响应到了/超时了怎么办"登记好（接球网先张开）。
  3. `send` 发请求 + `return promise` 交出承诺。
- 贯穿的安全准则依旧是：**先备好接收（登记回调），再触发（发请求）。**

**语法点回顾清单**（本章新增/巩固）：
- `@param` / `@returns`：JSDoc 给函数参数和返回值写说明书
- 默认参数 `timeoutMs = 30_000`、必填在前可选在后（巩固）
- `async function` 直接 `return` 一个 Promise（不一定非得在体内 `await`）
- 把 `resolve`/`reject` 透传给底层登记函数，实现"事件→Promise"的桥接
- 直接传函数名当回调（`reject`）vs 包一层箭头函数（`(result) => resolve(...)`）的区别
- 类型断言 `as`（巩固，第⑥篇见过）

下一份：[`transport/rosbridge/actions.ts` 逐行详解 →](09-rosbridge-actions.ts.md)（在本篇的请求-响应骨架上，再叠加"进度反馈"和 `try/finally` 清理）
