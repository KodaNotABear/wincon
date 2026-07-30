import { MAP_MAX } from '../analysis/metrics'
import { useDdragonVersion } from './ddragon'

// Game coords: blue base at origin (bottom-left), red base top-right.
// SVG y grows downward, so flip y. Both map views share this projection.
export const sx = (x: number) => (x / MAP_MAX) * 100
export const sy = (y: number) => 100 - (y / MAP_MAX) * 100

const at = (x: number, y: number) => ({ x: sx(x), y: sy(y) })

// Real pit locations from timeline event positions.
export const DRAGON_PIT = at(9866, 4414)
export const BARON_PIT = at(5007, 10471)

// Stylized landmark positions in game units. These are approximations placed
// for map-reading, not surveyed data; the pits above are the exact ones.
const CAMPS = [
  // Blue-side jungle
  { ...at(3871, 8107), r: 1.5 }, // blue sentinel
  { ...at(2164, 8418), r: 1.1 }, // gromp
  { ...at(3780, 6443), r: 1.1 }, // wolves
  { ...at(6944, 5480), r: 1.1 }, // raptors
  { ...at(7813, 4051), r: 1.5 }, // red brambleback
  { ...at(8370, 2718), r: 1.1 }, // krugs
  // Red-side jungle (mirrored)
  { ...at(10931, 6990), r: 1.5 },
  { ...at(12703, 6443), r: 1.1 },
  { ...at(11008, 8387), r: 1.1 },
  { ...at(7852, 9285), r: 1.1 },
  { ...at(7100, 10800), r: 1.5 },
  { ...at(6476, 12017), r: 1.1 },
]

const SCUTTLES = [at(10500, 9000), at(4400, 5800)]

const BRUSHES = [
  // Mid-lane side brushes
  at(5200, 6650),
  at(6600, 5300),
  at(8300, 9500),
  at(9700, 8100),
  // River entrances near the pits
  at(8900, 5200),
  at(6000, 9700),
  // Top lane
  at(1500, 9200),
  at(1500, 11600),
  at(9200, 13500),
  at(11600, 13500),
  // Bot lane
  at(9200, 1400),
  at(11600, 1400),
  at(13500, 9200),
  at(13500, 11600),
  // Tri-brush areas
  at(3100, 11800),
  at(11800, 3100),
]

// Lane turrets (t1/t2/t3 per lane per side), drawn as tiny team-tinted marks.
const TOWERS: { x: number; y: number; team: 100 | 200 }[] = [
  { ...at(981, 10441), team: 100 },
  { ...at(1512, 6699), team: 100 },
  { ...at(1169, 4287), team: 100 },
  { ...at(5846, 6396), team: 100 },
  { ...at(5048, 4812), team: 100 },
  { ...at(3651, 3696), team: 100 },
  { ...at(10504, 1029), team: 100 },
  { ...at(6919, 1483), team: 100 },
  { ...at(4281, 1253), team: 100 },
  { ...at(4318, 13875), team: 200 },
  { ...at(7943, 13411), team: 200 },
  { ...at(10481, 13650), team: 200 },
  { ...at(8955, 8510), team: 200 },
  { ...at(9767, 10113), team: 200 },
  { ...at(11134, 11207), team: 200 },
  { ...at(13866, 4505), team: 200 },
  { ...at(13327, 8226), team: 200 },
  { ...at(13624, 10572), team: 200 },
]

const ALCOVES = [at(1900, 12900), at(12900, 1900)]

/**
 * The map base. When Data Dragon is reachable we use Riot's actual minimap
 * raster (accurate geometry: real jungle walls, pits, camps) desaturated and
 * washed toward our palette; offline we fall back to the hand-drawn stylized
 * Rift. Both render in the same 0-100 projection, so dots, trails, and pings
 * land identically on either base.
 */
export function RiftBackdrop() {
  const version = useDdragonVersion()
  if (version) {
    return (
      <>
        <defs>
          <filter id="rift-tone">
            <feColorMatrix type="saturate" values="0.35" />
          </filter>
          <clipPath id="rift-clip">
            <rect x="0.5" y="0.5" width="99" height="99" rx="4" />
          </clipPath>
        </defs>
        <rect x="0.5" y="0.5" width="99" height="99" rx="4" fill="var(--map-bg)" stroke="var(--border)" />
        <image
          href={`https://ddragon.leagueoflegends.com/cdn/${version}/img/map/map11.png`}
          x="0.5"
          y="0.5"
          width="99"
          height="99"
          preserveAspectRatio="none"
          filter="url(#rift-tone)"
          clipPath="url(#rift-clip)"
        />
        {/* Wash the raster toward the theme so palette elements stay dominant */}
        <rect x="0.5" y="0.5" width="99" height="99" rx="4" fill="var(--map-bg)" opacity="var(--map-wash)" />
        <rect x="0.5" y="0.5" width="99" height="99" rx="4" fill="none" stroke="var(--border)" />
      </>
    )
  }
  return <StylizedRift />
}

function StylizedRift() {
  return (
    <>
      <rect x="0.5" y="0.5" width="99" height="99" rx="4" fill="var(--map-bg)" stroke="var(--border)" />

      {/* Jungle terrain: one organic mass per quadrant, kept low-contrast */}
      <g fill="var(--map-terrain)">
        <path d="M 18 78 Q 14 66 22 62 Q 30 58 34 64 Q 40 70 34 76 Q 27 83 18 78 Z" />
        <path d="M 40 52 Q 36 42 44 38 Q 52 35 55 42 Q 58 50 50 54 Q 43 57 40 52 Z" />
        <path d="M 62 60 Q 58 50 66 47 Q 74 44 77 52 Q 80 60 72 63 Q 65 66 62 60 Z" />
        <path d="M 66 34 Q 62 24 70 21 Q 79 18 82 26 Q 85 34 77 38 Q 69 40 66 34 Z" />
        <path d="M 24 40 Q 20 32 27 28 Q 34 25 37 32 Q 40 39 32 42 Q 26 44 24 40 Z" />
        <path d="M 45 22 Q 42 15 49 12 Q 56 10 58 17 Q 60 24 52 26 Q 47 27 45 22 Z" />
        <path d="M 52 88 Q 49 81 56 78 Q 63 76 65 83 Q 67 90 59 91 Q 54 92 52 88 Z" />
        <path d="M 76 74 Q 73 68 79 65 Q 86 63 88 69 Q 90 76 82 78 Q 78 78 76 74 Z" />
      </g>

      {/* River */}
      <line x1="-4" y1="-4" x2="104" y2="104" stroke="var(--map-river)" strokeWidth="11" />

      {/* Lanes: top hugs left+top edges, bot hugs bottom+right, mid cuts across */}
      <path d="M 9 82 L 9 15 Q 9 9 15 9 L 82 9" fill="none" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M 18 91 L 85 91 Q 91 91 91 85 L 91 18" fill="none" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="15" y1="85" x2="85" y2="15" stroke="var(--map-lane)" strokeWidth="4.5" strokeLinecap="round" />

      {/* Alcoves: pockets off the side lanes */}
      {ALCOVES.map((a, i) => (
        <circle key={`alcove-${i}`} cx={a.x} cy={a.y} r="2.6" fill="var(--map-lane)" opacity="0.8" />
      ))}

      {/* Bases */}
      <path d="M 0 76 A 24 24 0 0 1 24 100 L 0 100 Z" fill="var(--series-1)" opacity="0.16" />
      <path d="M 76 0 A 24 24 0 0 0 100 24 L 100 0 Z" fill="var(--series-2)" opacity="0.16" />

      {/* Turrets */}
      <g opacity="0.5">
        {TOWERS.map((t, i) => (
          <rect
            key={`tower-${i}`}
            x={t.x - 0.9}
            y={t.y - 0.9}
            width="1.8"
            height="1.8"
            transform={`rotate(45 ${t.x} ${t.y})`}
            fill={t.team === 100 ? 'var(--series-1)' : 'var(--series-2)'}
          />
        ))}
      </g>

      {/* Jungle camps and river scuttles */}
      <g fill="var(--map-camp)">
        {CAMPS.map((c, i) => (
          <circle key={`camp-${i}`} cx={c.x} cy={c.y} r={c.r} />
        ))}
      </g>
      <g fill="none" stroke="var(--map-camp)" strokeWidth="0.55">
        {SCUTTLES.map((s, i) => (
          <circle key={`scuttle-${i}`} cx={s.x} cy={s.y} r="1.1" />
        ))}
      </g>

      {/* Brushes */}
      <g fill="var(--map-brush)">
        {BRUSHES.map((b, i) => (
          <ellipse key={`brush-${i}`} cx={b.x} cy={b.y} rx="1.7" ry="1" transform={`rotate(${i % 2 ? 40 : -40} ${b.x} ${b.y})`} />
        ))}
      </g>

      {/* Objective pits: wall arc opening toward the river, plus a glyph */}
      <g opacity="0.75">
        <path
          d={`M ${DRAGON_PIT.x + 3.2} ${DRAGON_PIT.y - 2.2} A 3.6 3.6 0 1 1 ${DRAGON_PIT.x - 2.2} ${DRAGON_PIT.y - 3.2}`}
          fill="none"
          stroke="var(--map-camp)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d={`M ${DRAGON_PIT.x} ${DRAGON_PIT.y - 1.4} L ${DRAGON_PIT.x + 1.2} ${DRAGON_PIT.y} L ${DRAGON_PIT.x} ${DRAGON_PIT.y + 1.4} L ${DRAGON_PIT.x - 1.2} ${DRAGON_PIT.y} Z`}
          fill="var(--muted)"
        />
        <path
          d={`M ${BARON_PIT.x - 3.2} ${BARON_PIT.y + 2.2} A 3.6 3.6 0 1 1 ${BARON_PIT.x + 2.2} ${BARON_PIT.y + 3.2}`}
          fill="none"
          stroke="var(--map-camp)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d={`M ${BARON_PIT.x - 1.3} ${BARON_PIT.y + 1.1} L ${BARON_PIT.x - 1.3} ${BARON_PIT.y - 0.6} L ${BARON_PIT.x - 0.45} ${BARON_PIT.y + 0.15} L ${BARON_PIT.x} ${BARON_PIT.y - 1.3} L ${BARON_PIT.x + 0.45} ${BARON_PIT.y + 0.15} L ${BARON_PIT.x + 1.3} ${BARON_PIT.y - 0.6} L ${BARON_PIT.x + 1.3} ${BARON_PIT.y + 1.1} Z`}
          fill="var(--muted)"
        />
      </g>
    </>
  )
}
