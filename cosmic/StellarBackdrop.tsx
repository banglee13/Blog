// A single static star atlas is reused on every interior page; the margins
// carry the brighter stars, leaving a quiet zone behind prose and forms.
function atlas() {
  let seed = 12506
  const sample = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const groups = [[], [], [], []] as string[][]
  const rays: string[] = []
  for (let i = 0; i < 530; i++) {
    const x = sample() * 1600,
      y = sample() * 1000
    if (x > 340 && x < 1260 && sample() < 0.82) continue
    const r = 0.42 + sample() ** 3 * 1.2
    const group = Math.floor(sample() * 4)
    const sx = x.toFixed(1),
      sy = y.toFixed(1)
    groups[group].push(
      `M${sx} ${sy}m-${r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 -${2 * r},0`,
    )
    if (r > 1.48 && (x < 320 || x > 1250)) {
      const w = Number((r * 2.9).toFixed(1))
      rays.push(
        `M${sx} ${sy}l-${w},0 ${w},-.8 0,-${w} .9,${w} ${w},.8 -${w},.7 -.9,${w} 0,-${w}z`,
      )
    }
  }
  return [...groups.map((g) => g.join('')), rays.join('')]
}
const paths = atlas()
export function StellarBackdrop() {
  return (
    <div className="stellar-sky" aria-hidden="true">
      <svg
        className="stellar-sky-points"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} className={'stellar-tone-' + i} />
        ))}
      </svg>
    </div>
  )
}
export default StellarBackdrop
