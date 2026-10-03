/**
 * 聊天里注册了渲染器的工具清单（与 chat.tsx 的 WorkspaceTools 一一对应）。
 *
 * 为什么单独放一个文件：注册发生在 React 组件里，单测够不着；把"哪些工具必须在聊天里
 * 有落点"变成一份可导入的清单，测试才能守住"服务端工具在聊天里不留空白"这条线——
 * 之前 save_document / workspace_* / git_* 跑完即在聊天里隐身，用户只能靠一句
 * "文件在 Files 里"去找（对标 Muse 的 HatchInlineFileChipKt 时发现的差距）。
 *
 * 新加工具的顺序：服务端 engine/chat-tools.ts 定义 → 这里登记 → chat.tsx 里给渲染器。
 */
export interface ChatToolMeta {
  name: string;
  /** 卡片/一行摘要旁的说明（中文，给用户看）。 */
  description: string;
  /**
   * "card"：结果直接渲染成消息流里的卡片（如智能体写出的文件，对应 Muse 的文档 chip）；
   * "detail"：默认收成一行（任务 · 动作），点开才看细节——过程是任务流的细节，不该喧宾夺主。
   */
  kind: "card" | "detail";
}

export const CHAT_TOOL_RENDERERS: readonly ChatToolMeta[] = [
  { name: "search_mail", description: "演示智能体检查邮箱", kind: "detail" },
  { name: "read_mail_thread", description: "展示智能体读过的邮件", kind: "detail" },
  { name: "browse_web", description: "看智能体怎么读一个网页", kind: "detail" },
  { name: "page_elements", description: "看智能体列出的页面元素", kind: "detail" },
  { name: "page_act", description: "看智能体在页面上做了什么", kind: "detail" },
  { name: "look_page", description: "看智能体看到的页面画面", kind: "detail" },
  { name: "search_web", description: "看智能体搜到了什么", kind: "detail" },
  { name: "read_pages", description: "看智能体读了哪些页面", kind: "detail" },
  { name: "present_choices", description: "看智能体给出的选项与来源对比", kind: "detail" },
  { name: "delegate_task", description: "展示已派发的工作", kind: "detail" },
  { name: "agent_status", description: "展示已保存的智能体进展", kind: "detail" },
  { name: "create_goal", description: "展示已保存的目标", kind: "detail" },
  { name: "watch_page", description: "展示已保存的网页监控", kind: "detail" },
  { name: "remember_fact", description: "展示已保存的个人上下文", kind: "detail" },
  // 之前漏掉的 8 个：跑完即在聊天里隐身的那些
  { name: "save_document", description: "智能体写出的文件会直接出现在这里", kind: "card" },
  { name: "read_image", description: "看智能体怎么读一张图", kind: "detail" },
  { name: "git_commit", description: "看智能体提交了什么", kind: "detail" },
  { name: "git_push", description: "看智能体推送了哪个仓库", kind: "detail" },
  { name: "workspace_read_file", description: "看智能体读了哪个文件", kind: "detail" },
  { name: "workspace_write_file", description: "看智能体写了哪个文件", kind: "detail" },
  { name: "workspace_edit_file", description: "看智能体改了哪个文件", kind: "detail" },
  { name: "workspace_list_files", description: "看智能体列了哪些文件", kind: "detail" },
];

export const CHAT_TOOL_NAMES: readonly string[] = CHAT_TOOL_RENDERERS.map((tool) => tool.name);
