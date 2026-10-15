import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_ART, ART_TINTS } from '../content/abilities';
import { LEGENDS } from '../content/legends';
import { MARK_ROWS, MOTIF_ROWS } from '../../../client/src/render/card-art-data';
import { SPRITES } from '../../../client/src/render/sprite-data';

describe('ability art', () => {
  it('every ability, the Toll and every Legendary has its own picture, drawn from parts that exist', () => {
    const ids = [...Object.values(ABILITIES).flat().map((a) => a.id), 'toll', ...Object.keys(LEGENDS)];
    const seen = new Map<string, string>();
    for (const id of ids) {
      const art = ABILITY_ART[id];
      expect(art, id).toBeDefined();
      expect(MOTIF_ROWS[art.motif] ?? SPRITES[art.motif], `${id}: ${art.motif}`).toBeDefined();
      if (art.mark) expect(MARK_ROWS[art.mark], `${id}: ${art.mark}`).toBeDefined();
      expect(ART_TINTS[art.tint], `${id}: ${art.tint}`).toBeDefined();
      const key = `${art.motif}/${art.mark ?? ''}`;
      expect(seen.get(key), `${id} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
    expect(Object.keys(ABILITY_ART).sort()).toEqual([...ids].sort());
  });
});
