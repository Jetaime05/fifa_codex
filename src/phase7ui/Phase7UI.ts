import "./Phase7UI.css";

export type Phase7SeasonStatus = "idle" | "active" | "completed";

export type Phase7SeasonView = {
  modeId: string;
  status: Phase7SeasonStatus;
  currentMatchId: string | null;
  fixtureLabel: string;
  played: number;
  total: number;
  placement: number | null;
  champion: boolean;
  rewardEligible: boolean;
};

export type Phase7RewardView = {
  rewardId: string;
  coins: number;
  xp: number;
  label: string;
};

export type Phase7UpgradeAttribute = {
  current: number;
  next: number;
};

export type Phase7UpgradeChoice = {
  cardId: string;
  cardName: string;
  currentOverall: number;
  nextOverall: number;
  cost: number;
  canAfford: boolean;
  attributes: Record<string, Phase7UpgradeAttribute>;
};

export type Phase7MissionView = {
  missionId: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
  reward: { coins: number; xp: number };
};

export type Phase7ViewModel = {
  coins: number;
  xp: number;
  level: number | null;
  teamOverall: number | null;
  season: Phase7SeasonView;
  lastReward: Phase7RewardView | null;
  upgrades: Phase7UpgradeChoice[];
  missions: Phase7MissionView[];
};

export type Phase7UIState = {
  selectedCardId: string | null;
};

export type Phase7UIAction =
  | { type: "select-upgrade"; cardId: string }
  | { type: "clear-selection" };

export type Phase7UICallbacks = {
  onClose?: () => void;
  onQuickMatch?: () => void;
  onSeasonStart?: (modeId: string) => void;
  onSeasonContinue?: (modeId: string, matchId: string | null) => void;
  onUpgradeSelect?: (cardId: string) => void;
  onUpgradeConfirm?: (cardId: string) => void;
  onMissionClaim?: (missionId: string) => void;
};

export type Phase7ViewSource = Phase7ViewModel | (() => Phase7ViewModel | unknown);

export type Phase7UIOptions = Phase7UICallbacks & {
  root: HTMLElement;
  viewModel?: Phase7ViewSource;
  getViewModel?: () => Phase7ViewModel | unknown;
  callbacks?: Phase7UICallbacks;
};

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(asNumber(value, fallback), min, max));
}

function first(record: AnyRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asArray(record: AnyRecord, keys: string[]): unknown[] {
  const value = first(record, keys);
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function normalizeReward(raw: unknown, fallbackLabel = "Match reward"): Phase7RewardView | null {
  if (!isRecord(raw)) return null;
  const rewardId = asString(first(raw, ["rewardId", "transactionId", "id"]), "", 160);
  const coins = integer(first(raw, ["coins", "coinReward"]), 0, 0, 999999);
  const xp = integer(first(raw, ["xp", "experience", "xpReward"]), 0, 0, 999999);
  if (!rewardId && coins === 0 && xp === 0) return null;
  return { rewardId: rewardId || `reward-${coins}-${xp}`, coins, xp, label: asString(first(raw, ["label", "reason", "title"]), fallbackLabel, 80) };
}

function normalizeSeason(raw: unknown): Phase7SeasonView {
  const source = asRecord(raw);
  const modeId = asString(first(source, ["modeId", "id"]), "season", 64);
  const statusValue = asString(source.status, "idle") as Phase7SeasonStatus;
  const status: Phase7SeasonStatus = statusValue === "active" || statusValue === "completed" ? statusValue : "idle";
  const fixtures = asArray(source, ["fixtures", "schedule"]);
  const results = asRecord(first(source, ["results", "matchResults"]));
  const played = integer(first(source, ["played", "matchesPlayed"]), fixtures.filter((fixture) => {
    const item = asRecord(fixture);
    const id = asString(first(item, ["matchId", "id"]), "");
    return Boolean(item.played) || Boolean(id && results[id]);
  }).length, 0, 999);
  const total = integer(first(source, ["total", "fixtureCount", "matchesTotal"]), fixtures.length, 0, 999);
  const currentRaw = first(source, ["currentFixture", "fixture"]);
  const current = asRecord(currentRaw);
  const currentMatchId = asString(first(source, ["currentMatchId", "nextMatchId"]) ?? first(current, ["matchId", "id"]), "", 160) || null;
  const fixtureLabel = asString(first(source, ["fixtureLabel", "nextFixtureLabel"]), currentMatchId ? `${asString(first(current, ["homeTeamName", "homeName"]), "Home")} vs ${asString(first(current, ["awayTeamName", "awayName"]), "Away")}` : "No fixture scheduled", 160);
  const completion = asRecord(source.completion);
  const placementRaw = first(source, ["placement", "rank"]) ?? completion.placement;
  return {
    modeId,
    status,
    currentMatchId,
    fixtureLabel,
    played: Math.min(played, total || played),
    total,
    placement: placementRaw === undefined ? null : integer(placementRaw, 0, 1, 999),
    champion: Boolean(first(source, ["champion"]) ?? completion.champion),
    rewardEligible: Boolean(first(source, ["rewardEligible"]) ?? completion.rewardEligible),
  };
}

function normalizeUpgrade(raw: unknown, index: number, coins: number): Phase7UpgradeChoice | null {
  if (!isRecord(raw)) return null;
  const cardId = asString(first(raw, ["cardId", "id", "playerId"]), `card-${index + 1}`, 100);
  const cardName = asString(first(raw, ["cardName", "name", "playerName"]), `Player ${index + 1}`, 100);
  const currentOverall = integer(first(raw, ["currentOverall", "currentOvr", "rating", "overall"]), 70, 1, 99);
  const nextOverall = integer(first(raw, ["nextOverall", "nextOvr", "previewOverall"]), Math.min(99, currentOverall + 3), currentOverall, 99);
  const cost = integer(first(raw, ["cost", "upgradeCost"]), 0, 0, 999999);
  const attributesSource = asRecord(first(raw, ["attributes", "stats"]));
  const attributes: Record<string, Phase7UpgradeAttribute> = {};
  Object.entries(attributesSource).forEach(([key, value]) => {
    if (isRecord(value)) {
      const current = integer(first(value, ["current", "value", "before"]), 0, 0, 99);
      const next = integer(first(value, ["next", "after", "preview"]), current, current, 99);
      attributes[key] = { current, next };
    } else {
      const current = integer(value, 0, 0, 99);
      attributes[key] = { current, next: current };
    }
  });
  return { cardId, cardName, currentOverall, nextOverall, cost, canAfford: Boolean(raw.canAfford ?? coins >= cost), attributes };
}

function normalizeMission(raw: unknown, index: number): Phase7MissionView | null {
  if (!isRecord(raw)) return null;
  const missionId = asString(first(raw, ["missionId", "id", "key"]), `mission-${index + 1}`, 100);
  const target = integer(first(raw, ["target", "goal", "required"]), 1, 1, 999999);
  const progress = integer(first(raw, ["progress", "current", "value"]), 0, 0, target);
  const completed = Boolean(raw.completed) || progress >= target;
  const claimed = Boolean(raw.claimed);
  const rewardSource = asRecord(first(raw, ["reward", "rewards"]));
  return {
    missionId,
    title: asString(first(raw, ["title", "name"]), `Mission ${index + 1}`, 120),
    description: asString(first(raw, ["description", "copy"]), "Complete this objective in your next matches.", 200),
    progress,
    target,
    completed,
    claimed,
    claimable: Boolean(raw.claimable ?? (completed && !claimed)),
    reward: {
      coins: integer(first(rewardSource, ["coins", "coinReward"]) ?? first(raw, ["coins", "coinReward"]), 0, 0, 999999),
      xp: integer(first(rewardSource, ["xp", "xpReward"]) ?? first(raw, ["xp", "xpReward"]), 0, 0, 999999),
    },
  };
}

/** Normalize a root-owned progression/missions snapshot into the UI contract. */
export function normalizePhase7ViewModel(rawValue: unknown): Phase7ViewModel {
  const raw = asRecord(rawValue);
  const overview = asRecord(raw.overview);
  const coins = integer(first(raw, ["coins", "currency"]) ?? first(overview, ["coins", "currency"]), 0, 0, 999999999);
  const xp = integer(first(raw, ["xp", "experience"]) ?? first(overview, ["xp", "experience"]), 0, 0, 999999999);
  const levelRaw = first(raw, ["level", "playerLevel"]) ?? first(overview, ["level", "playerLevel"]);
  const upgrades: Phase7UpgradeChoice[] = [];
  const upgradeIds = new Set<string>();
  asArray(raw, ["upgrades", "upgradeChoices", "cards"]).forEach((item, index) => {
    const upgrade = normalizeUpgrade(item, index, coins);
    if (upgrade && !upgradeIds.has(upgrade.cardId)) {
      upgradeIds.add(upgrade.cardId);
      upgrades.push(upgrade);
    }
  });
  const missions: Phase7MissionView[] = [];
  const missionIds = new Set<string>();
  asArray(raw, ["missions", "missionProgress", "objectives"]).forEach((item, index) => {
    const mission = normalizeMission(item, index);
    if (mission && !missionIds.has(mission.missionId)) {
      missionIds.add(mission.missionId);
      missions.push(mission);
    }
  });
  const reward = normalizeReward(first(raw, ["lastReward", "reward", "recentReward"]));
  const teamOverallRaw = first(raw, ["teamOverall", "teamOvr", "overall"]) ?? first(overview, ["teamOverall", "teamOvr", "overall"]);
  return {
    coins,
    xp,
    level: levelRaw === undefined ? null : integer(levelRaw, 1, 1, 999),
    teamOverall: teamOverallRaw === undefined ? null : integer(teamOverallRaw, 0, 0, 99),
    season: normalizeSeason(first(raw, ["season", "seasonMode", "mode"])),
    lastReward: reward,
    upgrades,
    missions,
  };
}

export function reducePhase7UIState(state: Phase7UIState, action: Phase7UIAction): Phase7UIState {
  if (action.type === "clear-selection") return { selectedCardId: null };
  return { selectedCardId: state.selectedCardId === action.cardId ? null : action.cardId };
}

export function missionProgressPercent(mission: Pick<Phase7MissionView, "progress" | "target">): number {
  return mission.target > 0 ? Math.round(clamp((mission.progress / mission.target) * 100, 0, 100)) : 0;
}

export function seasonProgressPercent(season: Pick<Phase7SeasonView, "played" | "total">): number {
  return season.total > 0 ? Math.round(clamp((season.played / season.total) * 100, 0, 100)) : 0;
}

export function seasonAction(season: Pick<Phase7SeasonView, "status">): "start" | "continue" | "new" {
  return season.status === "active" ? "continue" : season.status === "completed" ? "new" : "start";
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tag: K,
  className?: string,
  label?: string,
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (label !== undefined) element.textContent = label;
  return element;
}

function button(documentRef: Document, className: string, label: string): HTMLButtonElement {
  const element = createElement(documentRef, "button", className, label);
  element.type = "button";
  return element;
}

function setData(element: HTMLElement, key: string, value: string): void {
  element.dataset[key] = value;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function callbackSet(options: Phase7UIOptions): Phase7UICallbacks {
  return { ...options.callbacks, ...options };
}

function emptyViewModel(): Phase7ViewModel {
  return normalizePhase7ViewModel({});
}

/**
 * Dependency-injected progression dashboard.  It can render now with an
 * adapter-owned view model and callbacks, while the root remains free to wire
 * concrete progression, missions and season stores in a later integration.
 */
export class Phase7UI {
  private readonly root: HTMLElement;
  private readonly source?: Phase7ViewSource;
  private readonly getViewModel?: () => Phase7ViewModel | unknown;
  private readonly callbacks: Phase7UICallbacks;
  private overlay: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private liveRegion: HTMLElement | null = null;
  private previousActiveElement: HTMLElement | null = null;
  private isOpen = false;
  private isDestroyed = false;
  private closeNotified = false;
  private model: Phase7ViewModel = emptyViewModel();
  private uiState: Phase7UIState = { selectedCardId: null };
  private statusMessage = "Club dashboard ready";

  constructor(options: Phase7UIOptions) {
    this.root = options.root;
    this.source = options.viewModel;
    this.getViewModel = options.getViewModel;
    this.callbacks = callbackSet(options);
    this.root.setAttribute("data-phase7-ui-host", "true");
    this.buildShell();
    this.render();
  }

  open(): void {
    if (this.isDestroyed || !this.overlay) return;
    this.previousActiveElement = this.root.ownerDocument.activeElement instanceof HTMLElement ? this.root.ownerDocument.activeElement : null;
    this.closeNotified = false;
    this.isOpen = true;
    this.overlay.classList.add("is-open");
    this.overlay.setAttribute("aria-hidden", "false");
    this.overlay.removeAttribute("inert");
    this.render();
    this.overlay.querySelector<HTMLElement>("[data-phase7-close]")?.focus({ preventScroll: true });
  }

  close(notify = false): void {
    if (this.isDestroyed || !this.overlay || !this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove("is-open");
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.setAttribute("inert", "");
    if (notify && !this.closeNotified) {
      this.closeNotified = true;
      this.callbacks.onClose?.();
    }
    this.previousActiveElement?.focus?.({ preventScroll: true });
    this.previousActiveElement = null;
  }

  render(): void {
    if (this.isDestroyed || !this.content) return;
    const sourceValue = this.getViewModel ? this.getViewModel() : typeof this.source === "function" ? this.source() : this.source;
    this.model = normalizePhase7ViewModel(sourceValue);
    if (this.uiState.selectedCardId && !this.model.upgrades.some((choice) => choice.cardId === this.uiState.selectedCardId)) {
      this.uiState = reducePhase7UIState(this.uiState, { type: "clear-selection" });
    }
    this.content.replaceChildren(this.renderDashboard());
    if (this.liveRegion) this.liveRegion.textContent = this.statusMessage;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.overlay?.remove();
    this.overlay = null;
    this.content = null;
    this.liveRegion = null;
    this.root.removeAttribute("data-phase7-ui-host");
  }

  debugSnapshot(): {
    isOpen: boolean;
    selectedCardId: string | null;
    coins: number;
    xp: number;
    season: Phase7SeasonView;
    missionCount: number;
  } {
    return {
      isOpen: this.isOpen,
      selectedCardId: this.uiState.selectedCardId,
      coins: this.model.coins,
      xp: this.model.xp,
      season: { ...this.model.season },
      missionCount: this.model.missions.length,
    };
  }

  private buildShell(): void {
    const documentRef = this.root.ownerDocument;
    const overlay = createElement(documentRef, "div", "phase7-ui-overlay");
    setData(overlay, "phase7Ui", "true");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Progression dashboard");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("inert", "");
    const shell = createElement(documentRef, "div", "phase7-ui-shell");
    const header = createElement(documentRef, "header", "phase7-ui-header");
    const masthead = createElement(documentRef, "div", "phase7-ui-masthead");
    masthead.append(
      createElement(documentRef, "div", "phase7-ui-mark", "P11"),
      createElement(documentRef, "div", "phase7-ui-title-group"),
    );
    const titleGroup = masthead.lastElementChild as HTMLElement;
    titleGroup.append(createElement(documentRef, "p", "phase7-ui-eyebrow", "CLUB OPERATIONS"), createElement(documentRef, "h1", "phase7-ui-title", "Progression hub"));
    const close = button(documentRef, "phase7-ui-button phase7-ui-button-quiet", "Close");
    setData(close, "phase7Close", "true");
    close.setAttribute("aria-label", "Close progression dashboard");
    const actions = createElement(documentRef, "div", "phase7-ui-header-actions");
    actions.append(close);
    header.append(masthead, actions);
    const content = createElement(documentRef, "main", "phase7-ui-main");
    const live = createElement(documentRef, "div", "phase7-ui-live", this.statusMessage);
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    const footer = createElement(documentRef, "footer", "phase7-ui-footer", "Offline progression · saved by the connected store");
    shell.append(header, content, live, footer);
    overlay.append(shell);
    this.root.append(overlay);
    this.overlay = overlay;
    this.content = content;
    this.liveRegion = live;
    overlay.addEventListener("click", this.handleClick);
    overlay.addEventListener("keydown", this.handleKeyDown);
    overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  private renderDashboard(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const fragment = createElement(documentRef, "div", "phase7-ui-dashboard");
    fragment.append(this.renderOverview(), this.renderModes(), this.renderReward(), this.renderUpgrades(), this.renderMissions());
    return fragment;
  }

  private renderOverview(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const section = createElement(documentRef, "section", "phase7-ui-overview");
    section.setAttribute("aria-label", "Club overview");
    section.append(
      this.metric("COINS", formatNumber(this.model.coins), "currency"),
      this.metric("XP", formatNumber(this.model.xp), "xp"),
      this.metric("TEAM OVR", this.model.teamOverall === null ? "—" : String(this.model.teamOverall), "overall"),
      this.metric("SEASON", `${this.model.season.played}/${this.model.season.total || "—"}`, "season"),
    );
    return section;
  }

  private metric(label: string, value: string, key: string): HTMLElement {
    const item = createElement(this.root.ownerDocument, "div", "phase7-ui-metric");
    setData(item, "metric", key);
    item.append(createElement(this.root.ownerDocument, "span", "phase7-ui-metric-label", label), createElement(this.root.ownerDocument, "strong", "phase7-ui-metric-value", value));
    return item;
  }

  private renderModes(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const section = createElement(documentRef, "section", "phase7-ui-section phase7-ui-modes");
    section.append(createElement(documentRef, "p", "phase7-ui-kicker", "PLAY MODES"), createElement(documentRef, "h2", "phase7-ui-section-title", "Choose your next match"), createElement(documentRef, "p", "phase7-ui-section-copy", "Quick Match is always ready. Season carries your results from fixture to fixture."));
    const grid = createElement(documentRef, "div", "phase7-ui-mode-grid");
    const quick = createElement(documentRef, "article", "phase7-ui-mode-card");
    quick.append(createElement(documentRef, "span", "phase7-ui-mode-index", "01"), createElement(documentRef, "h3", "phase7-ui-mode-title", "Quick Match"), createElement(documentRef, "p", "phase7-ui-mode-copy", "Play a single offline match and earn match rewards."));
    const quickButton = button(documentRef, "phase7-ui-button phase7-ui-button-primary", "Play Quick Match");
    setData(quickButton, "phase7Action", "quick-match");
    quick.append(quickButton);
    const season = createElement(documentRef, "article", "phase7-ui-mode-card phase7-ui-mode-card-season");
    const action = seasonAction(this.model.season);
    const statusLabel = this.model.season.status === "active" ? "IN PROGRESS" : this.model.season.status === "completed" ? "SEASON COMPLETE" : "READY TO START";
    season.append(createElement(documentRef, "span", "phase7-ui-mode-index", "02"), createElement(documentRef, "div", "phase7-ui-mode-heading"));
    const seasonHeading = season.querySelector<HTMLElement>(".phase7-ui-mode-heading")!;
    seasonHeading.append(createElement(documentRef, "h3", "phase7-ui-mode-title", "Season"), createElement(documentRef, "span", "phase7-ui-status-pill", statusLabel));
    season.append(createElement(documentRef, "p", "phase7-ui-mode-copy", this.model.season.status === "completed" ? `Finished ${this.model.season.champion ? "as champion" : `in ${this.model.season.placement ?? "—"} place`}. Claim the finale reward, then start again.` : this.model.season.status === "active" ? `${this.model.season.fixtureLabel} · ${this.model.season.played}/${this.model.season.total} fixtures played.` : "A short deterministic league against eight fictional clubs."));
    const progress = createElement(documentRef, "div", "phase7-ui-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Season progress");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(seasonProgressPercent(this.model.season)));
    const fill = createElement(documentRef, "span", "phase7-ui-progress-fill");
    fill.style.width = `${seasonProgressPercent(this.model.season)}%`;
    progress.append(fill);
    season.append(progress);
    const seasonButton = button(documentRef, "phase7-ui-button phase7-ui-button-primary", action === "continue" ? "Continue Season" : action === "new" ? "Start New Season" : "Start Season");
    setData(seasonButton, "phase7Action", action === "continue" ? "season-continue" : "season-start");
    setData(seasonButton, "modeId", this.model.season.modeId);
    if (this.model.season.currentMatchId) setData(seasonButton, "matchId", this.model.season.currentMatchId);
    season.append(seasonButton);
    grid.append(quick, season);
    section.append(grid);
    return section;
  }

  private renderReward(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const section = createElement(documentRef, "section", "phase7-ui-section phase7-ui-reward");
    section.append(createElement(documentRef, "p", "phase7-ui-kicker", "LATEST REWARD"));
    if (!this.model.lastReward) {
      section.append(createElement(documentRef, "h2", "phase7-ui-section-title", "No reward yet"), createElement(documentRef, "p", "phase7-ui-section-copy", "Finish a match to see coins, XP and performance bonuses here."));
      return section;
    }
    const reward = createElement(documentRef, "div", "phase7-ui-reward-body");
    reward.append(createElement(documentRef, "div", "phase7-ui-reward-mark", "+"), createElement(documentRef, "div", "phase7-ui-reward-copy"));
    const copy = reward.lastElementChild as HTMLElement;
    copy.append(createElement(documentRef, "h2", "phase7-ui-section-title", this.model.lastReward.label), createElement(documentRef, "p", "phase7-ui-section-copy", `Transaction ${this.model.lastReward.rewardId}`));
    const values = createElement(documentRef, "div", "phase7-ui-reward-values");
    values.append(createElement(documentRef, "strong", "phase7-ui-reward-coins", `+${formatNumber(this.model.lastReward.coins)} coins`), createElement(documentRef, "strong", "phase7-ui-reward-xp", `+${formatNumber(this.model.lastReward.xp)} XP`));
    reward.append(values);
    section.append(reward);
    return section;
  }

  private renderUpgrades(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const section = createElement(documentRef, "section", "phase7-ui-section");
    const heading = createElement(documentRef, "div", "phase7-ui-section-heading");
    heading.append(createElement(documentRef, "div"));
    const title = heading.firstElementChild as HTMLElement;
    title.append(createElement(documentRef, "p", "phase7-ui-kicker", "PLAYER UPGRADES"), createElement(documentRef, "h2", "phase7-ui-section-title", "Make the squad stronger"));
    heading.append(createElement(documentRef, "p", "phase7-ui-section-note", `${this.model.upgrades.length} card${this.model.upgrades.length === 1 ? "" : "s"} available`));
    section.append(heading, createElement(documentRef, "p", "phase7-ui-section-copy", "Select a card to review its preview, then confirm the upgrade when you are ready to spend coins."));
    const grid = createElement(documentRef, "div", "phase7-ui-upgrade-grid");
    if (!this.model.upgrades.length) grid.append(createElement(documentRef, "p", "phase7-ui-empty", "No upgrade choices are available yet."));
    this.model.upgrades.forEach((choice) => grid.append(this.renderUpgradeChoice(choice)));
    section.append(grid);
    return section;
  }

  private renderUpgradeChoice(choice: Phase7UpgradeChoice): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const article = createElement(documentRef, "article", "phase7-ui-upgrade-card");
    if (this.uiState.selectedCardId === choice.cardId) article.classList.add("is-selected");
    const select = button(documentRef, "phase7-ui-upgrade-select", "");
    setData(select, "phase7Action", "upgrade-select");
    setData(select, "cardId", choice.cardId);
    select.setAttribute("aria-pressed", String(this.uiState.selectedCardId === choice.cardId));
    select.setAttribute("aria-label", `Review upgrade for ${choice.cardName}`);
    const hero = createElement(documentRef, "span", "phase7-ui-upgrade-hero");
    hero.append(createElement(documentRef, "strong", "phase7-ui-upgrade-rating", String(choice.currentOverall)), createElement(documentRef, "span", "phase7-ui-upgrade-arrow", "→"), createElement(documentRef, "strong", "phase7-ui-upgrade-next", String(choice.nextOverall)));
    const info = createElement(documentRef, "span", "phase7-ui-upgrade-info");
    info.append(createElement(documentRef, "strong", "phase7-ui-upgrade-name", choice.cardName), createElement(documentRef, "span", "phase7-ui-upgrade-cost", `${formatNumber(choice.cost)} coins`));
    select.append(hero, info);
    article.append(select);
    const attributes = Object.entries(choice.attributes);
    if (attributes.length) {
      const list = createElement(documentRef, "div", "phase7-ui-upgrade-attributes");
      attributes.slice(0, 4).forEach(([name, values]) => {
        const row = createElement(documentRef, "span", "phase7-ui-upgrade-attribute");
        row.append(createElement(documentRef, "span", "phase7-ui-upgrade-attribute-name", name), createElement(documentRef, "span", "phase7-ui-upgrade-attribute-value", `${values.current} → ${values.next}`));
        list.append(row);
      });
      article.append(list);
    }
    const confirm = button(documentRef, "phase7-ui-button phase7-ui-button-confirm", choice.canAfford ? "Confirm Upgrade" : "Need more coins");
    setData(confirm, "phase7Action", "upgrade-confirm");
    setData(confirm, "cardId", choice.cardId);
    confirm.disabled = !choice.canAfford;
    confirm.setAttribute("aria-label", choice.canAfford ? `Confirm upgrade for ${choice.cardName}` : `Not enough coins to upgrade ${choice.cardName}`);
    article.append(confirm);
    return article;
  }

  private renderMissions(): HTMLElement {
    const documentRef = this.root.ownerDocument;
    const section = createElement(documentRef, "section", "phase7-ui-section");
    section.append(createElement(documentRef, "p", "phase7-ui-kicker", "MISSIONS"), createElement(documentRef, "h2", "phase7-ui-section-title", "Keep the momentum"), createElement(documentRef, "p", "phase7-ui-section-copy", "Progress is tracked from real match events. Claim each reward once when an objective is complete."));
    const list = createElement(documentRef, "div", "phase7-ui-mission-list");
    if (!this.model.missions.length) list.append(createElement(documentRef, "p", "phase7-ui-empty", "No missions are active."));
    this.model.missions.forEach((mission) => {
      const item = createElement(documentRef, "article", "phase7-ui-mission");
      const heading = createElement(documentRef, "div", "phase7-ui-mission-heading");
      heading.append(createElement(documentRef, "div"));
      const copy = heading.firstElementChild as HTMLElement;
      copy.append(createElement(documentRef, "h3", "phase7-ui-mission-title", mission.title), createElement(documentRef, "p", "phase7-ui-mission-description", mission.description));
      const claim = button(documentRef, "phase7-ui-button phase7-ui-button-quiet phase7-ui-mission-claim", mission.claimable ? "Claim" : mission.claimed ? "Claimed" : "In progress");
      setData(claim, "phase7Action", "mission-claim");
      setData(claim, "missionId", mission.missionId);
      claim.disabled = !mission.claimable;
      claim.setAttribute("aria-label", mission.claimable ? `Claim ${mission.title} reward` : `${mission.title} ${mission.claimed ? "already claimed" : "in progress"}`);
      heading.append(claim);
      const progress = createElement(documentRef, "div", "phase7-ui-mission-progress");
      const fill = createElement(documentRef, "span", "phase7-ui-progress-fill");
      const percentage = missionProgressPercent(mission);
      fill.style.width = `${percentage}%`;
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", `${mission.title} progress`);
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(percentage));
      progress.append(fill);
      item.append(heading, progress, createElement(documentRef, "div", "phase7-ui-mission-meta", `${mission.progress}/${mission.target} · +${formatNumber(mission.reward.coins)} coins · +${formatNumber(mission.reward.xp)} XP`));
      list.append(item);
    });
    section.append(list);
    return section;
  }

  private setStatus(message: string): void {
    this.statusMessage = message;
    if (this.liveRegion) this.liveRegion.textContent = message;
  }

  private handleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-phase7-close]")) {
      this.close(true);
      return;
    }
    const actionElement = target.closest<HTMLElement>("[data-phase7-action]");
    if (!actionElement || actionElement.hasAttribute("disabled")) return;
    const action = actionElement.dataset.phase7Action;
    if (action === "quick-match") {
      this.setStatus("Quick Match selected.");
      this.callbacks.onQuickMatch?.();
    } else if (action === "season-start") {
      const modeId = actionElement.dataset.modeId ?? this.model.season.modeId;
      this.setStatus("Season started.");
      this.callbacks.onSeasonStart?.(modeId);
    } else if (action === "season-continue") {
      const modeId = actionElement.dataset.modeId ?? this.model.season.modeId;
      this.setStatus("Continuing Season.");
      this.callbacks.onSeasonContinue?.(modeId, actionElement.dataset.matchId ?? this.model.season.currentMatchId);
    } else if (action === "upgrade-select") {
      const cardId = actionElement.dataset.cardId;
      if (!cardId) return;
      this.uiState = reducePhase7UIState(this.uiState, { type: "select-upgrade", cardId });
      this.callbacks.onUpgradeSelect?.(cardId);
      this.setStatus(`Upgrade preview selected for ${this.model.upgrades.find((choice) => choice.cardId === cardId)?.cardName ?? "card"}.`);
      this.render();
    } else if (action === "upgrade-confirm") {
      const cardId = actionElement.dataset.cardId;
      if (!cardId) return;
      this.setStatus("Upgrade confirmed.");
      this.callbacks.onUpgradeConfirm?.(cardId);
      this.render();
    } else if (action === "mission-claim") {
      const missionId = actionElement.dataset.missionId;
      if (!missionId) return;
      this.setStatus("Mission reward claimed.");
      this.callbacks.onMissionClaim?.(missionId);
      this.render();
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (!this.overlay || !this.isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(this.overlay.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.root.ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.root.ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
