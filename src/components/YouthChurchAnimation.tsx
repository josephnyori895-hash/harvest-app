import type { CSSProperties } from 'react'

// Real faces, not illustrated avatars. Eight young people arrive from the edges
// like frames of a short film, settle into a congregation inside a gold church
// arch, and the Harvest mark lands at the end. It is a fixed full-page layer, so
// the story stays behind the whole landing while the page scrolls.
type Person = {
  src: string
  x: string
  y: string
  fx: string
  fy: string
  rot: string
  delay: string
}

const PEOPLE: Person[] = [
  { src: '/youth/1.jpg', x: '12%', y: '66%', fx: '-52vw', fy: '8vh', rot: '-7deg', delay: '0s' },
  { src: '/youth/2.jpg', x: '21%', y: '57%', fx: '-44vw', fy: '-4vh', rot: '5deg', delay: '.1s' },
  { src: '/youth/3.jpg', x: '30%', y: '51%', fx: '-34vw', fy: '-14vh', rot: '-4deg', delay: '.2s' },
  { src: '/youth/4.jpg', x: '39%', y: '48%', fx: '-22vw', fy: '-22vh', rot: '6deg', delay: '.3s' },
  { src: '/youth/5.jpg', x: '61%', y: '48%', fx: '22vw', fy: '-22vh', rot: '-6deg', delay: '.3s' },
  { src: '/youth/6.jpg', x: '70%', y: '51%', fx: '34vw', fy: '-14vh', rot: '4deg', delay: '.2s' },
  { src: '/youth/7.jpg', x: '79%', y: '57%', fx: '44vw', fy: '-4vh', rot: '-5deg', delay: '.1s' },
  { src: '/youth/8.jpg', x: '88%', y: '66%', fx: '52vw', fy: '8vh', rot: '7deg', delay: '0s' },
]

export default function YouthChurchAnimation() {
  return (
    <div className="youth-film" aria-hidden="true">
      <div className="youth-arch" />

      {PEOPLE.map((p, i) => (
        <figure
          key={p.src}
          className="youth-card"
          style={{
            '--x': p.x,
            '--y': p.y,
            '--fx': p.fx,
            '--fy': p.fy,
            '--rot': p.rot,
            animationDelay: p.delay,
          } as CSSProperties}
        >
          <img src={p.src} alt="" loading="eager" decoding="async" />
          <span className="youth-card-tint" />
          <span className="youth-card-ring" />
          <span className="youth-card-index">{String(i + 1).padStart(2, '0')}</span>
        </figure>
      ))}

      <div className="youth-emblem">
        <div className="youth-emblem-ring">
          <img src="/logo-mark.svg" alt="Harvest Family Church" />
        </div>
        <p className="youth-emblem-title">HARVEST FAMILY CHURCH</p>
        <p className="youth-emblem-sub">NYERI</p>
      </div>
    </div>
  )
}
