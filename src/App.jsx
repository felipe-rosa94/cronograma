import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, provider } from './firebase'
import logo from './assets/logo.svg'
import './App.css'

const DAY = 1440
const SIZE = 400
const C = SIZE / 2
const R = 150 // raio do anel
const STROKE = 30 // espessura do anel
const GAP = 3 // minutos de espaço entre segmentos
const STORAGE_KEY_V2 = 'cronograma-v3'

// paleta suave: saturação e luminosidade parecidas entre si
const COLORS = [
  '#f2a65a', '#e8707e', '#5fc3a0', '#6fa8f0', '#a58cf2',
  '#e58bc0', '#4fc0c4', '#f08a5d', '#9ccc65', '#5ccbe0',
]

// start e duration em minutos (0 = meia-noite)
const INITIAL = []

const mod = (n) => ((n % DAY) + DAY) % DAY
const pad = (n) => String(n).padStart(2, '0')
const fmt = (m) => {
  const x = mod(m)
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`
}
const fmtDur = (d) => {
  const h = Math.floor(d / 60)
  const m = d % 60
  if (h && m) return `${h}h${pad(m)}`
  return h ? `${h}h` : `${m}min`
}
const toMin = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const polar = (min, r) => {
  const a = (min / DAY) * 2 * Math.PI - Math.PI / 2
  return [C + r * Math.cos(a), C + r * Math.sin(a)]
}
const arcPath = (start, dur, r) => {
  const d = Math.min(dur, DAY - 0.01)
  const [x1, y1] = polar(start, r)
  const [x2, y2] = polar(start + d, r)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${d > DAY / 2 ? 1 : 0} 1 ${x2} ${y2}`
}

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const allDays = (ts) => Object.fromEntries(WEEK.map((_, i) => [i, ts]))

const CLIP_KEY = 'cronograma-clip'

const loadClip = () => {
  try {
    return JSON.parse(localStorage.getItem(CLIP_KEY)) || null
  } catch {
    return null
  }
}

const loadDays = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_V2)
    if (saved) return JSON.parse(saved)
    return allDays(INITIAL)
  } catch {
    return allDays(INITIAL)
  }
}

export default function App() {
  const [days, setDays] = useState(loadDays)
  const [dayIdx, setDayIdx] = useState(() => new Date().getDay())
  const [user, setUser] = useState(undefined)
  const [guest, setGuest] = useState(false)
  const [sync, setSync] = useState('')
  const cloudReady = useRef(false)
  const [addOpen, setAddOpen] = useState(false)
  const todoInputRef = useRef(null)
  const todoFileRef = useRef(null)
  const [todoMenu, setTodoMenu] = useState(false)
  const [todoId, setTodoId] = useState(null)
  const [todoText, setTodoText] = useState('')
  const tasks = days[dayIdx] || []
  const setTasks = (fn) => setDays((d) => ({ ...d, [dayIdx]: fn(d[dayIdx] || []) }))
  const [selectedId, setSelectedId] = useState(null)
  const [clip, setClip] = useState(loadClip)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drag, setDrag] = useState(null) // { id, edge: 'start' | 'end' }
  const [now, setNow] = useState(new Date())
  const [form, setForm] = useState({ name: '', start: '12:00', duration: 30 })
  const svgRef = useRef(null)
  const panelRef = useRef(null)
  const agendaRef = useRef(null)

  // no celular o relógio sai da tela ao rolar a lista: ao tocar no card, volta até ele
  const selectFromList = (id, e) => {
    setSelectedId(id)
    const small = window.matchMedia('(max-width: 899px)').matches
    if (e.target.closest('input, button')) return
    if (small) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(days))
  }, [days])

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        cloudReady.current = false
        setUser(u)
        if (!u) return
        try {
          const snap = await getDoc(doc(db, 'users', u.uid))
          if (snap.exists()) setDays(JSON.parse(snap.data().days))
          cloudReady.current = true
          setSync('ok')
          if (!snap.exists()) setDays((d) => ({ ...d }))
        } catch {
          setSync('erro')
        }
      }),
    []
  )

  useEffect(() => {
    if (!user || !cloudReady.current) return
    setSync('salvando')
    const t = setTimeout(() => {
      setDoc(doc(db, 'users', user.uid), { days: JSON.stringify(days) })
        .then(() => setSync('ok'))
        .catch(() => setSync('erro'))
    }, 1000)
    return () => clearTimeout(t)
  }, [days, user])

  // desktop: ao selecionar (no relógio ou na lista), leva a linha ao topo da coluna rolável
  useEffect(() => {
    const box = agendaRef.current
    if (!selectedId || !box || !window.matchMedia('(min-width: 900px)').matches) return
    const row = box.querySelector(`[data-id="${selectedId}"]`)
    if (row) box.scrollTo({ top: row.offsetTop, behavior: 'smooth' })
  }, [selectedId])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const copyDay = () => {
    const c = { from: WEEK[dayIdx], tasks }
    setClip(c)
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(c))
    } catch {
      /* sem armazenamento */
    }
  }

  const pasteDay = () => {
    if (!clip) return
    if (tasks.length && !confirm(`Substituir as tarefas de ${WEEK[dayIdx]} pelas de ${clip.from}?`)) return
    const stamp = Date.now()
    setTasks(() =>
      clip.tasks.map((t, i) => ({
        ...t,
        id: stamp + i,
        todos: t.todos?.map((x, j) => ({ ...x, id: stamp + i * 1000 + j, done: false })),
      }))
    )
    setSelectedId(null)
  }

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const isToday = dayIdx === now.getDay()
  const selected = tasks.find((t) => t.id === selectedId)
  const current = isToday ? tasks.find((t) => mod(nowMin - t.start) < t.duration) : undefined
  const remaining = current ? current.duration - mod(nowMin - current.start) : 0
  const isDone = (t) => isToday && t.start + t.duration <= nowMin
  const todoTask = tasks.find((t) => t.id === todoId)

  const setTodos = (id, fn) => update(id, { todos: fn(tasks.find((t) => t.id === id)?.todos || []) })
  const addTodo = (e) => {
    e.preventDefault()
    const text = todoText.trim()
    if (!text) return
    setTodos(todoId, (l) => [...l, { id: Date.now(), text, done: false }])
    setTodoText('')
    todoInputRef.current?.focus()
  }

  const exportTodos = () => {
    const data = {
      name: todoTask.name,
      start: fmt(todoTask.start),
      end: fmt(todoTask.start + todoTask.duration),
      todos: (todoTask.todos || []).map(({ text, done }) => ({ text, done })),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${todoTask.name.replace(/[^\w-]+/g, '_') || 'afazeres'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importTodos = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const raw = await file.text()
    let items
    try {
      const data = JSON.parse(raw)
      items = (Array.isArray(data) ? data : data.todos).map((x) =>
        typeof x === 'string' ? { text: x, done: false } : { text: x.text, done: !!x.done }
      )
    } catch {
      items = raw.split(/\r?\n/).map((l) => ({ text: l.replace(/^\s*(?:[-*]|\[[ xX]?\])\s*/, ''), done: false }))
    }
    items = items.filter((x) => typeof x.text === 'string' && x.text.trim())
    if (!items.length) return
    setTodos(todoId, (l) => {
      const stamp = Date.now()
      return [...l, ...items.map((x, i) => ({ id: stamp + i, text: x.text.trim(), done: x.done }))]
    })
  }

  const update = (id, patch) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const changeDuration = (t, delta) =>
    update(t.id, { duration: Math.min(DAY, Math.max(5, t.duration + delta)) })

  const addTask = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    const id = Date.now()
    setTasks((ts) => [
      ...ts,
      {
        id,
        name: form.name.trim(),
        start: toMin(form.start),
        duration: Math.max(5, Number(form.duration) || 30),
        color: COLORS[ts.length % COLORS.length],
      },
    ])
    setSelectedId(id)
    setForm({ ...form, name: '' })
    setAddOpen(false)
  }

  // --- arrastar as alças no relógio ---
  const pointerToMin = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    let a = Math.atan2(y, x) + Math.PI / 2
    if (a < 0) a += 2 * Math.PI
    return (Math.round(((a / (2 * Math.PI)) * DAY) / 5) * 5) % DAY // passos de 5 min
  }

  const onMove = (e) => {
    if (!drag) return
    const m = pointerToMin(e)
    setTasks((ts) =>
      ts.map((t) => {
        if (t.id !== drag.id) return t
        if (drag.edge === 'end') {
          let d = mod(m - t.start)
          if (d === 0) d = 5
          return { ...t, duration: d }
        }
        const end = t.start + t.duration
        let d = mod(end - m)
        if (d === 0) d = 5
        return { ...t, start: m, duration: d }
      })
    )
  }

  const startDrag = (e, edge) => {
    e.stopPropagation()
    e.target.setPointerCapture(e.pointerId)
    setDrag({ id: selectedId, edge })
  }

  const sorted = [...tasks].sort((a, b) => a.start - b.start)
  const dateLabel = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const [nx1, ny1] = polar(nowMin, R - STROKE / 2 - 3)
  const [nx2, ny2] = polar(nowMin, R + STROKE / 2 + 3)

  if (user === undefined) return <div className="login-screen" aria-busy="true" />

  if (!user && !guest) {
    return (
      <div className="login-screen">
        <img className="logo logo-lg" src={logo} alt="" />
        <h1>Meu dia</h1>
        <p>Organize sua rotina por dia da semana e acesse de qualquer aparelho.</p>
        <button className="google" onClick={() => signInWithPopup(auth, provider)}>
          Entrar com Google
        </button>
        <button className="skip" onClick={() => setGuest(true)}>
          Continuar sem conta
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="brand">
            <img className="logo" src={logo} alt="" />
            Meu dia
          </h1>
          {user ? (
            <button className="account" onClick={() => signOut(auth)} title="Sair">
              <span className={`sync ${sync}`}>
                {sync === 'salvando' ? 'Salvando…' : sync === 'erro' ? 'Erro ao sincronizar' : 'Sincronizado'}
              </span>
              {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : 'Sair'}
            </button>
          ) : (
            <button className="account login" onClick={() => signInWithPopup(auth, provider)}>
              Entrar com Google
            </button>
          )}
        </div>
        <p className="date">{dateLabel}</p>
      </header>

      <nav className="days" aria-label="Dias da semana">
        {WEEK.map((d, i) => (
          <button
            key={d}
            className={['day', i === dayIdx && 'active', i === now.getDay() && 'today']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={i === dayIdx}
            onClick={() => {
              setDayIdx(i)
              setSelectedId(null)
            }}
          >
            {d}
          </button>
        ))}
      </nav>

      <div className="layout">
        <section className="panel" ref={panelRef}>
          <button
            className="menu-btn"
            aria-label="Menu do dia"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="menu-back" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <button role="menuitem" disabled={!tasks.length} onClick={() => { copyDay(); setMenuOpen(false) }}>
                  Copiar dia
                </button>
                <button role="menuitem" disabled={!clip} onClick={() => { pasteDay(); setMenuOpen(false) }}>
                  {clip ? `Colar de ${clip.from}` : 'Colar'}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    if (confirm('Limpar todas as tarefas deste dia?')) {
                      setTasks(() => INITIAL)
                      setSelectedId(null)
                    }
                  }}
                >
                  Limpar dia
                </button>
              </div>
            </>
          )}
          <button className="plus" aria-label="Nova tarefa" onClick={() => setAddOpen(true)}>
            +
          </button>
          <svg
            ref={svgRef}
            className="dial"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onClick={() => setSelectedId(null)}
          >
            {/* trilho */}
            <circle cx={C} cy={C} r={R} fill="none" stroke="#25252a" strokeWidth={STROKE + 6} />

            {/* marcas das horas */}
            {Array.from({ length: 24 }).map((_, h) => {
              const big = h % 6 === 0
              const outer = R - STROKE / 2 - 10
              const [x1, y1] = polar(h * 60, outer)
              const [x2, y2] = polar(h * 60, outer - (big ? 9 : 5))
              return (
                <line key={h} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={big ? '#8e8e98' : '#47474f'} strokeWidth={big ? 2 : 1.5}
                  strokeLinecap="round" />
              )
            })}
            {[0, 6, 12, 18].map((h) => {
              const [x, y] = polar(h * 60, R - STROKE / 2 - 34)
              return (
                <text key={h} x={x} y={y} className="hour" textAnchor="middle" dominantBaseline="middle">
                  {h}
                </text>
              )
            })}

            {/* tarefas */}
            {tasks.map((t) => {
              const g = Math.min(GAP, t.duration * 0.3)
              const isCurrent = current && current.id === t.id
              let opacity = isDone(t) ? 0.45 : 1
              if (selectedId && selectedId !== t.id) opacity = 0.25
              return (
                <path
                  key={t.id}
                  className={isCurrent ? 'arc live' : 'arc'}
                  d={arcPath(t.start + g / 2, t.duration - g, R)}
                  fill="none"
                  stroke={t.color}
                  strokeWidth={STROKE}
                  opacity={opacity}
                  style={{ '--c': t.color }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedId(t.id)
                  }}
                />
              )
            })}

            {/* agora */}
            {isToday && (
              <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} stroke="#fff" strokeWidth={4}
                strokeLinecap="round" pointerEvents="none" />
            )}

            {/* alças */}
            {selected &&
              ['start', 'end'].map((edge) => {
                const m = edge === 'start' ? selected.start : selected.start + selected.duration
                const [x, y] = polar(m, R)
                return (
                  <g key={edge}>
                    <circle cx={x} cy={y} r={14} fill="#fff" stroke={selected.color}
                      strokeWidth={4} className="handle"
                      onPointerDown={(e) => startDrag(e, edge)} />
                    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                      className="handle-label" pointerEvents="none">
                      {edge === 'start' ? 'I' : 'F'}
                    </text>
                  </g>
                )
              })}

            {/* centro */}
            <g pointerEvents="none" textAnchor="middle">
              {selected ? (
                <>
                  <text x={C} y={C - 20} className="center-name" fill={selected.color}>
                    {selected.name}
                  </text>
                  <text x={C} y={C + 12} className="center-range">
                    {fmt(selected.start)} – {fmt(selected.start + selected.duration)}
                  </text>
                  <text x={C} y={C + 38} className="center-sub">{fmtDur(selected.duration)}</text>
                </>
              ) : (
                <>
                  <text x={C} y={C - 4} className="center-time">
                    {isToday ? fmt(nowMin) : WEEK[dayIdx]}
                  </text>
                  <text x={C} y={C + 26} className="center-name" fill={current ? current.color : '#8e8e98'}>
                    {current ? current.name : isToday ? 'Livre' : `${tasks.length} tarefas`}
                  </text>
                  {current && (
                    <text x={C} y={C + 48} className="center-sub">
                      faltam {fmtDur(remaining)}
                    </text>
                  )}
                </>
              )}
            </g>
          </svg>

          <p className="hint">
            {selected
              ? <>Arraste <b>I</b> (início) e <b>F</b> (fim) no relógio.</>
              : 'Toque numa tarefa para ajustar o horário.'}
          </p>
        </section>

        <section className="agenda" ref={agendaRef}>
          <ul className="list">
            {sorted.map((t) => {
              const open = selectedId === t.id
              const live = current && current.id === t.id
              const cls = ['row', open && 'open', live && 'live', isDone(t) && !live && 'done']
                .filter(Boolean)
                .join(' ')
              return (
                <li key={t.id} data-id={t.id} className={cls} style={{ '--c': t.color }} onClick={(e) => selectFromList(t.id, e)}>
                  <span className="dot" />
                  <div className="card">
                    <div className="line">
                      <input
                        className="name"
                        aria-label="Nome da tarefa"
                        value={t.name}
                        onChange={(e) => update(t.id, { name: e.target.value })}
                      />
                      {live && <span className="badge">Agora</span>}
                      {t.todos?.length > 0 && (
                        <span className="count">
                          {t.todos.filter((x) => x.done).length}/{t.todos.length}
                        </span>
                      )}
                      <button
                        className="del"
                        aria-label={`Remover ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setTasks((ts) => ts.filter((x) => x.id !== t.id))
                          if (selectedId === t.id) setSelectedId(null)
                        }}
                      >
                        ×
                      </button>
                    </div>

                    <div className="line times">
                      <input
                        type="time"
                        aria-label="Início"
                        value={fmt(t.start)}
                        onChange={(e) => e.target.value && update(t.id, { start: toMin(e.target.value) })}
                      />
                      <span className="sep">até</span>
                      <input
                        type="time"
                        aria-label="Fim"
                        value={fmt(t.start + t.duration)}
                        onChange={(e) => {
                          if (!e.target.value) return
                          const d = mod(toMin(e.target.value) - t.start)
                          update(t.id, { duration: d === 0 ? 5 : d })
                        }}
                      />
                      <div className="stepper">
                        <button aria-label="Diminuir 15 minutos"
                          onClick={(e) => { e.stopPropagation(); changeDuration(t, -15) }}>−</button>
                        <span>{fmtDur(t.duration)}</span>
                        <button aria-label="Aumentar 15 minutos"
                          onClick={(e) => { e.stopPropagation(); changeDuration(t, 15) }}>+</button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

        </section>
      </div>

      {addOpen && (
        <div className="sheet-back" onClick={() => setAddOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="Nova tarefa"
            style={{ '--c': 'var(--accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="line">
              <div className="sheet-title">
                <b>Nova tarefa</b>
                <span>{WEEK[dayIdx]}</span>
              </div>
              <button className="del" aria-label="Fechar" onClick={() => setAddOpen(false)}>×</button>
            </div>

            <form className="add" onSubmit={addTask}>
              <input
                autoFocus
                className="add-name"
                placeholder="Nome da tarefa"
                aria-label="Nome da nova tarefa"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                type="time"
                aria-label="Início"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
              <input
                type="number"
                min="5"
                step="5"
                aria-label="Duração em minutos"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                title="Duração em minutos"
              />
              <button type="submit">Adicionar</button>
            </form>
          </div>
        </div>
      )}

      {selected && !todoTask && (
        <button
          className="fab"
          style={{ '--c': selected.color }}
          aria-label={`Afazeres de ${selected.name}`}
          onClick={() => setTodoId(selected.id)}
        >
          ☑
          {selected.todos?.length > 0 && (
            <span className="fab-count">
              {selected.todos.filter((x) => x.done).length}/{selected.todos.length}
            </span>
          )}
        </button>
      )}

      {todoTask && (
        <div className="sheet-back" onClick={() => setTodoId(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-label={`Afazeres de ${todoTask.name}`}
            style={{ '--c': todoTask.color }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="line">
              <div className="sheet-title">
                <b>{todoTask.name}</b>
                <span>{fmt(todoTask.start)} – {fmt(todoTask.start + todoTask.duration)}</span>
              </div>
              <div className="todo-menu-wrap">
                <button
                  className="del"
                  aria-label="Menu dos afazeres"
                  aria-expanded={todoMenu}
                  onClick={() => setTodoMenu((o) => !o)}
                >
                  ⋯
                </button>
                {todoMenu && (
                  <>
                    <div className="menu-back" onClick={() => setTodoMenu(false)} />
                    <div className="menu todo-menu" role="menu">
                      <button
                        role="menuitem"
                        disabled={!todoTask.todos?.length}
                        onClick={() => { exportTodos(); setTodoMenu(false) }}
                      >
                        Exportar
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { todoFileRef.current?.click(); setTodoMenu(false) }}
                      >
                        Importar
                      </button>
                    </div>
                  </>
                )}
                <input
                  ref={todoFileRef}
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  hidden
                  onChange={importTodos}
                />
              </div>
              <button className="del" aria-label="Fechar" onClick={() => { setTodoId(null); setTodoMenu(false) }}>×</button>
            </div>

            <ul className="todos">
              {(todoTask.todos || []).map((x) => (
                <li key={x.id} className={x.done ? 'done' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={x.done}
                      onChange={() =>
                        setTodos(todoTask.id, (l) =>
                          l.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)))
                      }
                    />
                    <span>{x.text}</span>
                  </label>
                  <button
                    className="del"
                    aria-label={`Remover ${x.text}`}
                    onClick={() => setTodos(todoTask.id, (l) => l.filter((y) => y.id !== x.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
              {!todoTask.todos?.length && <li className="empty">Nada por aqui ainda.</li>}
            </ul>

            <form className="todo-add" onSubmit={addTodo}>
              <input
                ref={todoInputRef}
                className="add-name"
                placeholder="Novo afazer"
                aria-label="Novo afazer"
                value={todoText}
                onChange={(e) => setTodoText(e.target.value)}
              />
              <button type="submit">Adicionar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
