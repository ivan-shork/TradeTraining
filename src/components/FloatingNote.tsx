/** 可拖动复盘笔记浮窗：悬浮于回放面板之上，边播放边对照写备注 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  initialText: string
  title?: string
  onSave: (text: string) => void   // 自动防抖保存 + 关闭时保存
  onClose: () => void
}

export default function FloatingNote({ initialText, title = '本局笔记', onSave, onClose }: Props) {
  const [text, setText] = useState(initialText)
  const [pos, setPos] = useState({ x: Math.max(60, window.innerWidth - 400), y: 110 })
  const [saved, setSaved] = useState(true)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // 拖动：标题栏按下跟随移动
  const onDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setPos({
      x: Math.min(Math.max(0, e.clientX - dragRef.current.dx), window.innerWidth - 60),
      y: Math.min(Math.max(40, e.clientY - dragRef.current.dy), window.innerHeight - 80),
    })
  }
  const onDragEnd = () => { dragRef.current = null }

  // 防抖自动保存（停笔 800ms）
  useEffect(() => {
    if (text === initialText) return
    setSaved(false)
    const t = setTimeout(() => {
      onSave(text)
      setSaved(true)
    }, 800)
    return () => clearTimeout(t)
  }, [text])

  const close = () => {
    if (text !== initialText) onSave(text)
    onClose()
  }

  return (
    <div
      ref={boxRef}
      className="floating-note"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="floating-note-header"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <span>📝 {title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: saved ? '#38b478' : 'var(--warn)' }}>
          {saved ? '已保存' : '保存中...'}
        </span>
        <button className="del-btn" style={{ padding: '0 6px' }} onClick={close} title="关闭（内容已自动保存）">✕</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="对照 K 线写复盘：哪里判断对了、哪里冲动了、下次遇到同样形态怎么做…"
        spellCheck={false}
        // 阻止全局快捷键（空格步进等）在输入时触发
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
