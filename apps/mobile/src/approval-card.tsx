import { ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  APPROVAL_SCOPES,
  type ApprovalScope,
  approvalSummary,
  type PendingApproval,
  scopeLabel,
} from "./approvals";
import { Button, colors, s } from "./ui";

/**
 * 一条待审批（P1b 服务端）。形制对齐 `activity-card.tsx` 的任务行与 `ActivityScreen` 里
 * 「你的操作」那段：左侧图标框、中间工具名 + 人话理由、下面一排小按钮。
 *
 * 三个允许按钮的顺序**固定**为 一次 → 本会话 → 24 小时（`APPROVAL_SCOPES`），
 * 且档位文案来自 `scopeLabel`，界面不另写一套措辞。
 */
export function ApprovalRow({
  approval,
  busy,
  onDecide,
  onDeny,
}: {
  approval: PendingApproval;
  /** 正在进行的那一档（`deny` 表示正在拒绝）；非空时所有按钮禁用，避免重复提交。 */
  busy: ApprovalScope | "deny" | null;
  onDecide: (scope: ApprovalScope) => void;
  onDeny: () => void;
}) {
  const pending = busy !== null;
  return (
    <View style={[s.row, styles.row]}>
      <View style={[s.iconBox, { backgroundColor: colors.lavender }]}>
        <ShieldCheck size={18} color={colors.text} />
      </View>
      <View style={styles.body}>
        <Text style={s.text}>{approval.tool}</Text>
        <Text style={s.small}>{approvalSummary(approval)}</Text>
        <View style={styles.actions}>
          {APPROVAL_SCOPES.map((scope) => (
            <Button
              key={scope}
              small
              primary
              disabled={pending}
              busy={busy === scope}
              onPress={() => onDecide(scope)}
            >
              {scopeLabel(scope)}
            </Button>
          ))}
          <Button small danger disabled={pending} busy={busy === "deny"} onPress={onDeny}>
            拒绝
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 15, paddingVertical: 17, alignItems: "flex-start" },
  body: { flex: 1, gap: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
});
