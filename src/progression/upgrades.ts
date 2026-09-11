import type {
  CardProgress,
  PlayerAttributeKey,
  PlayerCard,
  ProgressionState,
  UpgradeAttribute,
  UpgradeConfirmation,
  UpgradeQuote,
  UpgradeQuoteOptions,
  UpgradeResult
} from "./types";
import {
  CARD_XP_PER_LEVEL,
  cloneProgressionState,
  createEmptyCardProgress,
  levelForXp,
  MAX_CARD_LEVEL,
  MAX_CARD_UPGRADES,
  PLAYER_ATTRIBUTE_KEYS,
  normalizeCardProgress,
  zeroAttributeBoosts
} from "./state";

export { CARD_XP_PER_LEVEL, MAX_CARD_LEVEL, MAX_CARD_UPGRADES, PLAYER_ATTRIBUTE_KEYS };

export const UPGRADE_BASE_COST = 120;
export const UPGRADE_COST_STEP = 80;
export const ATTRIBUTE_BOOST_PER_UPGRADE = 1;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const positiveInteger = (value: unknown, fallback: number): number =>
  Math.max(0, Math.floor(isFiniteNumber(value) ? value : fallback));

const clampAttribute = (value: number): number => Math.max(0, Math.min(100, value));

const isPlayerAttributeKey = (value: unknown): value is PlayerAttributeKey =>
  typeof value === "string" && (PLAYER_ATTRIBUTE_KEYS as readonly string[]).includes(value);

const normalizeAttribute = (value: unknown): UpgradeAttribute =>
  value === "all" || isPlayerAttributeKey(value) ? value : "all";

/** The next upgrade costs more, keeping the local economy predictable. */
export function getUpgradeCost(upgrades: number): number {
  const safeUpgrades = isFiniteNumber(upgrades) ? Math.max(0, Math.floor(upgrades)) : 0;
  return UPGRADE_BASE_COST + safeUpgrades * UPGRADE_COST_STEP;
}

export const upgradeCost = getUpgradeCost;
export const calculateUpgradeCost = getUpgradeCost;

export const getXpForLevel = (level: number): number => {
  const safeLevel = isFiniteNumber(level) ? Math.floor(level) : 1;
  return Math.max(0, Math.min(MAX_CARD_LEVEL, safeLevel) - 1) * CARD_XP_PER_LEVEL;
};

export const getXpToNextLevel = (xp: number): number => {
  const safeXp = Math.max(0, Math.floor(isFiniteNumber(xp) ? xp : 0));
  if (levelForXp(safeXp) >= MAX_CARD_LEVEL) return 0;
  const remainder = safeXp % CARD_XP_PER_LEVEL;
  return remainder === 0 ? CARD_XP_PER_LEVEL : CARD_XP_PER_LEVEL - remainder;
};

const cloneProgress = (progress: CardProgress): CardProgress => {
  const normalized = normalizeCardProgress(progress);
  return {
    ...normalized,
    attributeBoosts: { ...normalized.attributeBoosts }
  };
};

const boostsFor = (attribute: UpgradeAttribute, boost: number): CardProgress["attributeBoosts"] => {
  const boosts = zeroAttributeBoosts();
  if (attribute === "all") {
    for (const key of PLAYER_ATTRIBUTE_KEYS) boosts[key] = boost;
  } else {
    boosts[attribute] = boost;
  }
  return boosts;
};

/**
 * Build the quote shown by UI before spending coins. The token is stable for
 * a given card/progress/options tuple and lets a caller reject stale quotes.
 */
export function createUpgradeQuote(
  cardId: string,
  progress: CardProgress,
  options: UpgradeQuoteOptions = {},
  card?: PlayerCard
): UpgradeQuote {
  const current = cloneProgress(progress);
  const attribute = normalizeAttribute(options.attribute);
  const boost = ATTRIBUTE_BOOST_PER_UPGRADE;
  const boosts = boostsFor(attribute, boost);
  const cost = getUpgradeCost(current.upgrades);
  const token = `upgrade:${cardId}:${current.upgrades}:${attribute}:${cost}`;
  void card; // The cost is intentionally independent of mutable card metadata.
  return {
    cardId,
    attribute,
    boost,
    boosts,
    cost,
    currentLevel: current.level,
    currentUpgrades: current.upgrades,
    nextLevel: current.level,
    confirmationToken: token,
    requiresConfirmation: true
  };
}

export const quoteCardUpgrade = createUpgradeQuote;
export const getUpgradeQuote = createUpgradeQuote;

/** Apply additive upgrades without mutating the catalog card or its arrays. */
export function applyCardProgress(card: PlayerCard, progress?: CardProgress): PlayerCard {
  const source = progress ? normalizeCardProgress(progress) : createEmptyCardProgress();
  const attributes = { ...card.attributes };
  for (const key of PLAYER_ATTRIBUTE_KEYS) {
    const base = isFiniteNumber(attributes[key]) ? attributes[key] : 0;
    const boost = isFiniteNumber(source.attributeBoosts[key]) ? source.attributeBoosts[key] : 0;
    attributes[key] = clampAttribute(base + boost);
  }
  return {
    ...card,
    positions: [...card.positions],
    attributes
  };
}

export const applyUpgradesToCard = applyCardProgress;
export const applyPlayerUpgrades = applyCardProgress;

/** Convenience adapter for SquadSystem's card catalog + progression snapshot. */
export function applyProgressionToCard(card: PlayerCard, state: ProgressionState): PlayerCard {
  return applyCardProgress(card, state.cards[card.id]);
}

export function applyProgressionToCards(
  cards: readonly PlayerCard[],
  state: ProgressionState
): PlayerCard[] {
  return cards.map((card) => applyProgressionToCard(card, state));
}

export const applyUpgradesToCards = applyProgressionToCards;

export function addCardXpToState(
  state: ProgressionState,
  cardId: string,
  amount: number
): ProgressionState {
  if (typeof cardId !== "string" || cardId.trim().length === 0) return cloneProgressionState(state);
  const safeAmount = positiveInteger(amount, 0);
  if (safeAmount === 0) return cloneProgressionState(state);
  const next = cloneProgressionState(state);
  const current = normalizeCardProgress(next.cards[cardId]);
  current.xp += safeAmount;
  current.level = levelForXp(current.xp);
  next.cards[cardId] = current;
  return next;
}

export const awardCardXp = addCardXpToState;

const confirmationDetails = (
  confirmation: UpgradeConfirmation | undefined
): { confirmed: boolean; token?: string; expectedCost?: number } => {
  if (!confirmation || typeof confirmation !== "object") return { confirmed: false };
  return {
    confirmed: confirmation.confirmed === true,
    token: typeof confirmation.confirmationToken === "string" ? confirmation.confirmationToken : undefined,
    expectedCost: isFiniteNumber(confirmation.expectedCost) ? confirmation.expectedCost : undefined
  };
};

/**
 * Pure, transactional card purchase. It never partially deducts coins: all
 * validation happens before returning an applied state.
 */
export function purchaseCardUpgrade(
  state: ProgressionState,
  cardId: string,
  confirmation: UpgradeConfirmation,
  options: UpgradeQuoteOptions = {},
  card?: PlayerCard
): UpgradeResult {
  const next = cloneProgressionState(state);
  const current = next.cards[cardId] ? normalizeCardProgress(next.cards[cardId]) : createEmptyCardProgress();
  const quote = createUpgradeQuote(cardId, current, options, card);
  const details = confirmationDetails(confirmation);
  const baseResult = (status: UpgradeResult["status"], resultState = next): UpgradeResult => ({
    status,
    applied: status === "applied",
    ...(status !== "applied" ? { reason: status } : {}),
    cardId,
    cost: quote.cost,
    quote,
    progress: cloneProgress(current),
    ...(card ? { card: applyCardProgress(card, current) } : {}),
    state: resultState
  });

  if (typeof cardId !== "string" || cardId.trim().length === 0) {
    return baseResult("unknown-card");
  }
  if (!next.cards[cardId]) {
    // A card may legitimately have no progression record yet. The caller's
    // catalog card is the authority for existence when supplied.
    if (!card) return baseResult("unknown-card");
  }
  if (current.upgrades >= MAX_CARD_UPGRADES) return baseResult("max-upgrades");
  if (!details.confirmed) return baseResult("confirmation-required");
  if (details.token !== undefined && details.token !== quote.confirmationToken) {
    return baseResult("stale-quote");
  }
  if (details.expectedCost !== undefined && details.expectedCost !== quote.cost) {
    return baseResult("stale-quote");
  }
  if (next.coins < quote.cost) return baseResult("insufficient-funds");

  const updated = cloneProgress(current);
  updated.upgrades += 1;
  for (const key of PLAYER_ATTRIBUTE_KEYS) {
    updated.attributeBoosts[key] += quote.boosts[key];
  }
  updated.level = levelForXp(updated.xp);
  next.cards[cardId] = updated;
  next.coins -= quote.cost;
  return {
    ...baseResult("applied", next),
    progress: cloneProgress(updated),
    ...(card ? { card: applyCardProgress(card, updated) } : {})
  };
}

export const confirmCardUpgrade = purchaseCardUpgrade;
export const applyCardUpgrade = purchaseCardUpgrade;
