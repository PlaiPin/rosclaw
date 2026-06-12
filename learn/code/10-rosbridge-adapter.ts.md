# 逐行详解 ⑩：`transport/rosbridge/adapter.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/rosbridge/adapter.ts](../../extensions/openclaw-plugin/src/transport/rosbridge/adapter.ts)
>
> 推荐阅读顺序第 10 个文件。**这是"零件组装成成品"的一跳**：前面我们有了底层 `client`（⑥）和三个小帮手（⑦⑧⑨），又有了第④篇那张"插座标准" `RosTransport` 接口。这篇就是把零件拼起来，正式声明"我 `RosbridgeTransport` 实现了 `RosTransport` 这份契约"——本篇第一次见到关键字 `implements`。

---

## 先理解"适配器（adapter）"是什么

回忆第④篇的比方：`RosTransport` 是插座标准，rosbridge/local/webrtc 是三种发电方式。但我们之前写的 `client` + 三帮手，它们的"插头形状"并不完全等于插座标准——比如 `client` 有 `send`、帮手有 `publish/subscribe`，但上层工具要的是 `RosTransport` 那 13 个方法。

**适配器**就是中间那个"转接头"：它对外长成 `RosTransport` 的样子（13 个标准方法），对内则调用 `client` 和三帮手去真正干活。所以这个类很薄——几乎每个方法都是"把 `RosTransport` 的调用翻译成对底层零件的调用"。

```
上层工具  ──（只认 RosTransport 接口）──>  RosbridgeTransport（适配器）
                                                │ 内部调用
                                                ├─ RosbridgeClient（连接/收发）
                                                ├─ TopicPublisher / TopicSubscriber
                                                ├─ callService（函数）
                                                └─ ActionClient
```

---

## 第 1-21 行：导入一大堆

```typescript
import type { RosTransport } from "../transport.js";
import type {
  ConnectionStatus, ConnectionHandler, Subscription,
  PublishOptions, SubscribeOptions, ServiceCallOptions, ServiceCallResult,
  ActionGoalOptions, ActionResult, TopicInfo, ServiceInfo, ActionInfo,
  MessageHandler,
} from "../types.js";
import { RosbridgeClient } from "./client.js";
import { TopicPublisher, TopicSubscriber } from "./topics.js";
import { callService } from "./services.js";
import { ActionClient } from "./actions.js";
import type { RosbridgeClientOptions } from "./types.js";
```

注意这里出现了**两种导入**，区别很重要：

- `import type { ... }` —— 只借**类型**（`RosTransport`、各种 `Options`/`Result`、`ConnectionStatus` 等）。这些只在"标注"里出现，不参与运行（回忆第①篇）。
  - 路径里 `../transport.js`、`../types.js` 用了 `../`（上一级目录），因为本文件在 `rosbridge/` 子目录里，要去上一层拿传输层的公共类型。
- `import { ... }`（**不带 `type`**）—— 借的是**真正的值/类**：`RosbridgeClient`、`TopicPublisher`、`TopicSubscriber`、`callService`、`ActionClient`。
  - **语法小课堂：`import` vs `import type` 的实质区别。** 带 `type` 的导入编译后会被**完全抹掉**（运行时不存在）；不带 `type` 的会真的"加载那个文件、把东西拿进来"。判断标准很简单：**你要 `new` 它、调用它，就用 `import`（值）；你只拿它当类型标注，就用 `import type`。** 这里 `RosbridgeClient` 等都要 `new`/调用，所以是值导入。
  - 这些值导入的路径用 `./`（同目录的几个帮手文件）。

---

## 第 23-30 行：类声明 + 第一次见 `implements`

```typescript
/**
 * RosTransport adapter that wraps the existing RosbridgeClient.
 * ...
 */
export class RosbridgeTransport implements RosTransport {
```

**语法小课堂：`class X implements Y` —— "类实现接口"。**
- `implements`（实现）后面跟一个接口名。它向 TS 声明："**我保证提供 `RosTransport` 接口要求的所有方法**，签名一个不差。"
- 如果你漏了某个方法、或某个方法参数/返回类型对不上，TS 会**当场报错**。这就是第④篇说的"接口强制约束实现"——`implements` 就是那道强制开关。
- 它和 `extends`（第⑤篇接口继承）不同：
  - `extends` 是"继承别人的字段/实现"（拿来用）。
  - `implements` 是"承诺满足某个契约"（被检查），它**不会**给你任何现成实现，方法体还得自己一个个写。
- 直白说：`implements RosTransport` = "TS 啊，请按 `RosTransport` 那张清单挨个检查我，少一个都别放过。"

下面就是挨个兑现那 13 个方法。

---

## 第 31-37 行：字段 + 构造函数（组装零件）

```typescript
  private client: RosbridgeClient;
  private actionClient: ActionClient;

  constructor(options: RosbridgeClientOptions) {
    this.client = new RosbridgeClient(options);
    this.actionClient = new ActionClient(this.client);
  }
```

- 两个私有字段：一个底层 `client`、一个 `actionClient`（动作客户端）。
- 构造函数：
  - `this.client = new RosbridgeClient(options);` —— 用传进来的连接选项 `new` 一个底层客户端（回忆第⑥篇 `RosbridgeClient` 的构造）。
  - `this.actionClient = new ActionClient(this.client);` —— 再 `new` 一个动作客户端，并把刚建的 `client` **喂给它**（回忆第⑨篇 `ActionClient` 构造就吃一个 client）。
- 这里没用第⑦篇那种"参数属性简写"，而是显式写字段 + 在构造体里赋值——因为这两个字段不是直接来自参数，而是 `new` 出来的，没法用简写。
- **注意发布器/订阅器没有在这里建**——它们在每次 `publish`/`subscribe` 时临时建（见下文），因为每次发布/订阅的话题不同。而 `client`/`actionClient` 是全程共用一个，所以放构造里。

---

## 第 39-53 行：连接生命周期（直接转发）

```typescript
  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  getStatus(): ConnectionStatus {
    return this.client.getStatus();
  }

  onConnection(handler: ConnectionHandler): () => void {
    return this.client.onConnection(handler);
  }
```

这四个方法是最纯粹的"转发（delegation）"——自己不干活，原样转交给 `client`：

- `connect` / `disconnect` —— `await this.client.connect()`。它们是 `async`，所以用 `await` 等底层做完。（注意：`async` 函数里即便只有一句 `await xxx()`，效果等同于把那个 Promise 返回出去。）
- `getStatus` —— 不是 `async`（回忆第④篇：查状态瞬间完成不用等），直接 `return this.client.getStatus()`。
- `onConnection` —— 把回调转给 client 登记，并把 client 返回的退订函数 `return` 出去（回忆第④篇"返回一个函数"）。

> **这就是适配器的典型味道**：方法签名严格按 `RosTransport`（因为 `implements` 在盯着），方法体则一句话甩给底层零件。

---

## 第 55-58 行：`publish`（临时建发布器）

```typescript
  publish(options: PublishOptions): void {
    const publisher = new TopicPublisher(this.client, options.topic, options.type);
    publisher.publish(options.msg);
  }
```

- 接口要求 `publish(options): void`（发完即忘，不等）。
- 方法体：临时 `new` 一个第⑦篇的 `TopicPublisher`（绑定本次的话题、类型），然后调它的 `.publish(options.msg)` 把消息体发出去。
- **为什么每次都新建一个发布器？** 因为发布器是"绑定某话题"的轻量对象，建它几乎零成本。不同调用话题不同，临时建最简单，用完即弃。

---

## 第 60-68 行：`subscribe`（把帮手包装成接口要求的句柄）

```typescript
  subscribe(options: SubscribeOptions, handler: MessageHandler): Subscription {
    const subscriber = new TopicSubscriber(this.client, options.topic, options.type);
    subscriber.subscribe(handler);
    return {
      unsubscribe() {
        subscriber.unsubscribe();
      },
    };
  }
```

- 接口要求返回一个 `Subscription` 句柄（回忆第③篇：那个带 `unsubscribe()` 方法的对象）。
- 方法体：
  1. `new TopicSubscriber(...)` 建一个第⑦篇的订阅器。
  2. `subscriber.subscribe(handler)` 真正去订阅。
  3. `return { unsubscribe() { subscriber.unsubscribe(); } };` —— **返回一个现场拼出来的对象**，它正好满足 `Subscription` 接口（有个 `unsubscribe` 方法），方法内部调用订阅器的 `unsubscribe`。
- **语法小课堂：对象字面量里直接写方法。** `{ unsubscribe() { ... } }` 是"对象里内联一个方法"的简写，等价于 `{ unsubscribe: function() { ... } }`。这里现场造了一个符合 `Subscription` 形状的小对象返回出去。
- **为什么不直接 `return subscriber`？** 因为 `TopicSubscriber` 有 `subscribe`/`unsubscribe` 等一堆方法，而接口只要"一个能 `unsubscribe` 的东西"。包一层小对象，**只暴露 `unsubscribe`**，把内部的订阅器藏起来——这是"最小暴露"的好习惯。

---

## 第 70-81 行：`callService`（转发 + 重塑结果形状）

```typescript
  async callService(options: ServiceCallOptions): Promise<ServiceCallResult> {
    const response = await callService(
      this.client,
      options.service,
      options.args,
      options.type,
    );
    return {
      result: response.result,
      values: response.values,
    };
  }
```

- 调用第⑧篇那个 `callService` 函数（把 `client` 和各参数传进去），`await` 拿到 `response`（类型是 `ServiceResponseMessage`）。
- 然后**重新组装一个 `ServiceCallResult` 返回**：只挑出 `result` 和 `values` 两个字段。
- **为什么要重新组装、不直接返回 `response`？** 因为 `response`（rosbridge 内部类型 `ServiceResponseMessage`）字段更多（还带 `op`、`service` 等协议字段），而接口承诺返回的是更干净的 `ServiceCallResult`（只有 `result`+`values`）。适配器在这里**把"内部协议形状"翻译成"对外契约形状"**——这正是适配器的核心职责：屏蔽内部细节。

> 注意这里有两个 `callService`：导入进来的**函数** `callService`（第⑧篇的），和当前这个**方法** `callService`（接口要求的）。名字相同但一个是模块级函数、一个是类方法，不冲突。方法体里调用的是那个导入的函数。

---

## 第 83-96 行：`sendActionGoal`（含一处精巧的回调改造）

```typescript
  async sendActionGoal(options: ActionGoalOptions): Promise<ActionResult> {
    const response = await this.actionClient.sendGoal({
      action: options.action,
      actionType: options.actionType,
      args: options.args,
      onFeedback: options.onFeedback
        ? (feedback) => options.onFeedback!(feedback.values)
        : undefined,
    });
    return {
      result: response.result,
      values: response.values,
    };
  }
```

- 主体和服务一样：调 `this.actionClient.sendGoal(...)`（第⑨篇），`await` 拿结果，再重塑成 `ActionResult` 返回。
- 重点看 `onFeedback` 这一段——它要解决一个"形状不匹配"问题：

```typescript
onFeedback: options.onFeedback
  ? (feedback) => options.onFeedback!(feedback.values)
  : undefined,
```

- **语法小课堂：三元运算符 `条件 ? A : B`**（第⑥篇见过，这里再用）。读作"如果 `条件` 成立就取 `A`，否则取 `B`"。
- 拆解这三段：
  - 条件：`options.onFeedback` —— 调用方传了进度回调吗？（真值判断，第⑦篇）
  - 成立（`?` 后）：`(feedback) => options.onFeedback!(feedback.values)` —— 给 `sendGoal` 一个**改造过的**回调。
  - 不成立（`:` 后）：`undefined` —— 没传就给 `undefined`，即不要进度。
- **那个"改造"是什么意思？** 关键在 `feedback.values`：
  - 第⑨篇的 `ActionClient` 给进度回调送来的是**整条** `ActionFeedbackMessage`（含 `op`、`action`、`values` 等）。
  - 但本适配器对外的 `ActionGoalOptions.onFeedback`（第③篇）约定只给**进度数据本身**，也就是 `values` 那部分。
  - 所以这里包一层：底层送来整条 `feedback`，我们只把 `feedback.values` 转交给调用方的回调。又是一次"内部形状→对外形状"的翻译，只不过发生在回调的参数上。
  - `options.onFeedback!` 的 `!` 是非空断言（第⑨篇讲过）：在 `? :` 的成立分支里，`onFeedback` 必然存在，用 `!` 让 TS 闭嘴。

---

## 第 98-100 行：`cancelActionGoal`（转发）

```typescript
  async cancelActionGoal(action: string): Promise<void> {
    await this.actionClient.cancelGoal(action);
  }
```

- 最简单的转发：把取消请求甩给 `actionClient.cancelGoal`（第⑨篇）。

---

## 第 102-112 行：`listTopics`（首次见数组 `.map`）

```typescript
  async listTopics(): Promise<TopicInfo[]> {
    const response = await callService(
      this.client,
      "/rosapi/topics",
      {},
      "rosapi/srv/Topics",
    );
    const topics = (response.values?.["topics"] as string[]) ?? [];
    const types = (response.values?.["types"] as string[]) ?? [];
    return topics.map((name, i) => ({ name, type: types[i] ?? "" }));
  }
```

这是"自省"方法——问机器人"你有哪些话题"。逐行：

- 调用一个特殊服务 `"/rosapi/topics"`（rosbridge 自带的"查询所有话题"服务），类型 `"rosapi/srv/Topics"`，参数空对象 `{}`。`await` 拿到 `response`。
- 从响应里取两个并列数组：

```typescript
const topics = (response.values?.["topics"] as string[]) ?? [];
```
- 一行里塞了三个语法点，拆开：
  - `response.values?.["topics"]` —— **可选链 `?.`**（第⑥篇）+ **方括号取属性**：先安全地拿 `response.values`（它可能 `undefined`），再取里面 `"topics"` 这个键。`?.` 保证 `values` 万一不存在也不会崩，整体返回 `undefined`。
    - **语法小课堂：`对象["键名"]` 和 `对象.键名` 等价**，都是取属性。当键名是变量、或含特殊字符、或像这里来自动态数据时，常用方括号写法。
  - `as string[]` —— 类型断言（第⑥篇）：告诉 TS"这个值是字符串数组"。因为 `values` 是 `Record<string, unknown>`，取出来是 `unknown`，得断言成具体类型才能用。
  - `?? []` —— 空值合并（第⑥篇）：万一前面整串是 `undefined`，就兜底成**空数组**。保证 `topics` 一定是个数组，后面 `.map` 才不会崩。
- `types` 同理，拿到所有话题的类型数组（和 `topics` 一一对应，第 i 个名字配第 i 个类型）。

```typescript
return topics.map((name, i) => ({ name, type: types[i] ?? "" }));
```
- **语法小课堂：数组的 `.map()` 方法。** `数组.map(函数)` 会**遍历数组每个元素、把它丢给函数、收集每次的返回值、组成一个新数组**。它不改原数组，而是"逐个变形产出新数组"。
  - 这里回调 `(name, i) => (...)` 收两个参数：`name`（当前元素，即话题名）、`i`（它的下标，从 0 开始）。`.map` 的回调第二个参数总是下标。
  - 返回 `({ name, type: types[i] ?? "" })`：把每个话题名变成一个 `TopicInfo` 对象。
    - **语法小课堂：箭头函数返回对象要套圆括号 `({...})`。** 因为箭头函数后面直接跟 `{` 会被当成"函数体的花括号"，而不是"对象"。套一层圆括号 `({ ... })` 才表示"我要返回这个对象"。这是新手极易踩的坑。
    - `{ name, ... }` —— `name` 是对象简写（即 `name: name`）。
    - `type: types[i] ?? ""` —— 取第 `i` 个类型；万一对应不上（`types[i]` 是 `undefined`），兜底成空字符串 `""`。
  - 整句：把两个并列数组（名字数组 + 类型数组）"缝"成一个 `TopicInfo` 对象数组。这是处理"平行数组"的经典 `.map` 用法。

---

## 第 114-124 行：`listServices`（和 listTopics 几乎一样）

```typescript
  async listServices(): Promise<ServiceInfo[]> {
    const response = await callService(this.client, "/rosapi/services", {}, "rosapi/srv/Services");
    const services = (response.values?.["services"] as string[]) ?? [];
    const types = (response.values?.["types"] as string[]) ?? [];
    return services.map((name, i) => ({ name, type: types[i] ?? "" }));
  }
```

- 结构和 `listTopics` 一模一样，只是换成查询服务 `"/rosapi/services"`。理解了上一个，这个直接跳过。

---

## 第 126-147 行：`listActions`（最复杂——靠"猜"凑出动作列表）

```typescript
  async listActions(): Promise<ActionInfo[]> {
    // rosapi has no built-in action listing. Heuristic: action servers expose
    // topics matching */_action/feedback. Extract action names from that pattern.
    const topics = await this.listTopics();
    const actions: ActionInfo[] = [];
    const feedbackSuffix = "/_action/feedback";

    for (const topic of topics) {
      if (topic.name.endsWith(feedbackSuffix)) {
        const actionName = topic.name.slice(0, -feedbackSuffix.length);
        // Feedback type is like "pkg/action/Name_FeedbackMessage"
        // Extract base action type by stripping "_FeedbackMessage" suffix
        let actionType = topic.type;
        if (actionType.endsWith("_FeedbackMessage")) {
          actionType = actionType.slice(0, -"_FeedbackMessage".length);
        }
        actions.push({ name: actionName, type: actionType });
      }
    }

    return actions;
  }
```

- 注释先说明难处：rosbridge **没有**"列出所有动作"的现成服务。于是用一个**启发式（heuristic，即"经验性的猜测办法"）**：每个动作服务器都会暴露一个名字以 `/_action/feedback` 结尾的话题，**反过来从这些话题名就能倒推出动作名**。
- `const topics = await this.listTopics();` —— 先复用上面写的方法，拿到所有话题。（一个方法调用本类另一个方法。）
- `const actions: ActionInfo[] = [];` —— 准备一个**空数组**用来装结果。`: ActionInfo[]` 显式标注它是动作信息数组。
- `const feedbackSuffix = "/_action/feedback";` —— 把要找的后缀存成常量，避免重复写。

**`for...of` 遍历每个话题：**（回忆第⑥篇 `for...of`）

```typescript
if (topic.name.endsWith(feedbackSuffix)) {
```
- **语法小课堂：`字符串.endsWith(x)`** —— 判断字符串是否以 `x` 结尾，返回 `true`/`false`（回忆第⑥篇见过的 `.startsWith`，这是它的"结尾版"）。只挑名字以 `/_action/feedback` 结尾的话题。

```typescript
const actionName = topic.name.slice(0, -feedbackSuffix.length);
```
- **语法小课堂：`字符串.slice(起, 止)` 切片。** 取从下标 `起` 到 `止`（不含 `止`）的一段。
  - `0` —— 从头开始。
  - `-feedbackSuffix.length` —— **负数下标表示"从末尾往回数"**。`feedbackSuffix.length` 是后缀长度（`"/_action/feedback"` 有 17 个字符），`-17` 意思是"切到倒数第 17 个字符为止"，**正好把末尾那段后缀砍掉**。
  - 例：`"/nav/_action/feedback"` 砍掉 `/_action/feedback` → 剩 `"/nav"`，这就是动作名。

```typescript
let actionType = topic.type;
if (actionType.endsWith("_FeedbackMessage")) {
  actionType = actionType.slice(0, -"_FeedbackMessage".length);
}
```
- 同理，话题的**类型**形如 `"pkg/action/Name_FeedbackMessage"`，把末尾的 `_FeedbackMessage` 砍掉，还原出动作的基础类型。
- 用 `let`（不是 `const`）因为 `actionType` 的值可能被改写。
- `-"_FeedbackMessage".length` —— 直接对字符串字面量取 `.length` 当负下标，省得再起个变量。

```typescript
actions.push({ name: actionName, type: actionType });
```
- **语法小课堂：`数组.push(x)`** —— 往数组末尾追加一个元素。这里把拼好的 `ActionInfo` 塞进结果数组。

- 循环结束后 `return actions;` 返回收集到的所有动作。
- `}` 关闭方法，再一个 `}` 关闭整个类。

> **这个方法和前两个 `list` 的区别**：前两个是"调服务直接拿到现成列表再 `.map`"；这个是"没有现成服务，只能拿话题列表、用 `for` 循环 + 字符串切割**猜**出来"。注释里 `Heuristic`（启发式）就是诚实地说"这是个经验性的近似办法，不保证 100% 准"。

---

## 整章回顾

`RosbridgeTransport` 是 rosbridge 模式的"成品总装"：

> **对外严格长成 `RosTransport`（靠 `implements` 强制对齐 13 个方法），对内把每个调用翻译给 `client` 和三个帮手，并负责把"内部协议形状"重塑成"对外契约形状"。**

三类方法模式：
| 模式 | 例子 | 特点 |
|---|---|---|
| 纯转发 | `connect`/`disconnect`/`getStatus`/`onConnection`/`cancelActionGoal` | 一句甩给底层 |
| 转发 + 重塑结果 | `callService`/`sendActionGoal`/`publish`/`subscribe` | 调底层后，把结果/回调改造成接口要求的形状 |
| 自省（查能力） | `listTopics`/`listServices`/`listActions` | 调 rosapi 服务或猜话题，用 `.map`/`for` 整理成信息数组 |

**语法点回顾清单**（本章新增/巩固）：
- `implements`：类承诺实现某接口，TS 强制逐方法检查（vs `extends` 继承）
- `import`（值，要 new/调用）vs `import type`（仅类型，运行时抹除）的判断标准
- 对象字面量内联方法 `{ unsubscribe() {...} }`、现场造小对象满足接口
- 三元 `条件 ? A : B`（巩固）、`undefined` 兜底
- 数组 `.map((元素, 下标) => ...)`：逐个变形产出新数组
- 箭头函数返回对象要套圆括号 `(({...}))`（易错点）
- `对象["键名"]` 方括号取属性、平行数组"缝合"
- `字符串.endsWith` / `.slice(起, 止)` / 负数下标"从末尾数"
- `数组.push()` 追加元素、`for...of` 收集结果

下一份：[`transport/factory.ts` 逐行详解 →](11-transport-factory.ts.md)（用判别联合 + 动态 `import()` 按模式造出对应适配器，并见识 `never` 穷举检查）
