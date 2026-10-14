/** Bot behaviour knobs (tunable from the sim: --set BOTS.returnStart=420). Seconds unless noted. */
export const BOTS = {
  /** A Lampbearer bot prays at the Luminous Liturgy for at most this many seconds. */
  liturgyPray: 30,
  /** Twin Locks: a bot holds a wheel this long for someone to take the other, then gives up. */
  locksWait: 20,
  /** Least greedy bots start heading home at this time… */
  returnStart: 390,
  /** …and the greediest this much later. */
  returnSpan: 300,
  /** Max seconds a bot waits for others at the open exit. */
  exitWaitMax: 75,
  /** Once a bot at the exit is ready to leave (E), it waits this long for the others there to be ready too, then goes alone. */
  readyWait: 6,
  /** A bot in a fight it's losing, with nobody to patch it up, tries to flee below this fraction of its HP. */
  fleeAt: 0.35,
  /** In a fight at the exit, a bot escapes (Flee) below this fraction of its HP, or when the fight is being lost. */
  exitFleeAt: 0.5,
  /** Out of a fight, a bot below this fraction of its HP gives up: it heads for the exit and leaves. */
  homeAt: 0.5,
  /** At the exit, a bot below this fraction of its HP stops waiting for the others. */
  exitHurt: 0.6,
  /** Chance per combat decision of a random-but-legal action. */
  blunder: 0.25,
  /** Bots answer a bell tolled at most this far away (route cost, ~6 per tunnel), and keep heading there this long. */
  tollAnswerCost: 30,
  tollAnswerFor: 40,
  /** Bots drop everything for a call for help they hear if they can be there within this many seconds; otherwise they ignore it. */
  callReach: 30,
  /** Bots use a Bandage or Torch once HP or light is this fraction depleted. */
  consumeAt: 1 / 3,
  /** …and a Firebomb in a fight against more than this many enemies. */
  firebombAbove: 2,
};
