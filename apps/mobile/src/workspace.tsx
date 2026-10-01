import { createContext, useContext } from "react";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  CalendarEvent,
  EmailDraft,
  EventDraft,
  Mail,
  Section,
  Workspace,
} from "../../../packages/domain/src";
import type { MuseApi } from "./api";
import type { HeroCard } from "./motion";
export type Detail =
  | { type: "mail"; mail: Mail; hero?: HeroCard }
  | { type: "email"; draft?: Partial<EmailDraft> & { id?: string } }
  | { type: "event"; event?: CalendarEvent; draft?: EventDraft; neighbors?: CalendarEvent[] }
  | { type: "file"; file: Artifact; hero?: HeroCard }
  | { type: "browser"; browser: BrowserSession; hero?: HeroCard }
  | { type: "review"; action: ActionProposal; hero?: HeroCard }
  | { type: "task"; taskId: string; hero?: HeroCard }
  | { type: "delegate" }
  | { type: "notifications" }
  | { type: "computer" }
  | { type: "credentials" }
  | { type: "menu" };
export interface WorkspaceContextValue {
  workspace: Workspace;
  api: MuseApi;
  section: Section;
  navigate: (section: Section) => void;
  refresh: () => Promise<void>;
  open: (detail: Detail) => void;
  close: () => void;
  notify: (message: string) => void;
  ask: (prompt: string) => void;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("工作区不可用");
  return context;
}
