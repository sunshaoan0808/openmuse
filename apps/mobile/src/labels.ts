import type { AgentTask } from "../../../packages/domain/src/agent";

/** 枚举直译兜底：statusLabel("in_progress") → "In progress" */
export function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
/** 任务状态的中文说法：状态本身就是"下一步该谁"的提示，别让枚举直接上屏。 */
const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "正在做",
  waiting_approval: "等你确认",
  waiting_input: "还缺信息",
  scheduled: "已排期",
  paused: "已暂停",
  succeeded: "已完成",
  failed: "出错了",
  cancelled: "已取消",
};
export function taskStatusLabel(value: string) {
  return TASK_STATUS_LABELS[value] ?? statusLabel(value);
}
const STEP_STATUS_LABELS: Record<string, string> = {
  pending: "待做",
  running: "正在做",
  succeeded: "已完成",
  failed: "失败",
  waiting: "等你",
};
export function stepStatusLabel(value: string) {
  return STEP_STATUS_LABELS[value] ?? statusLabel(value);
}
/** 待复核动作的 kind → 一句人话（复核前最先看到的就是这行）。 */
const ACTION_KIND_LABELS: Record<string, string> = {
  "email.send": "发送邮件",
  "calendar.create": "新建日程",
  "calendar.update": "修改日程",
  "calendar.delete": "删除日程",
};
export function actionKindLabel(kind: string) {
  return ACTION_KIND_LABELS[kind] ?? statusLabel(kind);
}
const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  awaiting_review: "等你确认",
  executing: "正在执行",
  approved: "已批准",
  succeeded: "已发出",
  denied: "已拒绝",
  failed: "出错了",
  outcome_unknown: "结果未知",
  expired: "已过期",
  cancelled: "已取消",
};
export function proposalStatusLabel(value: string) {
  return PROPOSAL_STATUS_LABELS[value] ?? statusLabel(value);
}
/** 任务缺几项信息（服务端放在 state.missingFields 里）。 */
export function missingCount(task: AgentTask) {
  const missing: unknown = task.state.missingFields;
  return Array.isArray(missing) ? missing.length : 0;
}
/** 铃铛面板的一句话副标题：先说"有几件要你做"。 */
export function pendingSummary(actions: number, unread: number) {
  if (actions && unread) return `${actions} 件操作等你确认 · ${unread} 条新更新`;
  if (actions) return `${actions} 件操作等你确认`;
  if (unread) return `${unread} 条更新等你查看`;
  return "结果、有意义的变更和需要你输入的内容都会出现在这里。";
}

/**
 * 表单字段名 → 中文。字段名来自原 PDF 表单（英文或下划线），
 * 认识的翻成中文，不认识的原样保留（宁可露原名，也不能丢信息）。
 */
const FIELD_LABELS: Record<string, string> = {
  name: "姓名",
  full_name: "姓名",
  first_name: "名",
  last_name: "姓",
  student: "学生",
  student_name: "学生姓名",
  student_id: "学号",
  parent: "家长",
  parent_name: "家长姓名",
  parent_email: "家长邮箱",
  parent_phone: "家长电话",
  guardian_name: "监护人姓名",
  guardian_email: "监护人邮箱",
  guardian_phone: "监护人电话",
  teacher: "老师",
  teacher_name: "老师姓名",
  teacher_email: "老师邮箱",
  school: "学校",
  school_name: "学校名称",
  classroom: "班级",
  class: "班级",
  grade: "年级",
  subject: "科目",
  date: "日期",
  today: "今天",
  start_date: "开始日期",
  end_date: "结束日期",
  due_date: "截止日期",
  signature: "签名",
  parent_signature: "家长签名",
  guardian_signature: "监护人签名",
  signature_date: "签名日期",
  date_signed: "签署日期",
  email: "邮箱",
  phone: "电话",
  mobile: "手机",
  address: "地址",
  street: "街道",
  city: "城市",
  state: "省/州",
  zip: "邮编",
  postal_code: "邮编",
  country: "国家",
  amount: "金额",
  total: "合计",
  currency: "币种",
  quantity: "数量",
  item: "项目",
  description: "说明",
  notes: "备注",
  comments: "备注",
  reason: "原因",
  title: "标题",
  role: "角色",
  company: "公司",
  department: "部门",
  emergency_contact: "紧急联系人",
  emergency_phone: "紧急联系电话",
  allergies: "过敏信息",
  medications: "用药情况",
  medication: "用药情况",
  physician: "医生",
  doctor_name: "医生姓名",
  insurance: "保险",
  policy_number: "保单号",
  consent: "同意",
  agree: "同意",
  permission: "许可",
  trip: "活动",
  trip_name: "活动名称",
  destination: "目的地",
  departure_date: "出发日期",
  return_date: "返回日期",
};
export function fieldLabel(name: string) {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return FIELD_LABELS[key] ?? statusLabel(name.replace(/_/g, " "));
}

/** 浏览器工具的动作名 → 中文（page_act 的 action 字段）。 */
const BROWSER_ACTIONS: Record<string, string> = {
  click: "点击",
  fill: "填入",
  select: "选择",
  press: "按键",
  scroll: "滚动",
  hover: "悬停",
  back: "后退",
};

/** 把一次浏览器操作说成人话，例如「点击「Search」」「在搜索框填入「hermes agent」」。 */
export function browserActionLabel(action: string, detail?: string) {
  const verb = BROWSER_ACTIONS[action] ?? action;
  if (!detail) return verb;
  return `${verb}「${detail}」`;
}

/**
 * 工具名 → 当前动作（与服务端 live-activity 同一套说法）。
 * 用于聊天里"智能体正在干活"那一行，以及动态页的实时状态。
 */
const AGENT_ACTIONS: Record<string, string> = {
  search_web: "正在搜索网页",
  read_pages: "正在读网页",
  browse_web: "正在打开网页",
  page_elements: "正在看页面结构",
  page_act: "正在操作网页",
  look_page: "正在看页面截图",
  read_image: "正在看图",
  read_mail_thread: "正在读邮件",
  search_mail: "正在翻邮件",
  delegate_task: "正在派活给后台",
  watch_page: "正在设置网页监控",
  create_goal: "正在定目标",
  remember_fact: "正在记下这条",
  agent_status: "正在看自己的状态",
  present_choices: "正在整理选项",
};

export function agentActionLabel(tool: string) {
  return AGENT_ACTIONS[tool] ?? `正在使用 ${tool}`;
}

/**
 * 智能体相位（对标 Muse `HatchPillState` 的 13 态，取我们用得上的 6 态）。
 * 关键是把「模型在想（THINKING）」「正在出字（TYPING）」从工具状态里拆出来——
 * 思考那 5～60 秒界面完全沉默，是"它看起来死了"的最大来源。
 */
export type AgentPhase =
  | "USING_TOOL"
  | "TYPING"
  | "THINKING"
  | "WAITING_FOR_SUBAGENTS"
  | "NEEDS_APPROVAL"
  | "IDLE";

export interface AgentPhaseInput {
  /** 有在飞的工具调用 */
  inFlightTool: boolean;
  /** 本轮已经开始出字（最后一条助手消息有正文） */
  startedTyping: boolean;
  /** 有一轮对话在跑（还没调工具、也还没出字） */
  runActive: boolean;
  /** 本轮没在跑，但有后台任务在动 */
  backgroundTasks: boolean;
  /** 有等你确认的操作 */
  pendingApprovals: boolean;
}

/**
 * 相位推导（纯函数）。优先级照 Muse 的读法：
 * 在用工具 > 正在出字 > 思考 > 等后台任务 > 等审批 > 空闲。
 */
export function agentPhase(input: AgentPhaseInput): AgentPhase {
  if (input.inFlightTool) return "USING_TOOL";
  if (input.startedTyping) return "TYPING";
  if (input.runActive) return "THINKING";
  if (input.backgroundTasks) return "WAITING_FOR_SUBAGENTS";
  if (input.pendingApprovals) return "NEEDS_APPROVAL";
  return "IDLE";
}

const PHASE_LABELS: Record<AgentPhase, string> = {
  USING_TOOL: "正在动手",
  TYPING: "正在回复",
  THINKING: "思考中…",
  WAITING_FOR_SUBAGENTS: "后台任务在跑",
  NEEDS_APPROVAL: "等你确认",
  IDLE: "需要我就叫我",
};

/** 相位 → 一句话（WAITING_FOR_SUBAGENTS 带上数量更有心跳感）。 */
export function agentPhaseLabel(phase: AgentPhase, subagentCount = 0): string {
  if (phase === "WAITING_FOR_SUBAGENTS" && subagentCount > 0)
    return `${subagentCount} 个任务在跑`;
  return PHASE_LABELS[phase];
}

/** 工具 → emoji（对标 Muse 的 `activityEmoji`）：余光扫一眼就知道在干哪类活。 */
const ACTION_EMOJI: Record<string, string> = {
  search_web: "🔍",
  read_pages: "📄",
  browse_web: "🌐",
  page_elements: "🧩",
  page_act: "👆",
  look_page: "📸",
  read_image: "🖼️",
  read_mail_thread: "📬",
  search_mail: "📧",
  delegate_task: "📤",
  watch_page: "👀",
  create_goal: "🎯",
  remember_fact: "🧠",
  agent_status: "📊",
  present_choices: "🤔",
  save_document: "📝",
  import_pdf: "📥",
  inspect_pdf: "🔍",
  fill_pdf: "🖊️",
  save_artifact: "📦",
  prepare_email: "✉️",
  prepare_event: "📅",
  ask_user: "❓",
  finish_task: "🏁",
  set_plan: "🗂️",
  read_workspace: "🗂️",
  workspace_read_file: "📄",
  workspace_write_file: "✏️",
  workspace_edit_file: "✂️",
  workspace_list_files: "📂",
  git_commit: "🔨",
  git_push: "🚀",
  computer_status: "💻",
  write_computer_file: "💾",
  read_computer_file: "📖",
  list_computer_files: "📂",
  run_computer_command: "⌨️",
};

export function actionEmoji(tool: string): string {
  return ACTION_EMOJI[tool] ?? "🛠️";
}

/** 从工具参数里挑最能说明"在干什么"的那个值（查询词/网址/动作），压平并截断。 */
export function actionDetail(args: unknown, limit = 60) {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  for (const key of ["query", "url", "urls", "action", "message", "title", "text", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.replace(/\s+/g, " ").trim();
      return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
    }
    if (Array.isArray(value) && value.length) return `${value.length} 个地址`;
  }
  return "";
}

/** 相对时间："刚刚 / N 秒前 / N 分钟前"，用于实时状态的心跳感。 */
export function relativeTime(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}
