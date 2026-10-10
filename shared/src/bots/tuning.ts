/** Bot behaviour knobs (tunable from the sim: --set BOTS.returnStart=420). Seconds unless noted. */
export const BOTS = {
  /** Least greedy bots start heading home at this time… */
  returnStart: 390,
  /** …and the greediest this much later. */
  returnSpan: 300,
  /** Max seconds a bot waits for others at the open exit. */
  exitWaitMax: 75,
  /** Chance per combat decision of a random-but-legal action. */
  blunder: 0.25,
  /** Bots answer a bell tolled at most this far away (route cost, ~6 per tunnel), and keep heading there this long. */
  tollAnswerCost: 30,
  tollAnswerFor: 40,
  /** Bots use a Bandage, Tonic or Torch once HP, sanity (stress) or light is this fraction depleted. */
  consumeAt: 1 / 3,
  /** …and a Firebomb in a fight against more than this many enemies. */
  firebombAbove: 2,
};
