"""Card art (M15): pixel motifs for the card pictures, drawn from shapes and small grids, outlined automatically.

    python tools/card_art.py client/src/render/card-art-data.ts [preview.png]

Motifs are 16x16 (a card's main picture), marks 8x8 (the small badge for its second effect). Each is drawn in fill
colours only; every empty pixel touching a filled one becomes the outline. The card -> (motif, mark) table comes from
shared/src/content/cards.ts (CARD_ART, from each card's schools); the client composes the picture (client/src/render/card-art.ts).
"""
import sys, json, re
from PIL import Image, ImageDraw

# The sprite palette plus colours only the card art uses.
PALETTE = {
    'k': '#140f0b',
    's': '#e8c49a', 'S': '#b08458',
    'w': '#d4d8e2', 'W': '#8a92a6',
    'y': '#f2d266', 'Y': '#b08a30',
    't': '#ffb030', 'T': '#ff6a20',
    'r': '#c63a32', 'R': '#6e1c18',
    'g': '#8aa070', 'G': '#4e6440',
    'c': '#e2dac6', 'C': '#9e957e',
    'p': '#a07ad6', 'P': '#5c3c8c',
    'd': '#3c3128', 'D': '#241c16',
    'n': '#7a5a3c', 'N': '#4c3624',
    'e': '#ff4a30',
    'o': '#ffffff',
    'x': '#2a2a30',
    'l': '#9ae05a', 'L': '#3e9a2a',  # venom green
    'a': '#8ad8f0', 'A': '#2a8ab0',  # aqua
    'm': '#f070d0', 'M': '#9a2a8a',  # magenta
    'h': '#ff8a80',                  # rosy highlight
}
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in PALETTE.items()}


class G:
    """A small canvas drawn in palette letters."""

    def __init__(self, n=16):
        self.n = n
        self.im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def c(self, ch):
        return RGB[ch] + (255,)

    def px(self, x, y, ch):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.im.putpixel((x, y), self.c(ch))
        return self

    def line(self, pts, ch, w=1):
        self.d.line(pts, fill=self.c(ch), width=w)
        return self

    def rect(self, x0, y0, x1, y1, ch):
        self.d.rectangle((x0, y0, x1, y1), fill=self.c(ch))
        return self

    def ell(self, x0, y0, x1, y1, ch, outline=None):
        self.d.ellipse((x0, y0, x1, y1), fill=self.c(ch) if ch else None, outline=self.c(outline) if outline else None)
        return self

    def poly(self, pts, ch):
        self.d.polygon(pts, fill=self.c(ch))
        return self

    def grid(self, rows, x0=0, y0=0):
        """Overlay a text grid ('.' leaves what's there)."""
        rows = [r for r in rows.strip('\n').split('\n')]
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != '.':
                    self.px(x0 + x, y0 + y, ch)
        return self

    def rows(self):
        inv = {v: k for k, v in RGB.items()}
        out = []
        for y in range(self.n):
            r = ''
            for x in range(self.n):
                p = self.im.getpixel((x, y))
                r += '.' if p[3] == 0 else inv[p[:3]]
            out.append(r)
        return outline(out)


def outline(rows):
    n = len(rows)
    g = [list(r) for r in rows]
    for y in range(n):
        for x in range(n):
            if rows[y][x] != '.':
                continue
            if any(0 <= x + dx < n and 0 <= y + dy < n and rows[y + dy][x + dx] not in '.k'
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                g[y][x] = 'k'
    return [''.join(r) for r in g]


def grid(rows, n=16):
    return G(n).grid(rows)


# ---------------------------------------------------------------------------
# Motifs (16x16): one per kind of effect. Keep fills inside 1..14 so the outline fits.

M = {}

M['shield'] = (G().poly([(3, 2), (12, 2), (12, 8), (8, 13), (7, 13), (3, 8)], 'W')
               .poly([(4, 3), (11, 3), (11, 8), (8, 11), (7, 11), (4, 8)], 'w')
               .rect(7, 3, 8, 11, 'Y').rect(4, 6, 11, 6, 'Y').px(7, 6, 'y').px(8, 6, 'y'))

M['crack'] = (G().poly([(2, 4), (13, 3), (14, 12), (1, 13)], 'C').poly([(3, 5), (12, 4), (12, 7), (3, 8)], 'c')
              .line([(8, 3), (6, 6), (9, 8), (6, 11), (7, 13)], 'k').line([(9, 8), (12, 10)], 'k').line([(6, 6), (3, 7)], 'k'))

M['spikes'] = (G().poly([(1, 12), (3, 3), (5, 12)], 'W').poly([(5, 12), (8, 1), (11, 12)], 'w').poly([(10, 12), (12, 4), (14, 12)], 'W')
               .line([(8, 2), (8, 11)], 'o').rect(1, 12, 14, 13, 'x'))

M['gate'] = (G().rect(2, 2, 13, 14, 'n').rect(3, 4, 12, 14, 'D').ell(2, 0, 13, 6, 'n').ell(4, 2, 11, 7, 'D')
             .line([(4, 3), (4, 13)], 'W').line([(7, 2), (7, 13)], 'W').line([(10, 3), (10, 13)], 'W')
             .line([(3, 6), (12, 6)], 'W').line([(3, 10), (12, 10)], 'W')
             .px(4, 14, 'w').px(7, 14, 'w').px(10, 14, 'w'))

M['dagger'] = (G().line([(13, 2), (7, 8)], 'w', 2).line([(13, 1), (7, 7)], 'o')
               .line([(4, 7), (8, 11)], 'Y').line([(6, 10), (3, 13)], 'n', 2).px(2, 13, 'Y').px(2, 14, 'Y').px(1, 13, 'Y'))

M['sword'] = (G().line([(14, 1), (6, 9)], 'w', 2).line([(14, 0), (6, 8)], 'o').line([(13, 3), (7, 9)], 'W')
              .line([(2, 7), (8, 13)], 'Y', 2).line([(5, 11), (2, 14)], 'n', 2).px(1, 14, 'Y').px(2, 14, 'Y').px(1, 13, 'Y'))

M['wing'] = grid("""
................
.............o..
............ow..
...........oww..
........ooowwW..
.....ooowwwwwW..
...oowwwwwwwWW..
..owwwwwwwwwWW..
...WWWWWwwwwW...
....owwwwwwwW...
.....WWWWwwwW...
......owwwwW....
.......WWWwW....
........owW.....
................
................
""")

M['hammer'] = (G().line([(4, 13), (10, 7)], 'n', 2).poly([(6, 4), (10, 0), (15, 5), (11, 9)], 'W')
               .poly([(7, 4), (10, 1), (14, 5), (11, 8)], 'w').line([(10, 1), (14, 5)], 'o'))

M['stun'] = grid("""
................
.......y........
......yoy.......
...yyyoooyyy....
....yoooooy.....
.....yoooy......
.....yy.yy......
....y.....y.....
................
..y.........y...
.yoy.......yoy..
..y..........y..
................
.......Y........
......YyY.......
.......Y........
""")
M['hand'] = grid("""
................
................
.....s..s.......
....ss.ss.s.....
....ss.ss.ss....
....ss.ss.ss....
.s..ssssssss....
.ss.ssssssss....
..sssssSssss....
...sssssssss....
....sssssSss....
....ssssssss....
.....ssssss.....
.....SSSSSS.....
.....SSSSSS.....
................
""")

M['smoke'] = (G().ell(0, 7, 7, 13, 'W').ell(5, 3, 13, 11, 'W').ell(8, 8, 15, 14, 'W').ell(3, 9, 11, 15, 'W')
              .ell(6, 4, 11, 8, 'w').ell(1, 8, 5, 11, 'w').ell(9, 9, 13, 12, 'w').ell(4, 10, 8, 13, 'w')
              .px(7, 5, 'o').px(8, 5, 'o').px(2, 9, 'o').px(10, 10, 'o').px(5, 11, 'o'))
M['flame'] = grid("""
................
.......T........
......TT........
......TtT.......
.....TttT...T...
....TTttTT..TT..
....TttytT.TtT..
...TTtyytTTttT..
...TttyyyttttT..
..TTtyyoyytttT..
..TttyooyyytTT..
..TttyooyyyttT..
...TtyyyyyttT...
...TTtyyyttTT...
....TTTTTTTT....
................
""")

M['heal'] = (G().ell(2, 3, 8, 9, 'r').ell(7, 3, 13, 9, 'r').poly([(2, 7), (13, 7), (8, 13), (7, 13)], 'r')
             .line([(9, 11), (12, 8)], 'R').px(4, 5, 'o').px(5, 4, 'o').px(4, 4, 'h').px(5, 5, 'h'))

M['lamp'] = (G().ell(6, 0, 9, 3, None, 'x').rect(4, 3, 11, 4, 'x').rect(4, 12, 11, 13, 'x')
             .rect(5, 5, 10, 11, 'y').rect(7, 7, 8, 10, 't').px(7, 6, 'T').px(8, 8, 'o')
             .line([(4, 5), (4, 11)], 'x').line([(11, 5), (11, 11)], 'x'))

M['leaf'] = (G().poly([(2, 13), (3, 6), (8, 2), (14, 1), (13, 8), (8, 12)], 'l').poly([(3, 12), (13, 2), (13, 8), (8, 12)], 'L')
             .line([(2, 14), (12, 3)], 'G').line([(6, 9), (5, 5)], 'G').line([(9, 6), (12, 7)], 'G'))

M['sun'] = (G().line([(7, 0), (7, 15)], 't').line([(8, 0), (8, 15)], 't').line([(0, 7), (15, 7)], 't').line([(0, 8), (15, 8)], 't')
            .line([(2, 2), (13, 13)], 'T').line([(13, 2), (2, 13)], 'T')
            .ell(3, 3, 12, 12, 'y').ell(5, 5, 10, 10, 'o').ell(6, 6, 9, 9, 'y'))

M['eye'] = (G().poly([(1, 8), (5, 4), (10, 4), (14, 8), (10, 12), (5, 12)], 'o')
            .ell(5, 5, 10, 11, 'm').ell(6, 6, 9, 10, 'M').rect(7, 7, 8, 9, 'k').px(6, 6, 'o')
            .line([(1, 8), (14, 8)], 'o').ell(5, 5, 10, 11, None, 'm').rect(7, 7, 8, 9, 'k'))

M['wilt'] = (G().line([(13, 2), (9, 6)], 'W', 2).line([(13, 1), (9, 5)], 'w')
             .line([(7, 9), (5, 11)], 'W', 2).line([(3, 9), (7, 13)], 'Y').line([(4, 12), (2, 14)], 'n', 2)
             .px(8, 8, 'W').px(10, 9, 'W').px(11, 11, 'W'))

M['blood'] = (G().poly([(8, 1), (12, 7), (13, 10), (11, 13), (8, 14), (5, 13), (3, 10), (4, 7)], 'r')
              .poly([(8, 3), (11, 8), (12, 11), (10, 13), (8, 13)], 'R').rect(5, 8, 5, 10, 'h').px(6, 7, 'h'))

M['swirl'] = grid("""
................
.....pppppp.....
...pp......pp...
..p..PPPPP...p..
..p.P.....P..p..
.p.P..ppp..P..p.
.p.P.p...p.P..p.
.p.P.p.o.p.P..p.
.p.P.p..pp.P..p.
.p.P..p....P.p..
..p.P..PPPP..p..
..p..P......p...
...p..PPPPPP....
....pp..........
......pppp......
................
""")

M['hourglass'] = (G().rect(2, 1, 13, 2, 'n').rect(2, 13, 13, 14, 'n')
                  .poly([(4, 3), (11, 3), (8, 8), (7, 8)], 'c').poly([(7, 8), (8, 8), (11, 12), (4, 12)], 'c')
                  .poly([(5, 4), (10, 4), (8, 7), (7, 7)], 'y').poly([(6, 11), (9, 11), (8, 10), (7, 10)], 'y').rect(5, 12, 10, 12, 'y')
                  .line([(7, 8), (7, 11)], 'y'))

M['spade'] = (G().line([(12, 1), (6, 7)], 'n', 2).line([(11, 1), (14, 4)], 'n')
              .poly([(6, 6), (9, 9), (5, 14), (1, 14), (1, 10)], 'W').poly([(6, 7), (8, 9), (5, 13), (2, 13), (2, 10)], 'w'))

M['skull'] = grid("""
................
................
....cccccccc....
...cccccccccc...
..ccccccccccCc..
..ccccccccccCc..
..ccDDcccDDcCc..
..cDDDcccDDDcc..
..cDDDcccDDDcc..
..cccccDccccCc..
...ccccDDcccC...
....cccccccc....
....cCcCcCcC....
....cCcCcCcC....
.....cccccc.....
................
""")

M['grave'] = (G().rect(4, 2, 11, 13, 'C').ell(4, 0, 11, 6, 'C').rect(5, 3, 10, 12, 'c').ell(5, 1, 10, 6, 'c')
              .rect(7, 3, 8, 9, 'C').rect(5, 5, 10, 6, 'C').rect(1, 13, 14, 14, 'G')
              .grid("""
................
................
................
................
................
................
................
................
................
................
..........g.....
.........gggg...
..........ggg...
...........g....
................
................
"""))

M['burst'] = (G().poly([(8, 0), (10, 5), (15, 3), (12, 8), (15, 13), (9, 11), (7, 15), (6, 10), (0, 12), (4, 7), (0, 2), (6, 4)], 'T')
              .poly([(8, 3), (9, 6), (12, 5), (11, 8), (12, 11), (8, 10), (7, 12), (6, 9), (3, 10), (5, 7), (3, 4), (7, 5)], 't')
              .ell(6, 6, 9, 9, 'y').px(7, 7, 'o'))

M['bell'] = (G().poly([(5, 3), (10, 3), (11, 6), (12, 10), (14, 12), (1, 12), (3, 10), (4, 6)], 'Y')
             .poly([(6, 4), (8, 4), (8, 11), (4, 11), (5, 6)], 'y').line([(6, 5), (6, 9)], 'o')
             .rect(6, 1, 9, 2, 'n').rect(1, 12, 14, 12, 'Y').ell(6, 12, 9, 15, 'Y').px(7, 13, 'y'))

M['waves'] = grid("""
................
.........a......
..........a.....
.....A.....a....
......A.....a...
...o...A....a...
..ooo..A.....a..
.ooooo.A.....a..
.ooooo.A.....a..
..ooo..A.....a..
...o...A....a...
......A.....a...
.....A.....a....
..........a.....
.........a......
................
""")

M['whip'] = (G().line([(2, 14), (5, 11)], 'N', 2).px(5, 10, 'Y').px(6, 10, 'Y')
             .line([(6, 10), (9, 6), (10, 3), (8, 1), (5, 2), (4, 5), (6, 7), (10, 8), (13, 7), (14, 4)], 'S')
             .px(14, 3, 'c').px(13, 2, 'c'))
M['flask'] = (G().rect(6, 1, 9, 6, 'w').rect(5, 1, 10, 1, 'n').ell(2, 5, 13, 14, 'w').ell(3, 8, 12, 14, 'l')
              .rect(7, 2, 8, 5, 'o').px(5, 9, 'o').px(9, 10, 'L').px(10, 12, 'L').px(6, 12, 'L').px(4, 7, 'o'))

M['venom'] = (G().poly([(8, 1), (12, 7), (13, 10), (11, 13), (8, 14), (5, 13), (3, 10), (4, 7)], 'l')
              .poly([(8, 3), (11, 8), (12, 11), (10, 13), (8, 13)], 'L').rect(5, 8, 5, 10, 'o').px(6, 7, 'o')
              .rect(6, 9, 6, 9, 'G').px(9, 11, 'G'))

M['dodge'] = grid("""
................
...........oo...
.........ooww...
....nn..owwW....
....nn.owwW.....
....nnowWW......
....nnwWW.......
....nnn.........
....nnn.........
....nnnn........
....nnnnnn......
...nnnnnnnnn....
...NNNNNNNNN....
................
.a..a..a........
................
""")

M['target'] = (G().ell(1, 1, 14, 14, 'r').ell(3, 3, 12, 12, 'o').ell(5, 5, 10, 10, 'r').ell(7, 7, 8, 8, 'o')
               .line([(7, 0), (7, 15)], 'x').line([(0, 7), (15, 7)], 'x').rect(7, 7, 7, 7, 'o'))

# A crescent: the full disc minus a shifted one.
_v = G().ell(1, 1, 13, 14, 'c')
_v.d.ellipse((5, -1, 16, 11), fill=(0, 0, 0, 0))
_v.px(3, 6, 'C').px(4, 9, 'C').px(6, 12, 'C').grid("""
................
................
............o...
...........ooo..
............o...
................
................
................
................
..............o.
................
................
................
................
................
................
""")
M['veil'] = _v

M['door'] = (G().rect(3, 4, 12, 14, 'N').ell(3, 1, 12, 8, 'N').rect(4, 5, 11, 14, 'y').ell(4, 2, 11, 8, 'y')
             .rect(6, 5, 9, 14, 'o').poly([(4, 14), (4, 4), (7, 6), (7, 14)], 'n').line([(5, 9), (6, 9)], 'Y'))

M['cards'] = (G().poly([(1, 4), (7, 2), (9, 12), (3, 14)], 'c').poly([(6, 2), (13, 2), (13, 13), (6, 13)], 'o')
              .rect(7, 3, 12, 12, 'o').rect(8, 4, 11, 11, 'c').px(9, 6, 'r').px(10, 6, 'r').rect(9, 7, 10, 8, 'r')
              .px(3, 6, 'C').px(4, 9, 'C'))

M['void'] = (G().ell(1, 2, 14, 13, 'P').ell(3, 4, 12, 11, 'p').ell(4, 5, 11, 10, 'D').ell(6, 6, 9, 9, 'x')
             .px(2, 1, 'o').px(13, 14, 'o').px(14, 3, 'w'))

# ---------------------------------------------------------------------------
# Marks (8x8): the badge for a card's second effect. Fills inside 1..6.

K = {}
K['hourglass'] = grid("""
........
.nnnnnn.
..cyyc..
...yc...
...cy...
..cyyc..
.nnnnnn.
........
""", 8)
K['front'] = grid("""
........
....a...
....aa..
.aaaaaa.
.aaaaaa.
....aa..
....a...
........
""", 8)
K['back'] = grid("""
........
...a....
..aa....
.aaaaaa.
.aaaaaa.
..aa....
...a....
........
""", 8)
K['swirl'] = grid("""
........
..pppp..
.p....p.
.p.pp.p.
.p.p..p.
.p..pp..
..p.....
........
""", 8)
K['shield'] = grid("""
........
.WwwwwW.
.WwYYwW.
.WwYYwW.
.WwwwwW.
..WwwW..
...WW...
........
""", 8)
K['spikes'] = grid("""
........
.w..w..w
.w.ww.ww
ww.ww.ww
wWwwWwwW
xxxxxxxx
........
........
""", 8)
K['sword'] = grid("""
........
......o.
.....ow.
....ow..
.Y.ow...
..Yw....
.nYY....
.n......
""", 8)
K['venom'] = grid("""
........
...l....
..lll...
.lllLl..
.lolLl..
.llLLl..
..lll...
........
""", 8)
K['wing'] = grid("""
........
.o......
.ow.....
.oww....
.owwwww.
..owwW..
...oW...
........
""", 8)
K['sun'] = grid("""
........
.t.t..t.
..yyyy..
.tyooyt.
..yooy..
.tyyyyt.
..t..t..
........
""", 8)
K['heal'] = grid("""
........
.rr.rr..
rhrrrrr.
rrrrrrr.
.rrrrR..
..rrR...
...R....
........
""", 8)
K['eye'] = grid("""
........
........
..oooo..
.ommMoo.
oomkkmoo
.oommoo.
..oooo..
........
""", 8)
K['star'] = grid("""
........
...y....
...y....
.yyoyy..
...y....
...y....
........
........
""", 8)
K['bone'] = grid("""
........
.cc...c.
.ccc.cc.
..cccc..
..cccc..
.cc.ccc.
.c...cc.
........
""", 8)
K['skull'] = grid("""
........
..cccc..
.cccccc.
.cDccDc.
.cccccc.
..cDDc..
..cccc..
........
""", 8)
K['blood'] = grid("""
........
...r....
..rrr...
..rrrr..
.rhrrR..
.rrrRR..
..rRR...
........
""", 8)
K['cards'] = grid("""
........
.ccooo..
.cooooo.
.coroo..
.corro..
.cooooo.
..ooooo.
........
""", 8)
K['crack'] = grid("""
....y...
...yo...
..yy....
.yyyyy..
...yy...
..yo....
..y.....
........
""", 8)
K['flame'] = grid("""
........
...T....
..TtT...
..Tttt..
.TtyytT.
.Ttyoyt.
..TtttT.
........
""", 8)
K['flask'] = grid("""
........
...ww...
...ww...
..wwww..
.wlllLw.
.llLlll.
..llll..
........
""", 8)

MOTIFS = {k: v.rows() for k, v in M.items()}
MARKS = {k: v.rows() for k, v in K.items()}
for name, rows in {**MOTIFS, **MARKS}.items():
    for r in rows:
        assert all(ch == '.' or ch in PALETTE for ch in r), name


# ---------------------------------------------------------------------------
# Preview: compose every card as the client does, for checking by eye.

def ts_table():
    """The card -> (motif, mark) table and the school tints, from shared/src/content/cards.ts (a light parse, enough for
    the preview): a card's motif is its first school's icon (or its summon), its mark its second school's."""
    src = open('shared/src/content/cards.ts', encoding='utf8').read()
    tints = dict(re.findall(r"^\s+(\w+): \{ name: '[^']+', glyph: '[^']+', tint: \['(#\w+)'", src, re.M))
    tint2 = dict(re.findall(r"^\s+(\w+): \{ name: '[^']+', glyph: '[^']+', tint: \['#\w+', '(#\w+)'\]", src, re.M))
    schools = dict((m[0], m[1].split(', ')) for m in re.findall(r"^\s+(\w+): card\('\w+', (?:'[^']+'|\"[^\"]+\"), [\d.]+, \[([^\]]*)\]", src, re.M))
    schools = {k: [s.strip("'") for s in v if s] for k, v in schools.items()}
    icons = dict((m[0], (m[1], m[2])) for m in re.findall(r"^\s+(\w+): \{ motif: '(\w+)', mark: '(\w+)' \},", src, re.M))
    summons = dict(re.findall(r"(\w+): '(\w+)'", re.search(r"SUMMON_ART[^=]*= \{([^}]*)\}", src).group(1)))
    art = {}
    for card, sc in schools.items():
        motif = summons.get(card) or (icons[sc[0]][0] if sc else ('void' if card == 'snakeeyes' else 'hand'))
        art[card] = (motif, icons[sc[1]][1] if len(sc) > 1 else None)
    return art, tints, tint2, schools


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def compose(card, art, tints, tint2, schools, sprites):
    main, mark = art[card]
    sc = (schools.get(card) or [None])[0]
    dark = hexrgb(tints.get(sc, '#202020'))
    mid = hexrgb(tint2.get(sc, '#3a3a3a'))
    im = Image.new('RGB', (24, 24), dark)
    d = ImageDraw.Draw(im)
    d.ellipse((2, 1, 21, 20), fill=mid)
    rows = MOTIFS.get(main) or outline(sprites[main])
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.':
                im.putpixel((4 + x, 3 + y), RGB[ch])
    if mark:
        d.ellipse((14, 14, 23, 23), fill=RGB['k'])
        d.ellipse((15, 15, 22, 22), fill=dark)
        for y, r in enumerate(MARKS[mark]):
            for x, ch in enumerate(r):
                if ch != '.':
                    im.putpixel((15 + x, 15 + y), RGB[ch])
    return im


def sprite_rows():
    src = open('tools/sprites.py', encoding='utf8').read()
    return {n: [r for r in a.strip('\n').split('\n')] for n, a in re.findall(r"^'(\w+)': \"\"\"\n(.*?)\"\"\"", src, re.M | re.S)}


if __name__ == '__main__':
    ts = ['// Generated by tools/card_art.py (python tools/card_art.py client/src/render/card-art-data.ts) — card picture parts.',
          "// Motifs are 16×16, marks 8×8, outlines included; '.' = transparent, other letters index CARD_PALETTE.",
          f'export const CARD_PALETTE: Record<string, string> = {json.dumps(PALETTE)};', '',
          'export const MOTIF_ROWS: Record<string, string[]> = {']
    for n, rows in MOTIFS.items():
        ts.append(f'  {n}: [{", ".join(repr(r) for r in rows)}],')
    ts += ['};', '', 'export const MARK_ROWS: Record<string, string[]> = {']
    for n, rows in MARKS.items():
        ts.append(f'  {n}: [{", ".join(repr(r) for r in rows)}],')
    ts.append('};')
    open(sys.argv[1], 'w', encoding='utf8').write('\n'.join(ts) + '\n')
    print('ok', len(MOTIFS), 'motifs', len(MARKS), 'marks')
    if len(sys.argv) > 2:
        art, tints, tint2, schools = ts_table()
        sprites = sprite_rows()
        cards = list(art)
        cols = 12
        scale = 4
        sheet = Image.new('RGB', (cols * 26 * scale, ((len(cards) + cols - 1) // cols) * 26 * scale), (10, 8, 6))
        for i, c in enumerate(cards):
            im = compose(c, art, tints, tint2, schools, sprites).resize((24 * scale, 24 * scale), Image.NEAREST)
            sheet.paste(im, ((i % cols) * 26 * scale, (i // cols) * 26 * scale))
        sheet.save(sys.argv[2])
        print('preview', sys.argv[2], len(cards), 'cards')
