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
